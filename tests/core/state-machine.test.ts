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

  it("cancelled → pending 重开时 attempts 保留（N5：重开≠重置预算）", () => {
    // 旧语义是"预算内重开=全新开始（attempts 归零）"——这让 fail→cancel→reopen
    // 循环每轮清空计数、永远到不了 max_attempts，令 f8 的重开门禁形同虚设（N5）。
    // 现与 running→pending 死认领回收对齐：恢复执行资格，不动预算计数。
    const node = makeNode({ status: NodeStatus.Cancelled, attempts: 2 });
    const result = transition(node, NodeStatus.Pending);
    expect(result.status).toBe(NodeStatus.Pending);
    expect(result.attempts).toBe(2);
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

// ── S1-5：cancelled→pending 两跳绕过封堵 ──
describe("S1-5 cancelled→pending 重开的上限拦截", () => {
  it("attempts ≥ max_attempts 时 cancelled→pending 被拒（两跳绕过封堵）", () => {
    const node = makeNode({ status: NodeStatus.Cancelled, attempts: 3, max_attempts: 3 });
    expect(() => transition(node, NodeStatus.Pending)).toThrow(/最大重试次数/);
  });

  it("预算内重开合法且 attempts 保留（N5：与回收语义对齐）", () => {
    const node = makeNode({ status: NodeStatus.Cancelled, attempts: 1, max_attempts: 3 });
    const r = transition(node, NodeStatus.Pending);
    expect(r.status).toBe(NodeStatus.Pending);
    expect(r.attempts).toBe(1);
  });

  it("max_attempts=0（不限）不受拦截且 attempts 保留", () => {
    const node = makeNode({ status: NodeStatus.Cancelled, attempts: 99, max_attempts: 0 });
    const r = transition(node, NodeStatus.Pending);
    expect(r.status).toBe(NodeStatus.Pending);
    expect(r.attempts).toBe(99);
  });

  it("force 可越界重开（人类运维通道，node.ts 侧留 force_override 审计）", () => {
    const node = makeNode({ status: NodeStatus.Cancelled, attempts: 3, max_attempts: 3 });
    const r = transition(node, NodeStatus.Pending, { force: true });
    expect(r.status).toBe(NodeStatus.Pending);
    expect(r.attempts).toBe(3); // N5：force 重开同样不重置预算（人为决策只留痕、不清账）
  });

  it("完整两跳链路演示：failed→cancelled 放行、cancelled→pending 被拦（绕过死路）", () => {
    const failed = makeNode({ status: NodeStatus.Failed, attempts: 3, max_attempts: 3 });
    const cancelled = transition(failed, NodeStatus.Cancelled); // 第一跳不拦（取消是合法动作）
    expect(cancelled.status).toBe(NodeStatus.Cancelled);
    expect(() => transition(cancelled, NodeStatus.Pending)).toThrow(/上限约束/); // 第二跳拦截
  });
});

// ── N5（f19）：fail→cancel→reopen 续命循环封堵（reopen 保留 attempts）──
describe("N5 cancelled→pending 保留 attempts（续命循环封堵）", () => {
  const run = (n: NodeSchema): NodeSchema =>
    transition(transition(n, NodeStatus.Ready), NodeStatus.Running);

  it("max_attempts=2 完整续命循环：预算耗尽后 reopen 被拒，force 语义不受影响", () => {
    // 第一轮失败后（attempts=1）走 cancel→reopen：attempts 保留 1，因 1<2 允许重开
    let node = makeNode({ status: NodeStatus.Failed, attempts: 1, max_attempts: 2 });
    node = transition(node, NodeStatus.Cancelled);
    expect(node.attempts).toBe(1);
    node = transition(node, NodeStatus.Pending); // 预算内重开放行
    expect(node.attempts).toBe(1);

    // 重开后再执行、再失败、重试（failed→pending attempts++ → 2）
    node = transition(run(node), NodeStatus.Failed);
    node = transition(node, NodeStatus.Pending);
    expect(node.attempts).toBe(2);

    // 预算耗尽：正常重试被拦；两跳绕过（fail→cancel→reopen）同样被拦
    node = transition(run(node), NodeStatus.Failed);
    expect(() => transition(node, NodeStatus.Pending)).toThrow(/最大重试次数/);
    const cancelled = transition(node, NodeStatus.Cancelled);
    expect(cancelled.attempts).toBe(2); // 取消不清预算
    expect(() => transition(cancelled, NodeStatus.Pending)).toThrow(/上限约束/);

    // force 语义不受影响：越界重开走人类运维通道（node.ts 侧留 force_override 审计）
    const forced = transition(cancelled, NodeStatus.Pending, { force: true });
    expect(forced.status).toBe(NodeStatus.Pending);
    expect(forced.attempts).toBe(2);
  });

  it("max_attempts=0（不限重试）边界：reopen 恒允许且 attempts 保留", () => {
    const node = makeNode({ status: NodeStatus.Cancelled, attempts: 42, max_attempts: 0 });
    const r = transition(node, NodeStatus.Pending);
    expect(r.status).toBe(NodeStatus.Pending);
    expect(r.attempts).toBe(42);
  });
});

// ── S2-4：聚合判定与 assertPassedEligible 对齐 ──
describe("S2-4 checkpoint 聚合：skipped 视为已完结", () => {
  const cp = (status: "pending" | "running" | "passed" | "failed" | "skipped") =>
    ({ id: "c", label: "c", status, verifier: "auto" }) as never;

  it("[passed, skipped] 混合 → passed（曾误报 pending）", () => {
    expect(aggregateCheckpointStatus([cp("passed"), cp("skipped")])).toBe("passed");
  });

  it("[skipped] 全跳过 → passed", () => {
    expect(aggregateCheckpointStatus([cp("skipped"), cp("skipped")])).toBe("passed");
  });

  it("[passed, skipped, pending] → pending；[passed, running] → running", () => {
    expect(aggregateCheckpointStatus([cp("passed"), cp("skipped"), cp("pending")])).toBe("pending");
    expect(aggregateCheckpointStatus([cp("passed"), cp("running")])).toBe("running");
  });

  it("failed 优先级不变", () => {
    expect(aggregateCheckpointStatus([cp("passed"), cp("failed"), cp("skipped")])).toBe("failed");
  });
});
