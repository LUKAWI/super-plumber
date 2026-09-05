// tests/core/snapshot.test.ts — Snapshot / Diff / Rollback 原语
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import { createGraph } from "../../src/core/graph-dir.js";
import { NodeType, NodeStatus, EdgeType } from "../../src/core/types.js";

// Snapshot 故障注入：只对本测试显式 armed 的 staging/交换步骤失败，
// 其余 fs 行为完全沿用 Node 原实现。
const snapshotFault = { copyStage: false, renameStageNodes: false };
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: (actual as unknown as { default?: object }).default ?? actual,
    copyFileSync: ((...args: Parameters<typeof fs.copyFileSync>) => {
      const destination = String(args[1] ?? "");
      if (snapshotFault.copyStage && destination.includes(".rollback-stage-")) {
        throw new Error("injected snapshot staging copy failure");
      }
      return actual.copyFileSync(...args);
    }) as typeof fs.copyFileSync,
    renameSync: ((...args: Parameters<typeof fs.renameSync>) => {
      const source = String(args[0] ?? "");
      const destination = String(args[1] ?? "");
      if (
        snapshotFault.renameStageNodes &&
        source.includes(".rollback-stage-") &&
        path.basename(destination) === "nodes"
      ) {
        throw new Error("injected snapshot component switch failure");
      }
      return actual.renameSync(...args);
    }) as typeof fs.renameSync,
  };
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-snap-"));
});

