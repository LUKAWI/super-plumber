import { describe, it, expect } from "vitest";
import {
  canTransition,
  transition,
  getAllowedTransitions,
  aggregateCheckpointStatus,
} from "../../src/core/state-machine.js";
import { NodeStatus, NodeType } from "../../src/core/types.js";
import type { NodeSchema } from "../../src/core/types.js";

function makeNode(overrides: Partial<NodeSchema> = {}): NodeSchema {
  return {
    id: "test-node",
    type: NodeType.Task,
    label: "test",
    level: 1,
    status: NodeStatus.Pending,
    attempts: 0,
    max_attempts: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("StateMachine", () => {
  // ── 合法转换 ──
  it.each([
    [NodeStatus.Pending, NodeStatus.Ready],
    [NodeStatus.Ready, NodeStatus.Running],
    [NodeStatus.Running, NodeStatus.Passed],
    [NodeStatus.Running, NodeStatus.Failed],
    [NodeStatus.Passed, NodeStatus.Blocked],
    [NodeStatus.Blocked, NodeStatus.Ready],
    [NodeStatus.Blocked, NodeStatus.Failed],
    [NodeStatus.Failed, NodeStatus.Pending],
    [NodeStatus.Pending, NodeStatus.Cancelled],
    [NodeStatus.Running, NodeStatus.Cancelled],
    [NodeStatus.Ready, NodeStatus.Cancelled],
    [NodeStatus.Passed, NodeStatus.Cancelled],
    [NodeStatus.Failed, NodeStatus.Cancelled],
    [NodeStatus.Blocked, NodeStatus.Cancelled],
  ])("允许 %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  // ── 非法转换 ──
  it.each([
    [NodeStatus.Pending, NodeStatus.Passed], // 跳级
    [NodeStatus.Pending, NodeStatus.Failed], // 跳级
    [NodeStatus.Passed, NodeStatus.Running], // 单向
    [NodeStatus.Cancelled, NodeStatus.Ready], // 终止态不可逆
  ])("禁止 %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("执行转换时更新 updated_at", () => {
    const node = makeNode({ updated_at: "2020-01-01T00:00:00.000Z" });
    const result = transition(node, NodeStatus.Ready);
    expect(result.status).toBe(NodeStatus.Ready);
    expect(result.updated_at).not.toBe(node.updated_at);
  });

  it("failed → pending 时增加 attempts", () => {
    const node = makeNode({ status: NodeStatus.Failed, attempts: 1 });
    const result = transition(node, NodeStatus.Pending);
    expect(result.attempts).toBe(2);
  });

  it("非法转换抛出错误", () => {
    const node = makeNode();
    expect(() => transition(node, NodeStatus.Passed)).toThrow(
      "Invalid transition",
    );
  });

  // ── Checkpoint 聚合 ──
  it("空 checkpoints 返回 pending", () => {
    expect(aggregateCheckpointStatus([])).toBe("pending");
  });

  it("所有 checkpoint passed 才返回 passed", () => {
    expect(
      aggregateCheckpointStatus([
        { id: "c1", label: "c1", status: "passed", verifier: "auto" },
        { id: "c2", label: "c2", status: "passed", verifier: "auto" },
      ]),
    ).toBe("passed");
  });

  it("有 failed 返回 failed", () => {
    expect(
      aggregateCheckpointStatus([
        { id: "c1", label: "c1", status: "passed", verifier: "auto" },
        { id: "c2", label: "c2", status: "failed", verifier: "auto" },
      ]),
    ).toBe("failed");
  });

  it("cancelled 是终止态，无出口", () => {
    expect(getAllowedTransitions(NodeStatus.Cancelled)).toEqual([]);
  });
});
