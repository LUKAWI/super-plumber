// tests/core/schema.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  validateNode,
  validateEdge,
  validateGraph,
  loadNodeFile,
} from "../../src/core/schema.js";

function validNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    type: "task",
    label: "测试节点",
    level: 1,
    status: "pending",
    attempts: 0,
    max_attempts: 3,
    created_at: "2026-08-13T00:00:00Z",
    updated_at: "2026-08-13T00:00:00Z",
    ...overrides,
  };
}

describe("schema validation", () => {
  it("合法节点 → 0 issues", () => {
    expect(validateNode(validNode())).toEqual([]);
  });

  it("status 拼错 → 报 status", () => {
    const issues = validateNode(validNode({ status: "runnig" }));
    expect(issues.some((i) => i.field === "status")).toBe(true);
  });

  it("type 枚举外 → 报 type", () => {
    const issues = validateNode(validNode({ type: "rocket" }));
    expect(issues.some((i) => i.field === "type")).toBe(true);
  });

  it("缺 id / label → 报错", () => {
    const issues = validateNode({ type: "task" });
    expect(issues.filter((i) => i.field === "id" || i.field === "label")).toHaveLength(2);
  });

  it("checkpoint status 非法 → 报 checkpoints.*.status", () => {
    const issues = validateNode(
      validNode({ checkpoints: [{ id: "cp1", label: "x", status: "done" }] }),
    );
    expect(issues.some((i) => i.field === "checkpoints.cp1.status")).toBe(true);
  });

  it("verifier 非法 → 报错", () => {
    const issues = validateNode(
      validNode({ checkpoints: [{ id: "cp1", label: "x", status: "pending", verifier: "god" }] }),
    );
    expect(issues.some((i) => i.field.includes("verifier"))).toBe(true);
  });

  it("execution_report.verification.verdict 非法 → 报错", () => {
    const issues = validateNode(
      validNode({ execution_report: { summary: "s", verification: { verdict: "maybe" } } }),
    );
    expect(issues.some((i) => i.field.includes("verdict"))).toBe(true);
  });

  it("未知字段宽容（向前兼容）", () => {
    expect(validateNode(validNode({ future_field: { nested: 1 } }))).toEqual([]);
  });

  it("attempts 为负数 → 报错", () => {
    const issues = validateNode(validNode({ attempts: -1 }));
    expect(issues.some((i) => i.field === "attempts")).toBe(true);
  });

  it("合法边 → 0 issues", () => {
    expect(
      validateEdge({ id: "e1", source: "a", target: "b", type: "depends_on" }),
    ).toEqual([]);
  });

  it("边类型枚举外 → 报 type", () => {
    const issues = validateEdge({ id: "e1", source: "a", target: "b", type: "magic" });
    expect(issues.some((i) => i.field === "type")).toBe(true);
  });

  it("合法图 → 0 issues", () => {
    expect(
      validateGraph({
        id: "g1",
        label: "图",
        version: "0.2.0",
        entry: { description: "需求", defined_by: "human", level: 0 },
        exit: { description: "交付", acceptance_criteria: ["c1"], defined_by: "human", level: 0 },
        nodes: [{ file: "nodes/a.yaml" }],
        edges: [],
        root_context: { key: "value" },
      }),
    ).toEqual([]);
  });

  it("exit.acceptance_criteria 非数组 → 报错", () => {
    const issues = validateGraph({
      id: "g1",
      label: "图",
      entry: { description: "e", defined_by: "human", level: 0 },
      exit: { description: "x", acceptance_criteria: "not-array", defined_by: "human", level: 0 },
      nodes: [],
      edges: [],
    });
    expect(issues.some((i) => i.field === "exit.acceptance_criteria")).toBe(true);
  });

  it("defined_by 非法 → 报错", () => {
    const issues = validateGraph({
      id: "g1",
      label: "图",
      entry: { description: "e", defined_by: "alien", level: 0 },
      exit: { description: "x", acceptance_criteria: [], defined_by: "human", level: 0 },
      nodes: [],
      edges: [],
    });
    expect(issues.some((i) => i.field === "entry.defined_by")).toBe(true);
  });
});

describe("schema file loaders", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-schema-"));
    fs.mkdirSync(path.join(tmpDir, ".graph", "nodes"), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("损坏 YAML → 返回 parse issue（不崩溃）", () => {
    fs.writeFileSync(path.join(tmpDir, ".graph/nodes/bad.yaml"), "id: [unclosed");
    const r = loadNodeFile(tmpDir, "bad.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.field === "yaml")).toBe(true);
    }
  });

  it("不存在的文件 → enoent=true", () => {
    const r = loadNodeFile(tmpDir, "ghost.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.enoent).toBe(true);
  });

  it("枚举拼错的节点文件 → ok=false 且带文件定位信息", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".graph/nodes/n1.yaml"),
      "id: n1\nlabel: N\nstatus: runnig\n",
    );
    const r = loadNodeFile(tmpDir, "n1.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.field === "status")).toBe(true);
  });
});

// ── v0.5 领域字段（规格 A：知识顶点 schema）──
describe("v0.5 领域字段校验", () => {
  it("context 顶点：仅允许 pending 状态（无状态）", () => {
    expect(validateNode(validNode({ type: "context", status: "pending" }))).toEqual([]);
    const issues = validateNode(validNode({ type: "context", status: "ready" }));
    expect(issues.some((i) => i.field === "status")).toBe(true);
  });

  it("adr 顶点：三态合法，工作流七态非法", () => {
    for (const s of ["proposed", "accepted", "superseded"]) {
      expect(validateNode(validNode({ type: "adr", status: s, decision: "决策内容" }))).toEqual([]);
    }
    const issues = validateNode(validNode({ type: "adr", status: "running", decision: "x" }));
    expect(issues.some((i) => i.field === "status")).toBe(true);
  });

  it("adr 顶点：decision 必填（label 即标题）", () => {
    const issues = validateNode(validNode({ type: "adr", status: "proposed" }));
    expect(issues.some((i) => i.field === "decision")).toBe(true);
  });

  it("glossary 结构校验：term/definition 缺失报错，合法通过", () => {
    const bad = validateNode(validNode({ type: "context", glossary: [{ term: "订单" }] }));
    expect(bad.some((i) => i.field === "glossary")).toBe(true);
    const good = validateNode(
      validNode({ type: "context", glossary: [{ term: "订单", definition: "购买单据" }] }),
    );
    expect(good).toEqual([]);
  });

  it("工作流节点可带 context/boundary 等领域字段（字符串校验）", () => {
    const issues = validateNode(validNode({ context: "ctx1", boundary: 123 }));
    expect(issues.some((i) => i.field === "boundary")).toBe(true);
    expect(validateNode(validNode({ context: "ctx1", superseded_by: "adr_0002" }))).toEqual([]);
  });

  it("relates 边 rel_kind 字符串校验；decides/relates 在边类型枚举内", () => {
    expect(validateEdge({ id: "e1", source: "a", target: "b", type: "decides" })).toEqual([]);
    expect(
      validateEdge({ id: "e2", source: "a", target: "b", type: "relates", rel_kind: "upstream" }),
    ).toEqual([]);
    const issues = validateEdge({ id: "e3", source: "a", target: "b", type: "relates", rel_kind: 42 });
    expect(issues.some((i) => i.field === "rel_kind")).toBe(true);
  });
});
