// tests/core/gate.test.ts — ready 前置门禁
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createNode,
  updateNodeStatus,
  checkReadyGate,
  getNode,
  updateNodeContent,
  updateExecutionReport,
} from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { NodeType, NodeStatus, EdgeType } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-gate-"));
  createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
  createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
  createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("checkReadyGate", () => {
  it("前驱未 passed → 不 ok，点名未满足前驱", () => {
    const gate = checkReadyGate(tmpDir, "b");
    expect(gate.ok).toBe(false);
    expect(gate.unmet).toEqual([{ id: "a", status: "pending", edgeType: "depends_on" }]);
  });

  it("前驱 passed → ok", () => {
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateExecutionReport(tmpDir, "a", { summary: "done" });
    updateNodeStatus(tmpDir, "a", NodeStatus.Passed);
    expect(checkReadyGate(tmpDir, "b").ok).toBe(true);
  });

  it("无门控入边 → ok", () => {
    expect(checkReadyGate(tmpDir, "a").ok).toBe(true);
  });

  it("shares_context / fallback 等运行时边不参与门禁", () => {
    createNode(tmpDir, { id: "c", type: NodeType.Task, label: "C" });
    createEdge(tmpDir, { id: "e2", source: "c", target: "b", type: EdgeType.SharesContext });
    createEdge(tmpDir, { id: "e3", source: "c", target: "b", type: EdgeType.Fallback });
    const gate = checkReadyGate(tmpDir, "b");
    expect(gate.unmet.map((u) => u.edgeType)).toEqual(["depends_on"]);
  });

  it("fan_out 也参与门禁（A 完成后下游才可并行）", () => {
    createNode(tmpDir, { id: "c", type: NodeType.Task, label: "C" });
    createEdge(tmpDir, { id: "e2", source: "c", target: "b", type: EdgeType.FanOut });
    const gate = checkReadyGate(tmpDir, "b");
    expect(gate.unmet.some((u) => u.id === "c" && u.edgeType === "fan_out")).toBe(true);
  });
});

describe("ready gate in updateNodeStatus", () => {
  it("前驱未完成时 pending→ready 被拦截", () => {
    expect(() => updateNodeStatus(tmpDir, "b", NodeStatus.Ready)).toThrow(
      "前置未满足",
    );
  });

  it("前驱完成时 pending→ready 放行", () => {
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateExecutionReport(tmpDir, "a", { summary: "done" });
    updateNodeStatus(tmpDir, "a", NodeStatus.Passed);
    expect(updateNodeStatus(tmpDir, "b", NodeStatus.Ready).status).toBe("ready");
  });

  it("claim（ready→running）也重新校验门禁", () => {
    // 让 b 先绕过门禁进入 ready
    updateNodeStatus(tmpDir, "b", NodeStatus.Ready, undefined, { force: true });
    // 但前驱 a 仍 pending → claim 必须被拦截
    expect(() =>
      updateNodeStatus(tmpDir, "b", NodeStatus.Running, "agent-x"),
    ).toThrow("前置未满足");
  });

  it("cancelled 前驱 → 阻塞并点名", () => {
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Cancelled);
    try {
      updateNodeStatus(tmpDir, "b", NodeStatus.Ready);
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("a(cancelled");
    }
  });

  it("--force 绕过门禁（仅人类运维）", () => {
    const n = updateNodeStatus(tmpDir, "b", NodeStatus.Ready, undefined, {
      force: true,
    });
    expect(n.status).toBe("ready");
  });

  it("fan_in 也参与门禁", () => {
    createNode(tmpDir, { id: "c", type: NodeType.Task, label: "C" });
    createEdge(tmpDir, { id: "e2", source: "c", target: "b", type: EdgeType.FanIn });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateExecutionReport(tmpDir, "a", { summary: "done" });
    updateNodeStatus(tmpDir, "a", NodeStatus.Passed);
    expect(() => updateNodeStatus(tmpDir, "b", NodeStatus.Ready)).toThrow(
      "c(pending, via fan_in)",
    );
  });

  it("幽灵前驱（文件不存在）→ 阻塞并标记 missing", () => {
    // 核心层已拦截幽灵边创建，这里模拟手工编辑写入的幽灵边文件
    fs.writeFileSync(
      path.join(tmpDir, ".graph/edges/e9.yaml"),
      "id: e9\nsource: ghost\ntarget: b\ntype: depends_on\n",
    );
    const gate = checkReadyGate(tmpDir, "b");
    expect(gate.unmet.some((u) => u.id === "ghost" && u.status === "missing")).toBe(true);
  });
});

describe("max_attempts + attempts reset", () => {
  it("failed→pending 超过 max_attempts 被拦截", () => {
    const n = getNode(tmpDir, "a");
    // 直接构造 failed 且 attempts 达上限的节点
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    // attempts=0, max=3 → 重试 3 次到 attempts=3
    for (let i = 0; i < 3; i++) {
      updateNodeStatus(tmpDir, "a", NodeStatus.Pending);
      updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
      updateNodeStatus(tmpDir, "a", NodeStatus.Running);
      updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    }
    expect(getNode(tmpDir, "a").attempts).toBe(3);
    // 第 4 次重试被拦截
    expect(() => updateNodeStatus(tmpDir, "a", NodeStatus.Pending)).toThrow(
      "最大重试次数",
    );
  });

  it("修改 plan 后重试 attempts 重置为 0（CONTEXT 规则）", () => {
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    updateNodeStatus(tmpDir, "a", NodeStatus.Pending);
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    updateNodeStatus(tmpDir, "a", NodeStatus.Pending);
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    expect(getNode(tmpDir, "a").attempts).toBe(2);
    // 修改 plan.description → attempts 重置
    updateNodeContent(tmpDir, "a", { plan: { description: "修正后的新计划" } });
    expect(getNode(tmpDir, "a").attempts).toBe(0);
    // 非 plan 字段更新不重置
    updateNodeStatus(tmpDir, "a", NodeStatus.Pending);
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    updateNodeContent(tmpDir, "a", { assigned_to: "someone" });
    expect(getNode(tmpDir, "a").attempts).toBe(1);
  });

  it("--force 覆盖 max_attempts 拦截", () => {
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    updateNodeStatus(tmpDir, "a", NodeStatus.Pending);
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    updateNodeStatus(tmpDir, "a", NodeStatus.Pending);
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, { force: true });
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    updateNodeStatus(tmpDir, "a", NodeStatus.Pending);
    // attempts=3, max=3 → force 放行并继续累加
    const n = updateNodeStatus(tmpDir, "a", NodeStatus.Ready, undefined, {
      force: true,
    });
    expect(n.status).toBe("ready");
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    const forced = updateNodeStatus(tmpDir, "a", NodeStatus.Pending, undefined, {
      force: true,
    });
    expect(forced.attempts).toBe(4);
  });
});
