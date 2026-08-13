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
