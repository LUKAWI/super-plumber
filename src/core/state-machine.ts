import { NodeStatus, type NodeSchema, type Checkpoint } from "./types.js";

// 允许的转换表：每个状态 → 可以转换到的状态列表
const TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  [NodeStatus.Pending]:   [NodeStatus.Ready, NodeStatus.Cancelled],
  [NodeStatus.Ready]:     [NodeStatus.Running, NodeStatus.Cancelled],
  [NodeStatus.Running]:   [NodeStatus.Passed, NodeStatus.Failed, NodeStatus.Cancelled],
  [NodeStatus.Passed]:    [NodeStatus.Blocked, NodeStatus.Cancelled],
  [NodeStatus.Failed]:    [NodeStatus.Pending, NodeStatus.Cancelled],  // failed → pending 表示重试
  [NodeStatus.Blocked]:   [NodeStatus.Ready, NodeStatus.Failed, NodeStatus.Cancelled],
  [NodeStatus.Cancelled]: [],  // 终止态
};

export function canTransition(from: NodeStatus, to: NodeStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(status: NodeStatus): NodeStatus[] {
  return [...(TRANSITIONS[status] ?? [])];
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
        `请人工介入。确需强制重试请使用 --force（仅人类运维）`,
    );
  }
  return {
    ...node,
    status: to,
    updated_at: new Date().toISOString(),
    // failed → pending 重试时 attempts++
    ...(node.status === NodeStatus.Failed && to === NodeStatus.Pending
      ? { attempts: node.attempts + 1 }
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
