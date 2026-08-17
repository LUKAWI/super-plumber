// tests/core/reclaim.test.ts — 死认领回收 / cancelled 重开 / passed 硬门禁（核心层集成）
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createNode,
  updateNodeStatus,
  updateExecutionReport,
  updateCheckpoint,
  reclaimNode,
  getNode,
} from "../../src/core/node.js";
import { NodeType, NodeStatus } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-reclaim-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("reclaimNode（死认领回收）", () => {
  it("running → pending：清空 assigned_to，notes 附回收记录", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "t1", NodeStatus.Running, "dead-agent");
    const n = reclaimNode(tmpDir, "t1", "super-mario");
    expect(n.status).toBe(NodeStatus.Pending);
    expect(n.assigned_to).toBeUndefined();
    expect(n.execution_report?.notes).toContain("[reclaim]");
    expect(n.execution_report?.notes).toContain("dead-agent");
    expect(n.execution_report?.notes).toContain("super-mario");
    // 回收后可重新走生命周期
    const re = updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    expect(re.status).toBe(NodeStatus.Ready);
  });

  it("非 running 节点不可回收", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    expect(() => reclaimNode(tmpDir, "t1")).toThrow("只有 running 节点可回收");
  });

  it("回收不触发 attempts 增加", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "t1", NodeStatus.Running, "dead-agent");
    const n = reclaimNode(tmpDir, "t1");
    expect(n.attempts).toBe(0);
  });
});

describe("cancelled 重开（毒节点修复）", () => {
  it("cancelled → pending：attempts 归零，可重新执行", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "t1", NodeStatus.Running, "agent-x");
    updateNodeStatus(tmpDir, "t1", NodeStatus.Cancelled);
    const n = updateNodeStatus(tmpDir, "t1", NodeStatus.Pending);
    expect(n.attempts).toBe(0);
    expect(updateNodeStatus(tmpDir, "t1", NodeStatus.Ready).status).toBe("ready");
  });
});

describe("passed 硬门禁（updateNodeStatus 集成）", () => {
  it("无执行报告标 passed 被核心拒绝", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "t1", NodeStatus.Running, "agent-x");
    expect(() => updateNodeStatus(tmpDir, "t1", NodeStatus.Passed)).toThrow(
      "无执行报告",
    );
    expect(getNode(tmpDir, "t1").status).toBe(NodeStatus.Running);
  });

  it("checkpoint 未完成标 passed 被核心拒绝", () => {
    createNode(tmpDir, {
      id: "t1",
      type: NodeType.Task,
      label: "T1",
      checkpoints: [{ id: "cp1", label: "c1", status: "pending", verifier: "auto" }],
    });
    updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "t1", NodeStatus.Running, "agent-x");
    updateExecutionReport(tmpDir, "t1", { summary: "完成" });
    expect(() => updateNodeStatus(tmpDir, "t1", NodeStatus.Passed)).toThrow(
      "未完成 checkpoint",
    );
    // 补完 checkpoint 后可 passed
    updateCheckpoint(tmpDir, "t1", "cp1", "passed");
    const done = updateNodeStatus(tmpDir, "t1", NodeStatus.Passed);
    expect(done.status).toBe(NodeStatus.Passed);
  });

  it("failed 裁决后标 passed 被核心拒绝；重新裁决后可放行", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "t1", NodeStatus.Running, "agent-x");
    updateExecutionReport(tmpDir, "t1", {
      summary: "完成",
      verification: { verdict: "failed", note: "产物缺失" },
    });
    expect(() => updateNodeStatus(tmpDir, "t1", NodeStatus.Passed)).toThrow(
      "failed 裁决",
    );
    updateExecutionReport(tmpDir, "t1", {
      verification: { verdict: "passed", note: "修复后抽查通过" },
    });
    const done = updateNodeStatus(tmpDir, "t1", NodeStatus.Passed);
    expect(done.status).toBe(NodeStatus.Passed);
  });

  it("--force 绕过 passed 硬门禁（仅人类运维）", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "t1", NodeStatus.Running, "agent-x");
    const n = updateNodeStatus(tmpDir, "t1", NodeStatus.Passed, undefined, {
      force: true,
    });
    expect(n.status).toBe(NodeStatus.Passed);
  });
});
