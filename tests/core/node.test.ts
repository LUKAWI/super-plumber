// tests/core/node.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createNode,
  getNode,
  updateNodeStatus,
  updateCheckpoint,
  updateExecutionReport,
  listNodes,
} from "../../src/core/node.js";
import { deleteNode, writeNode } from "../../src/core/parser.js";
import { NodeType, NodeStatus } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Node operations", () => {
  it("创建节点并持久化到文件", () => {
    const node = createNode(tmpDir, {
      id: "task_001",
      type: NodeType.Task,
      label: "调研框架",
    });
    expect(node.id).toBe("task_001");
    expect(node.status).toBe(NodeStatus.Pending);
    expect(fs.existsSync(path.join(tmpDir, ".graph/nodes/task_001.yaml"))).toBe(
      true,
    );
  });

  it("通过 getNode 读取", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    const loaded = getNode(tmpDir, "t1");
    expect(loaded.label).toBe("T1");
  });

  it("更新节点状态", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    const updated = updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    expect(updated.status).toBe(NodeStatus.Ready);
    const reloaded = getNode(tmpDir, "t1");
    expect(reloaded.status).toBe(NodeStatus.Ready);
  });

  it("更新 checkpoint 状态", () => {
    createNode(tmpDir, {
      id: "t1",
      type: NodeType.Task,
      label: "T1",
      checkpoints: [
        { id: "cp_01", label: "Step 1", status: "pending", verifier: "auto" },
      ],
    });
    const updated = updateCheckpoint(tmpDir, "t1", "cp_01", "passed");
    expect(updated.checkpoints![0].status).toBe("passed");
  });

  it("listNodes 返回空数组当 .graph 不存在", () => {
    expect(listNodes(tmpDir)).toEqual([]);
  });

  it("listNodes 返回所有节点", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    const nodes = listNodes(tmpDir);
    expect(nodes).toHaveLength(2);
  });

  it("非法状态转换抛出错误", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    expect(() => updateNodeStatus(tmpDir, "t1", NodeStatus.Passed)).toThrow();
  });

  it("不存在的 checkpoint 抛出错误", () => {
    createNode(tmpDir, {
      id: "t1",
      type: NodeType.Task,
      label: "T1",
      checkpoints: [
        { id: "cp_01", label: "S1", status: "pending", verifier: "auto" },
      ],
    });
    expect(() =>
      updateCheckpoint(tmpDir, "t1", "cp_wrong", "passed"),
    ).toThrow();
  });

  it("claim 语义：ready→running 记录 assigned_to 和 started_at", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    const claimed = updateNodeStatus(
      tmpDir,
      "t1",
      NodeStatus.Running,
      "executor-alpha",
    );
    expect(claimed.assigned_to).toBe("executor-alpha");
    expect(claimed.execution_report?.started_at).toBeTruthy();
  });

  it("updateExecutionReport 合并写入交接单", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "t1", NodeStatus.Running, "executor-alpha");
    const reported = updateExecutionReport(tmpDir, "t1", {
      summary: "完成状态机实现",
      artifacts: ["src/core/state-machine.ts"],
    });
    expect(reported.execution_report?.summary).toBe("完成状态机实现");
    expect(reported.execution_report?.artifacts).toHaveLength(1);
    // 保留 claim 时写入的 started_at
    expect(reported.execution_report?.started_at).toBeTruthy();
  });

  it("passed 时记录 completed_at", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "t1", NodeStatus.Running, "executor-alpha");
    updateExecutionReport(tmpDir, "t1", { summary: "完成" });
    const done = updateNodeStatus(tmpDir, "t1", NodeStatus.Passed);
    expect(done.execution_report?.completed_at).toBeTruthy();
  });

  it("重复 id 创建节点时抛出错误（不静默覆盖）", () => {
    createNode(tmpDir, { id: "dup", type: NodeType.Task, label: "First" });
    expect(() =>
      createNode(tmpDir, { id: "dup", type: NodeType.Task, label: "Second" }),
    ).toThrow(/already exists/i);
    // 原节点数据未被覆盖
    expect(getNode(tmpDir, "dup").label).toBe("First");
  });

  it("软删除后 listNodes 不再返回该节点", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    deleteNode(tmpDir, "a");
    const ids = listNodes(tmpDir).map((n) => n.id);
    expect(ids).toEqual(["b"]);
    // .deleted.yaml 历史文件保留
    expect(
      fs.existsSync(path.join(tmpDir, ".graph/nodes/a.deleted.yaml")),
    ).toBe(true);
  });

  it("BUG-03 updateCheckpoint 非法 status 抛错（不静默写入）", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    writeNode(tmpDir, {
      ...getNode(tmpDir, "a"),
      checkpoints: [
        { id: "cp1", label: "Step", status: "pending", verifier: "auto" },
      ],
    });
    expect(() => updateCheckpoint(tmpDir, "a", "cp1", "bogus" as any)).toThrow(
      /非法/,
    );
    // 数据未被污染
    expect(getNode(tmpDir, "a").checkpoints![0].status).toBe("pending");
  });

  it("BUG-13 getNode 不存在 → 友好错误（非 ENOENT 堆栈）", () => {
    expect(() => getNode(tmpDir, "ghost")).toThrow("Node ghost not found");
  });
});
