// src/core/schema.ts
// 读入层 schema 校验（手写，零外部依赖，满足"核心逻辑零外部依赖"约束）。
// "文件是人类可直接编辑"是产品卖点，就必须在拼错枚举/缺字段时给出可读错误，
// 而不是让错误在状态机 / Web UI / Mermaid 下游以诡异方式爆发。
// 宽容未知字段（向前兼容），严格校验已知字段。
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import {
  EdgeType,
  NodeStatus,
  NodeType,
  AdrStatus,
  NODES_DIR,
  EDGES_DIR,
  GRAPH_FILE,
  type NodeSchema,
  type EdgeSchema,
  type GraphSchema,
} from "./types.js";
import { toGraphDir } from "./graph-dir.js";

export interface SchemaIssue {
  field: string;
  message: string;
}

export type LoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; issues: SchemaIssue[]; enoent?: boolean };

export class SchemaValidationError extends Error {
  readonly code = "SCHEMA_ERROR";
  constructor(
    public readonly file: string,
    public readonly issues: SchemaIssue[],
    message: string,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

export function formatIssues(issues: SchemaIssue[]): string {
  return issues.map((i) => `${i.field}: ${i.message}`).join("; ");
}

const NODE_TYPES = Object.values(NodeType) as string[];
const NODE_STATUSES = Object.values(NodeStatus) as string[];
const ADR_STATUSES = Object.values(AdrStatus) as string[];
const EDGE_TYPES = Object.values(EdgeType) as string[];
const CP_STATUSES = ["pending", "running", "passed", "failed", "skipped"];
const VERIFIERS = ["auto", "cross_review", "human"];
const VERDICTS = ["pending", "passed", "failed"];
const DEFINED_BY = ["human", "llm"];

// ── 基础校验工具 ──

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function issue(field: string, message: string): SchemaIssue {
  return { field, message };
}

function reqString(
  obj: Record<string, unknown>,
  key: string,
  issues: SchemaIssue[],
): void {
  if (typeof obj[key] !== "string" || obj[key] === "") {
    issues.push(issue(key, `必须是字符串且不能为空`));
  }
}

function optString(
  obj: Record<string, unknown>,
  key: string,
  issues: SchemaIssue[],
): void {
  if (obj[key] !== undefined && typeof obj[key] !== "string") {
    issues.push(issue(key, `必须是字符串`));
  }
}

function optNumber(
  obj: Record<string, unknown>,
  key: string,
  issues: SchemaIssue[],
  opts: { min?: number } = {},
): void {
  if (obj[key] === undefined) return;
  if (typeof obj[key] !== "number" || Number.isNaN(obj[key])) {
    issues.push(issue(key, `必须是数字`));
    return;
  }
  if (opts.min !== undefined && (obj[key] as number) < opts.min) {
    issues.push(issue(key, `不能小于 ${opts.min}`));
  }
}

function optEnum(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
  issues: SchemaIssue[],
): void {
  if (obj[key] !== undefined && !allowed.includes(obj[key] as string)) {
    issues.push(issue(key, `非法值 "${String(obj[key])}"，允许: ${allowed.join("|")}`));
  }
}

function optStringArray(
  obj: Record<string, unknown>,
  key: string,
  issues: SchemaIssue[],
): void {
  if (obj[key] === undefined) return;
  const v = obj[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    issues.push(issue(key, `必须是字符串数组`));
  }
}

// ── Node ──

function validatePlan(v: unknown, issues: SchemaIssue[], prefix = "plan"): void {
  if (v === undefined) return;
  if (!isRecord(v)) {
    issues.push(issue(prefix, "必须是对象"));
    return;
  }
  reqString(v, "description", issues);
  for (const k of ["input_from", "output_to"] as const) {
    if (v[k] === undefined) continue;
    if (!Array.isArray(v[k])) {
      issues.push(issue(`${prefix}.${k}`, "必须是数组"));
      continue;
    }
    for (const item of v[k] as unknown[]) {
      if (!isRecord(item) || typeof item.node !== "string" || typeof item.artifact !== "string") {
        issues.push(issue(`${prefix}.${k}`, "每项需包含 node 与 artifact 字符串"));
      }
    }
  }
  if (v.required_context !== undefined && !Array.isArray(v.required_context)) {
    issues.push(issue(`${prefix}.required_context`, "必须是数组"));
  }
}

function validateExpectedOutcome(
  v: unknown,
  issues: SchemaIssue[],
  prefix = "expected_outcome",
): void {
  if (v === undefined) return;
  if (!isRecord(v)) {
    issues.push(issue(prefix, "必须是对象"));
    return;
  }
  if (v.definition_of_done !== undefined) {
    if (!Array.isArray(v.definition_of_done) || v.definition_of_done.some((x) => typeof x !== "string")) {
      issues.push(issue(`${prefix}.definition_of_done`, "必须是字符串数组"));
    }
  }
  if (v.quality_gates !== undefined) {
    if (!Array.isArray(v.quality_gates)) {
      issues.push(issue(`${prefix}.quality_gates`, "必须是数组"));
    } else {
      for (const g of v.quality_gates as unknown[]) {
        if (!isRecord(g) || typeof g.check !== "string") {
          issues.push(issue(`${prefix}.quality_gates`, "每项需包含 check 字符串"));
        } else if (g.method !== undefined && !VERIFIERS.includes(g.method as string)) {
          issues.push(issue(`${prefix}.quality_gates.method`, `非法值 "${String(g.method)}"，允许: ${VERIFIERS.join("|")}`));
        }
      }
    }
  }
}

function validateCheckpoints(v: unknown, issues: SchemaIssue[], prefix = "checkpoints"): void {
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    issues.push(issue(prefix, "必须是数组"));
    return;
  }
  for (const cp of v as unknown[]) {
    if (!isRecord(cp) || typeof cp.id !== "string" || typeof cp.label !== "string") {
      issues.push(issue(prefix, "每项需包含 id 与 label 字符串"));
      continue;
    }
    if (cp.status !== undefined && !CP_STATUSES.includes(cp.status as string)) {
      issues.push(issue(`${prefix}.${String(cp.id)}.status`, `非法值 "${String(cp.status)}"，允许: ${CP_STATUSES.join("|")}`));
    }
    if (cp.verifier !== undefined && !VERIFIERS.includes(cp.verifier as string)) {
      issues.push(issue(`${prefix}.${String(cp.id)}.verifier`, `非法值 "${String(cp.verifier)}"，允许: ${VERIFIERS.join("|")}`));
    }
  }
}

function validateExecutionReport(v: unknown, issues: SchemaIssue[], prefix = "execution_report"): void {
  if (v === undefined) return;
  if (!isRecord(v)) {
    issues.push(issue(prefix, "必须是对象"));
    return;
  }
  if (v.summary !== undefined && typeof v.summary !== "string") {
    issues.push(issue(`${prefix}.summary`, "必须是字符串"));
  }
  optStringArray(v, "artifacts", issues);
  optStringArray(v, "blockers", issues);
  optString(v, "notes", issues);
  optString(v, "started_at", issues);
  optString(v, "completed_at", issues);
  if (v.verification !== undefined) {
    if (!isRecord(v.verification)) {
      issues.push(issue(`${prefix}.verification`, "必须是对象"));
    } else {
      optEnum(v.verification, "verdict", VERDICTS, issues);
      optString(v.verification, "checked_at", issues);
      optString(v.verification, "note", issues);
    }
  }
}

function validateGlossary(v: unknown, issues: SchemaIssue[], prefix = "glossary"): void {
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    issues.push(issue(prefix, "必须是数组"));
    return;
  }
  for (const entry of v as unknown[]) {
    if (!isRecord(entry) || typeof entry.term !== "string" || typeof entry.definition !== "string") {
      issues.push(issue(prefix, "每项需包含 term 与 definition 字符串"));
    }
  }
}

