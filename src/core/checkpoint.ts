// src/core/checkpoint.ts
// checkpoint 最小状态机：子步骤进度必须有纪律（与节点状态机一致），
// 相同状态重复上报幂等成功（agent 重试友好，重复调用不报错）。
import type { CheckpointStatus } from "./types.js";

const CP_TRANSITIONS: Record<CheckpointStatus, readonly CheckpointStatus[]> = {
  pending: ["running", "passed", "failed", "skipped"],
  running: ["passed", "failed"],
  passed: ["pending"], // 重开
  failed: ["pending"], // 重试
  skipped: ["pending"],
};

export const CHECKPOINT_STATUSES: readonly CheckpointStatus[] = [
  "pending",
  "running",
  "passed",
  "failed",
  "skipped",
];

export function canTransitionCheckpoint(
  from: CheckpointStatus,
  to: CheckpointStatus,
): boolean {
  return from === to || (CP_TRANSITIONS[from]?.includes(to) ?? false);
}

export function assertCheckpointTransition(
  checkpointId: string,
  from: CheckpointStatus,
  to: CheckpointStatus,
): void {
  if (!canTransitionCheckpoint(from, to)) {
    throw new Error(
      `Invalid checkpoint transition: ${checkpointId} ${from} → ${to}. ` +
        `Allowed: [${CP_TRANSITIONS[from]?.join(", ") ?? "none"}]`,
    );
  }
}