afterEach(() => {
  snapshotFault.copyStage = false;
  snapshotFault.renameStageNodes = false;
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
    // S3-10（f16）：manifest 内容是 JSON，文件名同步为 manifest.json
    expect(fs.existsSync(path.join(tmpDir, ".graph/snapshots", snap.id, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".graph/snapshots", snap.id, "manifest.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".graph/snapshots", snap.id, "nodes/a.yaml"))).toBe(true);
    const list = listSnapshots(tmpDir);
    expect(list.map((s) => s.id)).toContain(snap.id);
  });

  it("S3-10 向后兼容：旧名 manifest.yaml 的历史快照仍被 listSnapshots 识别", () => {
    buildGraph();
    const snap = createSnapshot(tmpDir, "旧格式");
    // 模拟 S3-10 之前的历史快照：manifest 落在旧名 manifest.yaml（内容同为 JSON）
    const snapDir = path.join(tmpDir, ".graph/snapshots", snap.id);
    fs.renameSync(
      path.join(snapDir, "manifest.json"),
      path.join(snapDir, "manifest.yaml"),
    );
    // listSnapshots 不瞎：兼容读取旧名
    const list = listSnapshots(tmpDir);
    expect(list.map((s) => s.id)).toContain(snap.id);
    // diff/rollback 走同一 readManifest，历史快照同样可用
    const diff = diffSnapshot(tmpDir, snap.id, null);
    expect(diff.from).toBe(snap.id);
    expect(() =>
      rollbackToSnapshot(tmpDir, snap.id, { confirm: true }),
    ).not.toThrow();
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

    // 备份本身可作为下一次恢复源
    rollbackToSnapshot(tmpDir, backup.id, { confirm: true });
    expect(getNode(tmpDir, "a").status).toBe("ready");
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

  it("FIX-E1+S1-11 快照持图级锁：锁被占用时 createSnapshot 超时报错，释放后成功", () => {
    buildGraph();
    // 模拟另一进程持图级锁不放（f7 起快照/回滚与写路径共持 GRAPH_LOCK，
    // 不再是 FIX-E1 的专用 __snapshot__ 锁）
    const lock = withLockSync(tmpDir, "__graph__", () => {
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

  it("0.9.6 拒绝 snapshot id traversal，且不触碰图外路径", () => {
    buildGraph();
    const outside = path.join(tmpDir, "..", `${path.basename(tmpDir)}-snapshot-outside.txt`);
    fs.writeFileSync(outside, "sentinel", "utf-8");
    try {
      expect(() => diffSnapshot(tmpDir, "../snapshot-outside", null)).toThrow(/快照 ID/);
      expect(() => rollbackToSnapshot(tmpDir, "../snapshot-outside", { confirm: true })).toThrow(/快照 ID/);
      expect(fs.readFileSync(outside, "utf-8")).toBe("sentinel");
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("0.9.6 拒绝 manifest 文件 traversal 与哈希篡改，不创建回滚备份", () => {
    buildGraph();
    const snap = createSnapshot(tmpDir, "安全基线");
    const manifestFile = path.join(tmpDir, ".graph", "snapshots", snap.id, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8")) as {
      files: { file: string; sha256: string }[];
    };
    manifest.files.push({ file: "../../escape.yaml", sha256: "0".repeat(64) });
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf-8");

    expect(() => diffSnapshot(tmpDir, snap.id, null)).toThrow(/文件路径非法/);
    expect(() => rollbackToSnapshot(tmpDir, snap.id, { confirm: true })).toThrow(/文件路径非法/);
    expect(listSnapshots(tmpDir).some((item) => item.id === snap.id)).toBe(false);
    expect(listSnapshots(tmpDir).some((item) => item.message?.includes("pre-rollback"))).toBe(false);
  });

  it("0.9.6 保留软删除归档，回滚后活动实体可恢复", () => {
    buildGraph();
    const snap = createSnapshot(tmpDir, "软删除前");
    deleteNode(tmpDir, "b", { reason: "测试软删除", actor: "test", cascade: true });
    const archived = fs
      .readdirSync(path.join(tmpDir, ".graph", "nodes"))
      .find((name) => name.startsWith("b.deleted") && name.endsWith(".yaml"));
    expect(archived).toBeDefined();

    rollbackToSnapshot(tmpDir, snap.id, { confirm: true });
    expect(getNode(tmpDir, "b").label).toBe("B");
    expect(fs.existsSync(path.join(tmpDir, ".graph", "nodes", archived!))).toBe(true);
  });

  it("0.9.6 多图快照隔离：不能用另一张图的 snapshot id 回滚", () => {
    const graphA = createGraph(tmpDir, "alpha", "Alpha");
    const graphB = createGraph(tmpDir, "beta", "Beta");
    createNode(graphA, { id: "a", type: NodeType.Task, label: "A" });
    createNode(graphB, { id: "b", type: NodeType.Task, label: "B" });
    const snapA = createSnapshot(graphA, "A 基线");

    expect(() => rollbackToSnapshot(graphB, snapA.id, { confirm: true })).toThrow(/not found/);
    expect(getNode(graphB, "b").label).toBe("B");
    expect(listSnapshots(graphA).map((item) => item.id)).toContain(snapA.id);
    expect(listSnapshots(graphB).map((item) => item.id)).not.toContain(snapA.id);
  });

  it("0.9.6 staging 复制失败：原工作区完整保留且无半快照", () => {
    buildGraph();
    const snap = createSnapshot(tmpDir, "复制失败基线");
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    snapshotFault.copyStage = true;
    expect(() => rollbackToSnapshot(tmpDir, snap.id, { confirm: true })).toThrow(/staging copy failure/);

    expect(getNode(tmpDir, "a").status).toBe("ready");
    const graphDir = path.join(tmpDir, ".graph");
    expect(fs.readdirSync(graphDir).some((name) => name.startsWith(".rollback-stage-"))).toBe(false);
    expect(listSnapshots(tmpDir).some((item) => item.message?.includes("pre-rollback"))).toBe(false);
  });

  it("0.9.6 组件切换失败：反向恢复原工作区并保留可恢复备份", () => {
    buildGraph();
    const snap = createSnapshot(tmpDir, "切换失败基线");
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    snapshotFault.renameStageNodes = true;
    expect(() => rollbackToSnapshot(tmpDir, snap.id, { confirm: true })).toThrow(/component switch failure/);

    expect(getNode(tmpDir, "a").status).toBe("ready");
    const graphDir = path.join(tmpDir, ".graph");
    expect(fs.readdirSync(graphDir).some((name) => name.startsWith(".rollback-stage-"))).toBe(false);
    expect(fs.readdirSync(graphDir).some((name) => name.startsWith(".rollback-backup-"))).toBe(false);
    const backups = listSnapshots(tmpDir).filter((item) => item.message?.includes("pre-rollback"));
    expect(backups).toHaveLength(1);
    // 失败后仍可用自动备份恢复当前状态
    snapshotFault.renameStageNodes = false;
    rollbackToSnapshot(tmpDir, backups[0].id, { confirm: true });
    expect(getNode(tmpDir, "a").status).toBe("ready");
  });
});