export function validateNode(data: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (!isRecord(data)) {
    issues.push(issue("node", "节点文件必须是 YAML 对象"));
    return issues;
  }
  reqString(data, "id", issues);
  reqString(data, "label", issues);
  optEnum(data, "type", NODE_TYPES, issues);
  // v0.5：status 合法值随类型变化——adr 走三态机，context 无状态（仅 pending），其余为工作流七态
  const nodeType = typeof data.type === "string" ? data.type : undefined;
  const statusAllowed =
    nodeType === NodeType.Adr
      ? ADR_STATUSES
      : nodeType === NodeType.Context
        ? [NodeStatus.Pending]
        : NODE_STATUSES;
  if (data.status !== undefined && !statusAllowed.includes(data.status as string)) {
    issues.push(
      issue("status", `非法值 "${String(data.status)}"，${nodeType ?? "该类型"}允许: ${statusAllowed.join("|")}`),
    );
  }
  optNumber(data, "level", issues, { min: 0 });
  optNumber(data, "priority", issues, { min: 0 });
  optNumber(data, "attempts", issues, { min: 0 });
  optNumber(data, "max_attempts", issues, { min: 0 });
  optString(data, "assigned_to", issues);
  optString(data, "created_at", issues);
  optString(data, "updated_at", issues);
  // v0.5 领域字段
  optString(data, "context", issues);
  optString(data, "boundary", issues);
  validateGlossary(data.glossary, issues);
  optString(data, "decision", issues);
  optString(data, "background", issues);
  optString(data, "considered_options", issues);
  optString(data, "why", issues);
  optString(data, "consequences", issues);
  optString(data, "superseded_by", issues);
  if (nodeType === NodeType.Adr && (typeof data.decision !== "string" || data.decision === "")) {
    issues.push(issue("decision", "adr 顶点必填（决策内容；label 即标题）"));
  }
  validatePlan(data.plan, issues);
  validateExpectedOutcome(data.expected_outcome, issues);
  validateCheckpoints(data.checkpoints, issues);
  validateExecutionReport(data.execution_report, issues);
  return issues;
}

// ── Edge ──

