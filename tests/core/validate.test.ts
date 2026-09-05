// tests/core/validate.test.ts — arch-c3b：validate 编排单源（core/validate.ts）核心单测
// CLI validate 与 MCP graph_validate 双渠道自此消费同一入口 validateGraphDir；
// 这里锁定编排语义：ok/errors/warnings 结构、节点/边计数、fatal 提前终止、
// 以及归一后的单源警告文案（渠道只加前缀不改写）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { validateGraphDir } from "../../src/core/validate.js";
import { createGraph } from "../../src/core/graph-dir.js";
import { createNode } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { NodeType, EdgeType } from "../../src/core/types.js";

let tmpDir: string;
let graphDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-validate-"));
  createGraph(tmpDir, "t", "校验测试图");
  graphDir = path.join(tmpDir, ".graph", "t");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeGhostEdge(graphDir: string, id: string, target: string): void {
  fs.writeFileSync(
    path.join(graphDir, "edges", `${id}.yaml`),
    `id: ${id}\nsource: missing-node\ntarget: ${target}\ntype: depends_on\n`,
    "utf-8",
  );
}

describe("validateGraphDir：结构契约（arch-c3b）", () => {
  it("未初始化目录 → ok=false，errors 报未初始化，计数为 0，fatal_stage=graph", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "topo-validate-bare-"));
    try {
      const r = validateGraphDir(bare);
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toContain("未初始化");
      expect(r.warnings).toEqual([]);
      expect(r.node_count).toBe(0);
      expect(r.edge_count).toBe(0);
      expect(r.fatal_stage).toBe("graph");
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it("干净空图 → ok=true 零错误；骨架警告齐备；计数 0/0；全流程走完", () => {
    const r = validateGraphDir(graphDir);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    const w = r.warnings.join(" ");
    expect(w).toContain("图入口(entry)描述为空");
    expect(w).toContain("图出口(exit)描述为空");
    expect(w).toContain("图出口(exit)验收标准为空");
    expect(w).toContain("图中没有节点");
    expect(r.node_count).toBe(0);
    expect(r.edge_count).toBe(0);
    expect(r.fatal_stage).toBeNull();
    expect(r.checkpoint_summaries).toEqual([]);
  });

  it("节点/边计数正确；ok 与 errors 为空互为充要", () => {
    createNode(graphDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(graphDir, { id: "b", type: NodeType.Task, label: "B" });
    const r = validateGraphDir(graphDir);
    expect(r.node_count).toBe(2);
    expect(r.edge_count).toBe(0);
    expect(r.ok).toBe(r.errors.length === 0);
    expect(r.ok).toBe(true);
  });

  it("循环依赖 → ok=false，errors 含循环依赖，topo/cycles 标志置位，计数不丢", () => {
    createNode(graphDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(graphDir, { id: "b", type: NodeType.Task, label: "B" });
    fs.writeFileSync(
      path.join(graphDir, "edges", "e1.yaml"),
      "id: e1\nsource: a\ntarget: b\ntype: depends_on\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(graphDir, "edges", "e2.yaml"),
      "id: e2\nsource: b\ntarget: a\ntype: depends_on\n",
      "utf-8",
    );
    const r = validateGraphDir(graphDir);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("检测到循环依赖"))).toBe(true);
    expect(r.cycles_found).toBe(true);
    expect(r.topo_ok).toBe(false);
    expect(r.node_count).toBe(2);
    expect(r.edge_count).toBe(2);
    expect(r.fatal_stage).toBeNull();
  });

  it("单节点自环 → ok=false，不能因节点数为 1 跳过循环检测", () => {
    createNode(graphDir, { id: "solo", type: NodeType.Task, label: "Solo" });
    createEdge(graphDir, {
      id: "self-loop",
      source: "solo",
      target: "solo",
      type: EdgeType.DependsOn,
    });
    const r = validateGraphDir(graphDir);
    expect(r.ok).toBe(false);
    expect(r.cycles_found).toBe(true);
    expect(r.topo_ok).toBe(false);
    expect(r.errors.some((e) => e.includes("检测到循环依赖") && e.includes("solo"))).toBe(true);
  });

  it("幽灵边（手编残留）→ errors 报不存在的端点", () => {
    createNode(graphDir, { id: "a", type: NodeType.Task, label: "A" });
    writeGhostEdge(graphDir, "e-ghost", "a");
    const r = validateGraphDir(graphDir);
    expect(r.ok).toBe(false);
    expect(
      r.errors.some((e) => e.includes("不存在的源节点") && e.includes("missing-node")),
    ).toBe(true);
    expect(r.edge_count).toBe(1);
  });

  it("schema 损坏的单节点不中断其余：缺字段逐项进 errors 且带文件前缀", () => {
    createNode(graphDir, { id: "a", type: NodeType.Task, label: "A" });
    fs.writeFileSync(
      path.join(graphDir, "nodes", "bad.yaml"),
      "id: bad\nlabel: 只有 id/label\n",
      "utf-8",
    );
    const r = validateGraphDir(graphDir);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith("nodes/bad.yaml:") && e.includes("status"))).toBe(
      true,
    );
    expect(r.node_count).toBe(1); // 好节点照常计数
  });
});

