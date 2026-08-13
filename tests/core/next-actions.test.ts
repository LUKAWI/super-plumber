// tests/core/next-actions.test.ts — 调度决策工具
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { computeNextActions } from "../../src/core/graph.js";
import { createNode, updateNodeStatus } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { NodeType, NodeStatus, EdgeType } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-next-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("computeNextActions", () => {
  it("线性链 a→b：a ready、b 等依赖", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);

    const r = computeNextActions(tmpDir);
    expect(r.ready.map((n) => n.id)).toEqual(["a"]);
    expect(r.blocked.map((n) => n.id)).toEqual(["b"]);
    expect(r.blocked[0].unmet).toEqual([{ id: "a", status: "ready" }]);
    expect(r.summary.total).toBe(2);
    expect(r.summary.ready).toBe(1);
  });

  it("a passed 后 b 不再是 blocked 候选（可转 ready）", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Passed);
    const r = computeNextActions(tmpDir);
    expect(r.blocked).toEqual([]);
  });

  it("running 节点带执行者与时长；陈旧阈值触发 stale_running", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running, "agent-1");
    const r = computeNextActions(tmpDir, { staleMs: 0 });
    expect(r.running.map((n) => n.id)).toEqual(["a"]);
    expect(r.running[0].assigned_to).toBe("agent-1");
    expect(r.running[0].elapsed_ms).not.toBeNull();
    expect(r.stale_running.map((n) => n.id)).toEqual(["a"]); // staleMs=0 → 必然陈旧
  });

  it("failed 且门控前驱未齐 → blocked 候选", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    const r = computeNextActions(tmpDir);
    expect(r.blocked.map((n) => n.id)).toEqual(["b"]);
  });

  it("fan_out/fan_in 语义：fan_in 汇聚点等全部上游", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createNode(tmpDir, { id: "c", type: NodeType.Task, label: "C" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "c", type: EdgeType.FanIn });
    createEdge(tmpDir, { id: "e2", source: "b", target: "c", type: EdgeType.FanIn });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Passed);
    const r = computeNextActions(tmpDir);
    const c = r.blocked.find((n) => n.id === "c");
    expect(c).toBeDefined();
    expect(c!.unmet.map((u) => u.id)).toEqual(["b"]);
  });
});