export function validateEdge(data: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (!isRecord(data)) {
    issues.push(issue("edge", "边文件必须是 YAML 对象"));
    return issues;
  }
  reqString(data, "id", issues);
  reqString(data, "source", issues);
  reqString(data, "target", issues);
  optEnum(data, "type", EDGE_TYPES, issues);
  optString(data, "rel_kind", issues);
  if (data.contract !== undefined) {
    if (!isRecord(data.contract)) {
      issues.push(issue("contract", "必须是对象"));
    } else {
      optString(data.contract, "produces", issues);
      optEnum(data.contract, "method", ["auto", "cross_review", "human"], issues);
      if (data.contract.consumed_by !== undefined && !Array.isArray(data.contract.consumed_by)) {
        issues.push(issue("contract.consumed_by", "必须是数组"));
      }
    }
  }
  return issues;
}

// ── Graph ──

export function validateGraph(data: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (!isRecord(data)) {
    issues.push(issue("graph", "graph.yaml 必须是 YAML 对象"));
    return issues;
  }
  reqString(data, "id", issues);
  reqString(data, "label", issues);
  optString(data, "version", issues);
  for (const key of ["entry", "exit"] as const) {
    if (data[key] === undefined) continue;
    if (!isRecord(data[key])) {
      issues.push(issue(key, "必须是对象"));
      continue;
    }
    const rec = data[key] as Record<string, unknown>;
    // 允许空字符串：graph init 生成的骨架 description 为空，
    // 由 graph validate 对"描述为空"做警告提示（非 schema 错误）
    if (typeof rec.description !== "string") {
      issues.push(issue(`${key}.description`, "必须是字符串"));
    }
    if (rec.defined_by !== undefined && !DEFINED_BY.includes(rec.defined_by as string)) {
      issues.push(
        issue(`${key}.defined_by`, `非法值 "${String(rec.defined_by)}"，允许: ${DEFINED_BY.join("|")}`),
      );
    }
    if (rec.level !== undefined && (typeof rec.level !== "number" || rec.level < 0)) {
      issues.push(issue(`${key}.level`, "必须是非负数字"));
    }
  }
  if (data.exit !== undefined && isRecord(data.exit)) {
    const exitRec = data.exit as Record<string, unknown>;
    if (exitRec.acceptance_criteria !== undefined) {
      const v = exitRec.acceptance_criteria;
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
        issues.push(issue("exit.acceptance_criteria", "必须是字符串数组"));
      }
    }
  }
  for (const key of ["nodes", "edges"] as const) {
    if (data[key] === undefined) continue;
    if (!Array.isArray(data[key])) {
      issues.push(issue(key, "必须是数组"));
      continue;
    }
    for (const item of data[key] as unknown[]) {
      if (!isRecord(item) || typeof item.file !== "string") {
        issues.push(issue(key, "每项需包含 file 字符串"));
      }
    }
  }
  if (data.root_context !== undefined && !isRecord(data.root_context)) {
    issues.push(issue("root_context", "必须是对象"));
  }
  return issues;
}

// ── 文件加载（带校验）──

function loadYamlFile<T>(
  file: string,
  validate: (d: unknown) => SchemaIssue[],
): LoadResult<T> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return { ok: false, issues: [], enoent: true };
    return { ok: false, issues: [issue("file", `无法读取文件: ${err.message}`)] };
  }
  let data: unknown;
  try {
    data = yaml.load(raw);
  } catch (err: any) {
    return { ok: false, issues: [issue("yaml", `解析失败: ${err.message}`)] };
  }
  const issues = validate(data);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, data: data as T };
}

export function listNodeFileNames(rootDir: string): string[] {
  const dir = path.join(toGraphDir(rootDir), NODES_DIR);
  if (!fs.existsSync(dir)) return [];
  if (!fs.statSync(dir).isDirectory()) {
    throw new Error(`nodes 目录损坏（存在同名文件）: ${dir}`);
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") && !f.includes(".deleted"));
}

export function listEdgeFileNames(rootDir: string): string[] {
  const dir = path.join(toGraphDir(rootDir), EDGES_DIR);
  if (!fs.existsSync(dir)) return [];
  if (!fs.statSync(dir).isDirectory()) {
    throw new Error(`edges 目录损坏（存在同名文件）: ${dir}`);
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") && !f.includes(".deleted"));
}

export function loadNodeFile(rootDir: string, fileName: string): LoadResult<NodeSchema> {
  return loadYamlFile<NodeSchema>(path.join(toGraphDir(rootDir), NODES_DIR, fileName), validateNode);
}

export function loadEdgeFile(rootDir: string, fileName: string): LoadResult<EdgeSchema> {
  return loadYamlFile<EdgeSchema>(path.join(toGraphDir(rootDir), EDGES_DIR, fileName), validateEdge);
}

export function loadGraphFile(rootDir: string): LoadResult<GraphSchema> {
  return loadYamlFile<GraphSchema>(path.join(toGraphDir(rootDir), GRAPH_FILE), validateGraph);
}