describe("validateGraphDir：单源警告文案（arch-c3b 归一）", () => {
  it("引用列表反向漂移 → 单源定稿文案（含 graph.yaml 主语 + MCP graph_rebuild 自愈提示）", () => {
    createNode(graphDir, { id: "n1", type: NodeType.Task, label: "N1" });
    // 手工清空 refs（模拟 S1-4 丢引用竞态 / S1-10 半重置残留）
    const gf = path.join(graphDir, "graph.yaml");
    const before = fs.readFileSync(gf, "utf-8");
    fs.writeFileSync(
      gf,
      before.replace("nodes:\n  - file: nodes/n1.yaml\n", "nodes: []\n"),
      "utf-8",
    );
    const r1 = validateGraphDir(graphDir);
    expect(r1.ok).toBe(true); // 漂移是中性警告，不参与 ok 判定
    const drift = r1.warnings.find((w) => w.includes("未引用已存在的节点文件"));
    expect(drift).toBeDefined();
    // 归一后的单源正文（双渠道一致；渠道只加前缀不改写）
    expect(drift).toBe(
      "graph.yaml 未引用已存在的节点文件: nodes/n1.yaml（引用列表与目录漂移，请检查 graph.yaml 补回引用；MCP 通道可用 graph_rebuild 重建引用自愈）",
    );
    // 补回引用 → 警告消失（检测精确性）
    fs.writeFileSync(gf, before, "utf-8");
    const r2 = validateGraphDir(graphDir);
    expect(r2.warnings.some((w) => w.includes("未引用已存在的节点文件"))).toBe(false);
  });

  it("checkpoint 聚合摘要：aggregate/count 供 CLI 进度行渲染（passed+skipped → passed）", () => {
    createNode(graphDir, {
      id: "a",
      type: NodeType.Task,
      label: "A",
      checkpoints: [
        { id: "cp1", label: "Step1", status: "passed", verifier: "auto" },
        { id: "cp2", label: "Step2", status: "skipped", verifier: "auto" },
      ],
    });
    const r = validateGraphDir(graphDir);
    expect(r.checkpoint_summaries).toEqual([
      { node_id: "a", aggregate: "passed", count: 2 },
    ]);
  });
});

describe("validateGraphDir：fatal 提前终止（渠道不渲染假成功进度）", () => {
  it("nodes 目录损坏（是文件非目录）→ errors 报目录不可读，fatal_stage=nodes", () => {
    fs.rmSync(path.join(graphDir, "nodes"), { recursive: true, force: true });
    fs.writeFileSync(path.join(graphDir, "nodes"), "not a directory", "utf-8");
    const r = validateGraphDir(graphDir);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("无法读取 nodes/ 目录"))).toBe(true);
    expect(r.fatal_stage).toBe("nodes");
    expect(r.node_count).toBe(0);
  });

  it("edges 目录损坏 → errors 报目录不可读，fatal_stage=edges，已载节点计数保留", () => {
    createNode(graphDir, { id: "a", type: NodeType.Task, label: "A" });
    fs.rmSync(path.join(graphDir, "edges"), { recursive: true, force: true });
    fs.writeFileSync(path.join(graphDir, "edges"), "not a directory", "utf-8");
    const r = validateGraphDir(graphDir);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("无法读取 edges/ 目录"))).toBe(true);
    expect(r.fatal_stage).toBe("edges");
    expect(r.node_count).toBe(1);
    expect(r.edge_count).toBe(0);
  });
});

describe("validateGraphDir：fallback/iterates 警告口径（F09/adr_0017 收窄）", () => {
  it("iterates 边触发文档性标注警告；fallback 边不再触发任何警告", () => {
    createNode(graphDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(graphDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(graphDir, { id: "ei", source: "a", target: "b", type: EdgeType.Iterates });
    createEdge(graphDir, { id: "ef", source: "a", target: "b", type: EdgeType.Fallback });
    const r = validateGraphDir(graphDir);
    expect(r.ok).toBe(true);
    const iteratesWarning = r.warnings.find((w) => w.includes("边 ei"));
    expect(iteratesWarning).toBeDefined();
    expect(iteratesWarning).toContain("iterates");
    expect(iteratesWarning).toContain("文档性标注");
    expect(iteratesWarning).toContain("attempts");
    expect(iteratesWarning!.includes("fallback")).toBe(false);
    expect(r.warnings.some((w) => w.includes("边 ef"))).toBe(false);
  });
});
