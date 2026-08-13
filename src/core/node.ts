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
  opts: { syncRef?: boolean } = {},
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
    if (opts.syncRef !== false) addGraphRef(rootDir, "node", node.id);
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
// 进入 ready / 认领(running) 前，所有门控入边的前驱必须全部 passed。
// 门控边类型：depends_on（顺序依赖）、validates（验证）、fan_in（汇聚，全部上游完成）、
// fan_out（"A 完成后 B/C 可并行"——完成语义同样构成前置）。
// cancelled 前驱视为阻塞并点名。--force 可绕过（仅人类运维）。

export const GATE_EDGE_TYPES: readonly string[] = [
  "depends_on",
  "validates",
  "fan_in",
  "fan_out",
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

// ── 节点内容更新（CLI update-node 与 MCP graph_update_node 共享同一语义）──

export interface NodeUpdateParams {
  plan_description?: string;
  add_dod?: string[];
  clear_dod?: boolean;
  add_checkpoints?: {
    id: string;
    label: string;
    status?: Checkpoint["status"];
    verifier?: Checkpoint["verifier"];
  }[];
  set_assigned_to?: string;
  label?: string;
  max_attempts?: number;
}

export function buildNodeUpdates(
  node: NodeSchema,
  params: NodeUpdateParams,
): Partial<
  Pick<
    NodeSchema,
    "plan" | "expected_outcome" | "checkpoints" | "assigned_to" | "label" | "max_attempts"
  >
> {
  const updates: Record<string, unknown> = {};

  if (params.plan_description !== undefined) {
    updates.plan = {
      ...(node.plan
        ? {
            input_from: node.plan.input_from,
            output_to: node.plan.output_to,
            required_context: node.plan.required_context,
          }
        : {}),
      description: params.plan_description,
    };
  }
  if (params.clear_dod) {
    updates.expected_outcome = {
      ...(node.expected_outcome
        ? { quality_gates: node.expected_outcome.quality_gates }
        : {}),
      definition_of_done: [],
    };
  }
  if (params.add_dod && params.add_dod.length > 0) {
    const existing = node.expected_outcome?.definition_of_done ?? [];
    updates.expected_outcome = {
      ...(node.expected_outcome
        ? { quality_gates: node.expected_outcome.quality_gates }
        : {}),
      definition_of_done: [...existing, ...params.add_dod],
    };
  }
  if (params.add_checkpoints && params.add_checkpoints.length > 0) {
    const existing = node.checkpoints ?? [];
    updates.checkpoints = [
      ...existing,
      ...params.add_checkpoints.map((cp) => ({
        id: cp.id,
        label: cp.label,
        status: cp.status ?? ("pending" as const),
        verifier: cp.verifier ?? ("auto" as const),
      })),
    ];
  }
  if (params.set_assigned_to !== undefined) {
    updates.assigned_to = params.set_assigned_to;
  }
  if (params.label !== undefined) {
    updates.label = params.label;
  }
  if (params.max_attempts !== undefined) {
    updates.max_attempts = params.max_attempts;
  }
  return updates as Partial<
    Pick<
      NodeSchema,
      "plan" | "expected_outcome" | "checkpoints" | "assigned_to" | "label" | "max_attempts"
    >
  >;
}
