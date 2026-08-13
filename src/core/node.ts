// src/core/node.ts
import {
  type NodeSchema,
  NodeStatus,
  type NodeType,
  type Checkpoint,
} from "./types.js";
import { readNode, writeNode, nodeFilePath, addGraphRef } from "./parser.js";
import { transition } from "./state-machine.js";
import { withLockSync } from "./lock.js";
import {
  assertCheckpointTransition,
  CHECKPOINT_STATUSES,
} from "./checkpoint.js";
import { listNodeFileNames } from "./schema.js";
import { listEdges } from "./edge.js";
import * as fs from "node:fs";

export type CreateNodeParams = {
  id: string;
  type: NodeType;
  label: string;
  level?: number;
  plan_description?: string;
  definition_of_done?: string[];
  assigned_to?: string;
  max_attempts?: number;
  checkpoints?: Checkpoint[];
};

export function createNode(
  rootDir: string,
  params: CreateNodeParams,
): NodeSchema {
  return withLockSync(rootDir, params.id, () => {
    // 重复 id 检查（锁内）：不静默覆盖已有节点，并发创建也只有一个成功
    if (fs.existsSync(nodeFilePath(rootDir, params.id))) {
      throw new Error(`Node ${params.id} already exists`);
    }
    const now = new Date().toISOString();
    const node: NodeSchema = {
      id: params.id,
      type: params.type,
      label: params.label,
      level: params.level ?? 1,
      status: NodeStatus.Pending,
      plan: params.plan_description
        ? { description: params.plan_description }
        : undefined,
      expected_outcome: params.definition_of_done
        ? { definition_of_done: params.definition_of_done }
        : undefined,
      assigned_to: params.assigned_to,
      attempts: 0,
      max_attempts: params.max_attempts ?? 3,
      created_at: now,
      updated_at: now,
      ...(params.checkpoints ? { checkpoints: params.checkpoints } : {}),
    };
    writeNode(rootDir, node);
    addGraphRef(rootDir, "node", node.id);
    return node;
  });
}

export function getNode(rootDir: string, id: string): NodeSchema {
  try {
    return readNode(rootDir, id);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`Node ${id} not found`);
    }
    throw err;
  }
}

// ── ready 前置门禁 ──
// 进入 ready / 认领(running) 前，所有门控入边（depends_on / validates / fan_in）的
// 前驱必须全部 passed。cancelled 前驱视为阻塞并点名。--force 可绕过（仅人类运维）。

export const GATE_EDGE_TYPES: readonly string[] = [
  "depends_on",
  "validates",
  "fan_in",
];

export interface GateUnmet {
  id: string;
  status: string; // "missing" 表示前驱节点文件不存在
  edgeType: string;
}

export interface GateResult {
  ok: boolean;
  unmet: GateUnmet[];
}

export function checkReadyGate(rootDir: string, nodeId: string): GateResult {
  const edges = listEdges(rootDir);
  const statusOf = new Map(listNodes(rootDir).map((n) => [n.id, n.status]));
  const unmet: GateUnmet[] = [];
  for (const e of edges) {
    if (e.target !== nodeId) continue;
    if (!GATE_EDGE_TYPES.includes(e.type)) continue;
    const status = statusOf.get(e.source);
    if (status !== NodeStatus.Passed) {
      unmet.push({ id: e.source, status: status ?? "missing", edgeType: e.type });
    }
  }
  return { ok: unmet.length === 0, unmet };
}

