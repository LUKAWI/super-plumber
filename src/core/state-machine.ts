import { NodeStatus, type NodeSchema, type Checkpoint } from "./types.js";

// 允许的转换表：每个状态 → 可以转换到的状态列表
// v0.3 新增：
// - running → pending：死认领回收（agent 崩溃后由主控/人类收回节点）
// - cancelled → pending：重开（attempts 归零；修复"取消即永久作废"的毒节点问题）
const TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  [NodeStatus.Pending]:   [NodeStatus.Ready, NodeStatus.Cancelled],
  [NodeStatus.Ready]:     [NodeStatus.Running, NodeStatus.Cancelled],
  [NodeStatus.Running]:   [NodeStatus.Passed, NodeStatus.Failed, NodeStatus.Pending, NodeStatus.Cancelled],
  [NodeStatus.Passed]:    [NodeStatus.Blocked, NodeStatus.Cancelled],
  [NodeStatus.Failed]:    [NodeStatus.Pending, NodeStatus.Cancelled],  // failed → pending 表示重试
  [NodeStatus.Blocked]:   [NodeStatus.Ready, NodeStatus.Failed, NodeStatus.Cancelled],
  [NodeStatus.Cancelled]: [NodeStatus.Pending],
};

export function canTransition(from: NodeStatus, to: NodeStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(status: NodeStatus): NodeStatus[] {
  return [...(TRANSITIONS[status] ?? [])];
}

/**
 * passed 硬门禁（v0.3）：把协议层约定升级为核心层约束。
 * running → passed 前必须满足：
 * 1. execution_report.summary 非空（"无报告标 passed 是撒谎"）；
 * 2. 已有 failed 裁决时拒绝（verification.verdict === "failed"）；
 * 3. 有 checkpoints 时全部 passed/skipped（failed 或未完成都拒绝）。
 * --force 仅人类运维可用。
 */
export function assertPassedEligible(node: NodeSchema): void {
  const report = node.execution_report;
  if (
    !report ||
    typeof report.summary !== "string" ||
    report.summary.trim() === ""
  ) {
    throw new Error(
      `Node ${node.id} 无执行报告（execution_report.summary 为空），不能标记 passed。` +
        `先填写交接单（graph_update_execution_report），确需强制（仅人类运维）请用 --force`,
    );
  }
  if (report.verification?.verdict === "failed") {
    throw new Error(
      `Node ${node.id} 已有 failed 裁决，不能标记 passed。请修复缺陷并重新裁决`,
    );
  }
  if (node.checkpoints && node.checkpoints.length > 0) {
    const hasFailed = node.checkpoints.some((c) => c.status === "failed");
    const hasIncomplete = node.checkpoints.some(
      (c) => c.status !== "passed" && c.status !== "skipped",
    );
    if (hasFailed) {
      throw new Error(
        `Node ${node.id} 存在 failed checkpoint，不能标记 passed`,
      );
    }
    if (hasIncomplete) {
      throw new Error(
        `Node ${node.id} 存在未完成 checkpoint，不能标记 passed。` +
          `全部 checkpoint passed/skipped 后才能完成`,
      );
    }
  }
}

export function transition(
  node: NodeSchema,
  to: NodeStatus,
  opts: { force?: boolean } = {},
): NodeSchema {
  if (!canTransition(node.status, to)) {
    throw new Error(
      `Invalid transition: ${node.status} → ${to}. ` +
      `Allowed: [${getAllowedTransitions(node.status).join(", ")}]`
    );
  }
  // max_attempts 硬拦截：failed → pending 重试前检查次数上限（max_attempts=0 表示不限）
  if (
    node.status === NodeStatus.Failed &&
    to === NodeStatus.Pending &&
    !opts.force &&
    node.max_attempts > 0 &&
    node.attempts >= node.max_attempts
  ) {
    throw new Error(
      `Node ${node.id} 已达最大重试次数 (${node.attempts}/${node.max_attempts})，` +
        `请人工介入。确需强制重试请使用 --force（仅人类运维）`
    );
  }
  // passed 硬门禁：无执行报告 / failed 裁决 / checkpoint 未聚合时拒绝
  if (to === NodeStatus.Passed && !opts.force) {
    assertPassedEligible(node);
  }
  return {
    ...node,
    status: to,
    updated_at: new Date().toISOString(),
    // failed → pending 重试时 attempts++
    ...(node.status === NodeStatus.Failed && to === NodeStatus.Pending
      ? { attempts: node.attempts + 1 }
      : {}),
    // cancelled → pending 重开时 attempts 归零（全新开始）
    ...(node.status === NodeStatus.Cancelled && to === NodeStatus.Pending
      ? { attempts: 0 }
      : {}),
  };
}

// ponytail: 检查点聚合状态——全部 passed 才返回 'passed'
export function aggregateCheckpointStatus(
  checkpoints: Checkpoint[]
): "passed" | "running" | "pending" | "failed" {
  if (checkpoints.length === 0) return "pending";
  if (checkpoints.some((c) => c.status === "failed")) return "failed";
  if (checkpoints.every((c) => c.status === "passed")) return "passed";
  if (checkpoints.some((c) => c.status === "running")) return "running";
  return "pending";
}
