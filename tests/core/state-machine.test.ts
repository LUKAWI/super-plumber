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
    [NodeStatus.Running, NodeStatus.Pending], // v0.3: 死认领回收
    [NodeStatus.Cancelled, NodeStatus.Pending], // v0.3: 重开
  ])("允许 %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  // ── 非法转换 ──
  it.each([
    [NodeStatus.Pending, NodeStatus.Passed], // 跳级
    [NodeStatus.Pending, NodeStatus.Failed], // 跳级
    [NodeStatus.Passed, NodeStatus.Running], // 单向
    [NodeStatus.Cancelled, NodeStatus.Ready], // 重开只能回 pending
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

  it("cancelled → pending 重开时 attempts 归零", () => {
    const node = makeNode({ status: NodeStatus.Cancelled, attempts: 5 });
    const result = transition(node, NodeStatus.Pending);
    expect(result.status).toBe(NodeStatus.Pending);
    expect(result.attempts).toBe(0);
  });

  it("running → pending 回收时 attempts 不变", () => {
    const node = makeNode({ status: NodeStatus.Running, attempts: 2 });
    const result = transition(node, NodeStatus.Pending);
    expect(result.attempts).toBe(2);
  });

  it("非法转换抛出错误", () => {
    const node = makeNode();
    expect(() => transition(node, NodeStatus.Passed)).toThrow(
      "Invalid transition",
    );
  });

  // ── passed 硬门禁（v0.3）──
  const runningNode = (overrides: Partial<NodeSchema> = {}) =>
    makeNode({ status: NodeStatus.Running, ...overrides });

  it("无执行报告 → 拒绝 passed", () => {
    expect(() => transition(runningNode(), NodeStatus.Passed)).toThrow(
      "无执行报告",
    );
  });

  it("execution_report.summary 为空 → 拒绝 passed", () => {
    expect(() =>
      transition(
        runningNode({ execution_report: { summary: "  " } }),
        NodeStatus.Passed,
      ),
    ).toThrow("无执行报告");
  });

  it("有执行报告 → passed 放行", () => {
    const result = transition(
      runningNode({ execution_report: { summary: "完成" } }),
      NodeStatus.Passed,
    );
    expect(result.status).toBe(NodeStatus.Passed);
  });

  it("failed 裁决 → 拒绝 passed", () => {
    expect(() =>
      transition(
        runningNode({
          execution_report: {
            summary: "完成",
            verification: { verdict: "failed", note: "产物缺失" },
          },
        }),
        NodeStatus.Passed,
      ),
    ).toThrow("failed 裁决");
  });

  it("checkpoint 未聚合 → 拒绝 passed", () => {
    expect(() =>
      transition(
        runningNode({
          execution_report: { summary: "完成" },
          checkpoints: [
            { id: "c1", label: "c1", status: "passed", verifier: "auto" },
            { id: "c2", label: "c2", status: "pending", verifier: "auto" },
          ],
        }),
        NodeStatus.Passed,
      ),
    ).toThrow("未完成 checkpoint");
  });

  it("checkpoint 全 passed/skipped → passed 放行", () => {
    const result = transition(
      runningNode({
        execution_report: { summary: "完成" },
        checkpoints: [
          { id: "c1", label: "c1", status: "passed", verifier: "auto" },
          { id: "c2", label: "c2", status: "skipped", verifier: "auto" },
        ],
      }),
      NodeStatus.Passed,
    );
    expect(result.status).toBe(NodeStatus.Passed);
  });

  it("--force 绕过 passed 硬门禁（仅人类运维）", () => {
    const result = transition(runningNode(), NodeStatus.Passed, { force: true });
    expect(result.status).toBe(NodeStatus.Passed);
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

  it("cancelled 可重开：唯一出口是 pending", () => {
    expect(getAllowedTransitions(NodeStatus.Cancelled)).toEqual([
      NodeStatus.Pending,
    ]);
  });
});