export function updateNodeStatus(
  rootDir: string,
  id: string,
  to: NodeStatus,
  claimBy?: string, // claim 语义：ready→running 时记录执行者
  opts: { force?: boolean } = {},
): NodeSchema {
  return withLockSync(rootDir, id, () => {
    // 锁内重读：并发 claim 只有一个能通过状态机（原子认领）
    const node = getNode(rootDir, id);

    // 幂等：同一认领者重复 claim 返回成功（agent 重试友好）
    if (to === NodeStatus.Running && node.status === NodeStatus.Running) {
      if (claimBy && node.assigned_to === claimBy) return node;
      throw new Error(
        `Node ${id} already claimed by ${node.assigned_to ?? "unknown"}`,
      );
    }

    // ready 门禁：进入 ready 或认领前，门控前驱必须全部 passed
    if (!opts.force && (to === NodeStatus.Ready || to === NodeStatus.Running)) {
      const gate = checkReadyGate(rootDir, id);
      if (!gate.ok) {
        const list = gate.unmet
          .map((u) => `${u.id}(${u.status}, via ${u.edgeType})`)
          .join(", ");
        throw new Error(
          `Node ${id} 前置未满足，不能进入 ${to}: [${list}]。` +
            `确需强制（仅人类运维）请用 --force`,
        );
      }
    }

    const updated = transition(node, to, { force: opts.force });

    // claim：ready → running，记录 assigned_to + started_at
    if (to === NodeStatus.Running && claimBy) {
      updated.assigned_to = claimBy;
      updated.execution_report = {
        ...(updated.execution_report ?? {}),
        summary: updated.execution_report?.summary ?? "",
        started_at:
          updated.execution_report?.started_at ?? new Date().toISOString(),
      };
    }

    // 节点完成时记录 completed_at
    if (
      (to === NodeStatus.Passed || to === NodeStatus.Failed) &&
      updated.execution_report
    ) {
      updated.execution_report = {
        ...updated.execution_report,
        completed_at: new Date().toISOString(),
      };
    }

    writeNode(rootDir, updated);
    return updated;
  });
}

export function updateExecutionReport(
  rootDir: string,
  id: string,
  report: Partial<NonNullable<NodeSchema["execution_report"]>>,
): NodeSchema {
  return withLockSync(rootDir, id, () => {
    const node = getNode(rootDir, id);
    const merged: NodeSchema = {
      ...node,
      execution_report: {
        ...(node.execution_report ?? { summary: "" }),
        ...report,
      },
      updated_at: new Date().toISOString(),
    };
    writeNode(rootDir, merged);
    return merged;
  });
}

export function updateNodeContent(
  rootDir: string,
  id: string,
  updates: Partial<
    Pick<
      NodeSchema,
      | "plan"
      | "expected_outcome"
      | "checkpoints"
      | "assigned_to"
      | "label"
      | "max_attempts"
      | "execution_report"
    >
  >,
): NodeSchema {
  return withLockSync(rootDir, id, () => {
    const node = getNode(rootDir, id);
    const updated: NodeSchema = {
      ...node,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    // CONTEXT：因修改计划后重试时 attempts 重置为 0
    const planChanged =
      updates.plan !== undefined &&
      (updates.plan.description ?? "") !== (node.plan?.description ?? "");
    if (
      planChanged &&
      node.attempts > 0 &&
      (node.status === NodeStatus.Failed || node.status === NodeStatus.Pending)
    ) {
      updated.attempts = 0;
    }
    writeNode(rootDir, updated);
    return updated;
  });
}

export function updateCheckpoint(
  rootDir: string,
  nodeId: string,
  cpId: string,
  status: Checkpoint["status"],
): NodeSchema {
  // 运行时校验：TS 类型只保护编译期，脚本/手工调用可绕过，必须显式拦截
  if (!CHECKPOINT_STATUSES.includes(status as Checkpoint["status"])) {
    throw new Error(
      `非法 checkpoint 状态: ${status}。允许的值: ${CHECKPOINT_STATUSES.join(", ")}`,
    );
  }
  return withLockSync(rootDir, nodeId, () => {
    const node = getNode(rootDir, nodeId);
    if (!node.checkpoints) throw new Error(`Node ${nodeId} has no checkpoints`);
    const cp = node.checkpoints.find((c) => c.id === cpId);
    if (!cp) throw new Error(`Checkpoint ${cpId} not found in node ${nodeId}`);
    assertCheckpointTransition(cpId, cp.status, status);
    cp.status = status;
    node.updated_at = new Date().toISOString();
    writeNode(rootDir, node);
    return node;
  });
}

export function listNodes(rootDir: string): NodeSchema[] {
  return listNodeFileNames(rootDir).map((f) =>
    readNode(rootDir, f.replace(/\.yaml$/, "")),
  );
}
