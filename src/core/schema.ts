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
// DEC-1（g080-approve-core）：设计审核凭据的合法状态（self=quick 自签、approved=人工审核）
const REVIEW_STATUSES = ["approved", "self"];

// ── 实体 ID 规则（S0-3 路径穿越防护）──
// ID 直接拼入文件路径（nodes/<id>.yaml、edges/<id>.yaml）：禁路径分隔符、
// 盘符冒号、前导点（".." 变体），长度 ≤64。允许小写字母/数字/点/下划线/连字符
// ——"n1.deleted-check" 合法（S3-13：.deleted 只在作为文件名后缀时排除）。
export const NODE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// N2（r0 交叉评审）：Windows 保留设备名。ID 即文件基名（<id>.yaml），
// con/nul/aux/prn/com1-9/lpt1-9 在部分 Windows 配置/API 下映射设备而非文件，
// 落盘行为平台相关（EPERM/静默写设备）——确定性拒绝优于困惑性失败。
// NODE_ID_RE 已强制小写，故保留名单只收小写形态。
const WINDOWS_RESERVED_NAMES = new Set<string>([
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** ID 合法性（格式 + Windows 保留名 + 后缀）：以 .deleted/.deleted.<数字> 结尾的
 * id 会与软删除历史文件名（x.deleted.yaml）冲突而被列表隐藏——文件名空间二义性，
 * 创建即拒。保留名按首个点分段匹配（"con" 与 "con.x" 同拒——Win32 对
 * "保留名.任意后缀" 形态的设备映射解释跨版本不一致） */
export function isValidEntityId(id: string): boolean {
  return (
    NODE_ID_RE.test(id) &&
    !WINDOWS_RESERVED_NAMES.has(id.split(".")[0]) &&
    !/\.deleted(\.\d+)?$/.test(id)
  );
}

/** 运行时断言（创建/读写咽喉点用）：非法 ID 立即抛错，不进文件系统。
 * what 为人类可读的实体描述（"节点" / "边" / "边 source"…） */
export function assertValidEntityId(what: string, id: string): void {
  if (!isValidEntityId(id)) {
    throw new Error(
      `非法${what} ID: "${id}"。规则: ^[a-z0-9][a-z0-9._-]{0,63}$ 且不得以 .deleted 结尾 ` +
        `（小写字母/数字开头，仅小写字母/数字/./_/-，≤64 字符；禁路径分隔符与冒号；` +
        `禁 Windows 保留名 con/nul/aux/prn/com1-9/lpt1-9 及其加点形态）`,
    );
  }
}

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
  // S0-3：ID 格式读时校验（手编文件也拦截——ID 拼路径，非法格式即穿越面）
  if (typeof data.id === "string" && !isValidEntityId(data.id)) {
    issues.push(issue("id", `非法 ID 格式: "${data.id}"（规则 ^[a-z0-9][a-z0-9._-]{0,63}$，不得以 .deleted 结尾，禁路径分隔符）`));
  }
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
  // S1-6：必填字段对齐 NodeSchema 接口声明——此前仅 id/label 必填，缺字段
  // 经 loadYamlFile 的 as T 掩盖成"合法"节点，下游按类型访问拿到 undefined
  // （status.ts 打印 undefined 分布、index-service 产出垃圾键、状态机静默空转换）
  if (data.type === undefined) {
    issues.push(issue("type", "必填（task|checkpoint|decision|gate|context|adr）"));
  }
  if (data.status === undefined) {
    issues.push(issue("status", "必填（工作流七态 / adr 三态 proposed|accepted|superseded / context 恒 pending）"));
  }
  for (const k of ["level", "attempts", "max_attempts"] as const) {
    if (data[k] === undefined) {
      issues.push(issue(k, "必填数字（graph 工具创建时自动补全；手写文件需齐全）"));
    }
  }
  for (const k of ["created_at", "updated_at"] as const) {
    if (data[k] === undefined) {
      issues.push(issue(k, "必填（ISO 8601 时间戳）"));
    }
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
  // IL-012（context 顶点）：对其他 context 的默认契约声明——形状与边 contract 一致
  // （复用 validateContractShape）；to 的存在性/指向合法性是跨文件规则，归 domain 校验
  if (data.contracts !== undefined) {
    if (!Array.isArray(data.contracts)) {
      issues.push(issue("contracts", "必须是数组"));
    } else {
      for (const d of data.contracts) {
        if (!isRecord(d) || typeof d.to !== "string" || d.to === "") {
          issues.push(issue("contracts", "每项需包含 to（目标 context id）字符串"));
          continue;
        }
        if (d.contract === undefined) {
          issues.push(issue(`contracts.${d.to}.contract`, "必填（默认契约对象，形状同边 contract）"));
        } else if (!isRecord(d.contract)) {
          issues.push(issue(`contracts.${d.to}.contract`, "必须是对象"));
        } else {
          validateContractShape(d.contract, issues, `contracts.${d.to}.contract`);
        }
      }
    }
  }
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

// IL-012：契约形状校验——边 contract 与 context 顶点默认契约声明（contracts[].contract）
// 共用同一形状（produces / consumed_by[{artifact,used_as}] / validation{required,method}）。
// S1-8（历史）：consumed_by 逐元素查结构（只查数组不查元素会漏掉缺字段）、
// method 的真实位置在 contract.validation.method（旧代码错查顶层从未拦截）。
function validateContractShape(
  contract: Record<string, unknown>,
  issues: SchemaIssue[],
  prefix: string,
): void {
  optString(contract, "produces", issues);
  if (contract.consumed_by !== undefined) {
    if (!Array.isArray(contract.consumed_by)) {
      issues.push(issue(`${prefix}.consumed_by`, "必须是数组"));
    } else {
      for (const c of contract.consumed_by) {
        if (!isRecord(c) || typeof c.artifact !== "string" || typeof c.used_as !== "string") {
          issues.push(issue(`${prefix}.consumed_by`, "每项需包含 artifact 与 used_as 字符串"));
        }
      }
    }
  }
  if (contract.validation !== undefined) {
    if (!isRecord(contract.validation)) {
      issues.push(issue(`${prefix}.validation`, "必须是对象"));
    } else {
      const v = contract.validation as Record<string, unknown>;
      if (v.required !== undefined && typeof v.required !== "boolean") {
        issues.push(issue(`${prefix}.validation.required`, "必须是布尔值"));
      }
      if (v.method !== undefined && !VERIFIERS.includes(v.method as string)) {
        issues.push(
          issue(`${prefix}.validation.method`, `非法值 "${String(v.method)}"，允许: ${VERIFIERS.join("|")}`),
        );
      }
    }
  }
}

export function validateEdge(data: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (!isRecord(data)) {
    issues.push(issue("edge", "边文件必须是 YAML 对象"));
    return issues;
  }
  reqString(data, "id", issues);
  reqString(data, "source", issues);
  reqString(data, "target", issues);
  // S0-3：id/source/target 全部做 ID 格式校验（source/target 同样参与路径与查表）
  for (const k of ["id", "source", "target"] as const) {
    if (typeof data[k] === "string" && !isValidEntityId(data[k] as string)) {
      issues.push(issue(k, `非法 ID 格式: "${String(data[k])}"（规则 ^[a-z0-9][a-z0-9._-]{0,63}$，不得以 .deleted 结尾）`));
    }
  }
  optEnum(data, "type", EDGE_TYPES, issues);
  optString(data, "rel_kind", issues);
  if (data.contract !== undefined) {
    if (!isRecord(data.contract)) {
      issues.push(issue("contract", "必须是对象"));
    } else {
      validateContractShape(data.contract, issues, "contract");
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
  // DEC-1（g080-approve-core）：review 为可选字段——缺省不存在（零迁移、零默认拒绝），
  // 存在时严格校验形状（status 枚举 / by、at 字符串），手编拼错在读入层即拦截。
  if (data.review !== undefined) {
    if (!isRecord(data.review)) {
      issues.push(issue("review", "必须是对象"));
    } else {
      const rev = data.review as Record<string, unknown>;
      optEnum(rev, "status", REVIEW_STATUSES, issues);
      reqString(rev, "by", issues);
      optString(rev, "at", issues);
    }
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

// S3-13：软删除文件按后缀模式排除（x.deleted.yaml / x.deleted.<时间戳>.yaml），
// 不再按 ".deleted" 任意子串——合法 id（如 n1.deleted-check）不再被静默隐藏
const DELETED_FILE_RE = /\.deleted(\.\d+)?\.yaml$/;

export function listNodeFileNames(rootDir: string): string[] {
  const dir = path.join(toGraphDir(rootDir), NODES_DIR);
  if (!fs.existsSync(dir)) return [];
  if (!fs.statSync(dir).isDirectory()) {
    throw new Error(`nodes 目录损坏（存在同名文件）: ${dir}`);
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") && !DELETED_FILE_RE.test(f));
}

export function listEdgeFileNames(rootDir: string): string[] {
  const dir = path.join(toGraphDir(rootDir), EDGES_DIR);
  if (!fs.existsSync(dir)) return [];
  if (!fs.statSync(dir).isDirectory()) {
    throw new Error(`edges 目录损坏（存在同名文件）: ${dir}`);
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") && !DELETED_FILE_RE.test(f));
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
