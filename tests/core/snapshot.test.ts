// tests/core/snapshot.test.ts — Snapshot / Diff / Rollback 原语
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createSnapshot,
  diffSnapshot,
  rollbackToSnapshot,
  listSnapshots,
} from "../../src/core/snapshot.js";
import { createNode, updateNodeStatus, getNode, updateNodeContent } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { deleteEdge, deleteNode } from "../../src/core/parser.js";
import { readEvents } from "../../src/core/eventlog.js";
import { updateGraph, writeGraph } from "../../src/core/parser.js";
import { withLockSync } from "../../src/core/lock.js";
import { NodeType, NodeStatus, EdgeType } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-snap-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function buildGraph() {
  // 先写基础 graph.yaml（模拟 graph init），updateGraph 才能工作
  writeGraph(tmpDir, {
    id: "g1",
    version: "0.2.0",
    label: "t",
    entry: { description: "", defined_by: "human", level: 0 },
    exit: { description: "", acceptance_criteria: [], defined_by: "human", level: 0 },
    nodes: [],
    edges: [],
  });
  updateGraph(tmpDir, {
    label: "测试图",
    entry_description: "入口需求",
    exit_description: "交付标准",
    add_criteria: ["c1"],
  });
  createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
  createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
  createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
}

describe("snapshot", () => {
  it("创建快照 → 文件完整复制 + manifest 可读", () => {
    buildGraph();
    const snap = createSnapshot(tmpDir, "基线");
    expect(snap.message).toBe("基线");
    expect(snap.files.length).toBeGreaterThanOrEqual(3); // graph.yaml + 2 nodes + 1 edge
    expect(fs.existsSync(path.join(tmpDir, ".graph/snapshots", snap.id, "manifest.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".graph/snapshots", snap.id, "nodes/a.yaml"))).toBe(true);
    const list = listSnapshots(tmpDir);
    expect(list.map((s) => s.id)).toContain(snap.id);
  });

  it("diff：新增/删除/修改 + 状态变化", () => {
    buildGraph();
    const snap = createSnapshot(tmpDir, "v1");
    // 修改：新增节点 c、删除边 e1、改节点 a 状态
    createNode(tmpDir, { id: "c", type: NodeType.Task, label: "C" });
    createEdge(tmpDir, { id: "e2", source: "b", target: "c", type: EdgeType.DependsOn });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    const diff = diffSnapshot(tmpDir, snap.id, null);
    expect(diff.added).toContain("nodes/c.yaml");
    expect(diff.added).toContain("edges/e2.yaml");
    expect(diff.modified).toContain("nodes/a.yaml");
    expect(diff.status_changes).toContainEqual({ node: "a", from: "pending", to: "ready" });
    // 反向 diff：从 working 看快照，c 是 removed
    const reverse = diffSnapshot(tmpDir, null, snap.id);
    expect(reverse.removed).toContain("nodes/c.yaml");
  });

  it("rollback：需要显式 confirm；回滚后状态复原且自动备份", () => {
    buildGraph();
    const snap = createSnapshot(tmpDir, "v1");
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    expect(getNode(tmpDir, "a").status).toBe("ready");

    // 无 confirm → 拒绝
    expect(() => rollbackToSnapshot(tmpDir, snap.id)).toThrow("confirm");

    const { restored, backup } = rollbackToSnapshot(tmpDir, snap.id, { confirm: true });
    expect(restored.id).toBe(snap.id);
    expect(getNode(tmpDir, "a").status).toBe("pending");
    // 自动备份了回滚前的状态
    expect(listSnapshots(tmpDir).map((s) => s.id)).toContain(backup.id);
  });

  it("rollback 不存在的快照 → 报错", () => {
    buildGraph();
    expect(() => rollbackToSnapshot(tmpDir, "ghost", { confirm: true })).toThrow(
      "not found",
    );
  });

  it("快照间 diff（snapshot vs snapshot）", () => {
    buildGraph();
    const v1 = createSnapshot(tmpDir, "v1");
    createNode(tmpDir, { id: "c", type: NodeType.Task, label: "C" });
    const v2 = createSnapshot(tmpDir, "v2");
    const diff = diffSnapshot(tmpDir, v1.id, v2.id);
    expect(diff.added).toContain("nodes/c.yaml");
    expect(diff.removed).toEqual([]);
  });

  it("FIX-E1 快照持全局锁：锁被占用时 createSnapshot 超时报错，释放后成功", () => {
    buildGraph();
    // 模拟另一个进程正在做快照/回滚（持 __snapshot__ 锁不放）
    const lock = withLockSync(tmpDir, "__snapshot__", () => {
      // 锁内尝试再快照 → 互斥，3s 默认超时后 LockTimeoutError
      expect(() => createSnapshot(tmpDir, "concurrent")).toThrow("Lock timeout");
    });
    void lock;
    // 锁已释放：快照恢复正常
    const snap = createSnapshot(tmpDir, "after-release");
    expect(snap.files.length).toBeGreaterThanOrEqual(3);
  }, 15_000);

  it("FIX-C2 design-only 回滚：恢复设计字段、保留执行进度、删除快照后新增节点", () => {
    buildGraph();
    // 设计基线：a 有旧 plan
    updateNodeContent(tmpDir, "a", { plan: { description: "旧计划" } }, { actor: "cli" });
    const snap = createSnapshot(tmpDir, "design-baseline");

    // 快照后：执行推进（a 走到 running + checkpoint + 报告）+ 设计被改坏 + 新增节点 c
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running, "agent-1");
    updateNodeContent(tmpDir, "a", { plan: { description: "被改坏的新计划" } }, { actor: "cli" });
    updateNodeContent(tmpDir, "a", { assigned_to: "agent-1" }, { actor: "cli" });
    createNode(tmpDir, { id: "c", type: NodeType.Task, label: "C" });

    const { restored } = rollbackToSnapshot(tmpDir, snap.id, {
      confirm: true,
      designOnly: true,
      actor: "cli",
    });
    expect(restored.id).toBe(snap.id);

    // 设计字段已恢复
    const a = getNode(tmpDir, "a");
    expect(a.plan?.description).toBe("旧计划");
    // 执行进度保留：status/assigned_to/started_at
    expect(a.status).toBe("running");
    expect(a.assigned_to).toBe("agent-1");
    expect(a.execution_report?.started_at).toBeTruthy();
    // 快照后新增节点被删除
    expect(() => getNode(tmpDir, "c")).toThrow();
    // 事件日志记录 design_only 标记
    const events = readEvents(tmpDir, { kind: "rollback" });
    expect(events).toHaveLength(1);
    expect(events[0].detail).toContain("design_only=true");
    expect(events[0].detail).toContain("removed=[c]");
  });

  it("FIX-C2 design-only：当前缺失的节点从快照全量恢复", () => {
    buildGraph();
    const snap = createSnapshot(tmpDir, "v1");
    // 快照后删掉节点 b（设计回退想把它找回来）
    deleteEdge(tmpDir, "e1");
    deleteNode(tmpDir, "b");
    rollbackToSnapshot(tmpDir, snap.id, { confirm: true, designOnly: true });
    const b = getNode(tmpDir, "b");
    expect(b.label).toBe("B");
  });

  it("FIX-E1 rollback 与快照共用同一把锁（备份不重入死锁）", () => {
    buildGraph();
    const snap = createSnapshot(tmpDir, "v1");
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    // rollback 内部做 pre-rollback 备份快照——若备份走带锁入口会自锁死；
    // 此处能在超时内完成即证明无重入死锁
    const { restored } = rollbackToSnapshot(tmpDir, snap.id, { confirm: true });
    expect(restored.id).toBe(snap.id);
    expect(getNode(tmpDir, "a").status).toBe("pending");
  });
});
