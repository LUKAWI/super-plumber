// src/core/node.ts
import {
  type NodeSchema,
  NodeStatus,
  type NodeType,
  type Checkpoint,
  GATE_EDGE_TYPES,
} from "./types.js";
import { readNode, writeNode, nodeFilePath, addGraphRef } from "./parser.js";
import { transition } from "./state-machine.js";
import { withLockSync } from "./lock.js";
import {
  assertCheckpointTransition,
  CHECKPOINT_STATUSES,
} from "./checkpoint.js";
import { listNodeFileNames } from "./schema.js";
import { buildGraphIndex } from "./index-service.js";
import { appendEvent } from "./eventlog.js";
import * as fs from "node:fs";

export { GATE_EDGE_TYPES } from "./types.js";

export type CreateNodeParams = {
  id: string;
  type: NodeType;
  label: string;
  level?: number;
  priority?: number;
  plan_description?: string;
  definition_of_done?: string[];
  assigned_to?: string;
  max_attempts?: number;
  checkpoints?: Checkpoint[];
};

export function createNode(
  rootDir: string,
  params: CreateNodeParams,
  opts: { syncRef?: boolean; actor?: string } = {},
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
      ...(params.priority !== undefined ? { priority: params.priority } : {}),
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
    appendEvent(rootDir, {
      actor: opts.actor ?? "unknown",
      kind: "node_created",
      node: node.id,
      to: NodeStatus.Pending,
    });
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
//
// 性能：拓扑信息来自缓存索引的 gateReverseAdj（O(1) 查表 + 精确 mtime 新鲜度校验），
// 前驱状态按需直读少数前驱文件（保证跨进程写入下状态永远新鲜）。
// 10k 图从"每查一次全扫 2 万文件（~9s）"降为"~0.4s stat + k 次单文件读"。

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
  const index = buildGraphIndex(rootDir, { useCache: true });
  const sources = index.gateReverseAdj.get(nodeId) ?? [];
  if (sources.length === 0) return { ok: true, unmet: [] };

  // 前驱状态直读文件：不信任缓存内容（跨进程写入下保持门禁精确性）
  const statuses = new Map<string, string>();
  for (const src of sources) {
    try {
      statuses.set(src, getNode(rootDir, src).status);
    } catch {
      statuses.set(src, "missing");
    }
  }

  const unmet: GateUnmet[] = [];
  for (const src of sources) {
    const status = statuses.get(src)!;
    if (status === NodeStatus.Passed) continue;
    // 仅未满足前驱需要 edgeType（错误路径才扫边，热路径保持 O(k)）
    const edgeType =
      index.edges.find(
        (e) =>
          e.source === src &&
          e.target === nodeId &&
          GATE_EDGE_TYPES.includes(e.type),
      )?.type ?? "gate";
    unmet.push({ id: src, status, edgeType });
  }
  return { ok: unmet.length === 0, unmet };
}

export function updateNodeStatus(
  rootDir: string,
  id: string,
  to: NodeStatus,
  claimBy?: string, // claim 语义：ready→running 时记录执行者
  opts: { force?: boolean; actor?: string } = {},
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
    // 审计：force 越权单独留痕（谁在何时绕过了哪条硬规则）
    if (opts.force) {
      appendEvent(rootDir, {
        actor: opts.actor ?? claimBy ?? "unknown",
        kind: "force_override",
        node: id,
        from: node.status,
        to,
        detail: `绕过 ready 门禁/max_attempts/passed 硬门禁（原状态 ${node.status} → ${to}）`,
      });
    }
    appendEvent(rootDir, {
      actor: opts.actor ?? claimBy ?? "unknown",
      kind: "node_status",
      node: id,
      from: node.status,
      to,
      ...(to === NodeStatus.Running && claimBy
        ? { detail: `claim by ${claimBy}` }
        : {}),
    });
    return updated;
  });
}

/**
 * 回收死认领：running → pending（attempts 不变），清空 assigned_to，
 * 在 execution_report.notes 追加带时间戳的回收记录。
 * agent 崩溃 / 长时无进展后由主控或人类调用，恢复被毒节点阻塞的下游。
 */
export function reclaimNode(rootDir: string, id: string, by?: string): NodeSchema {
  return withLockSync(rootDir, id, () => {
    const node = getNode(rootDir, id);
    if (node.status !== NodeStatus.Running) {
      throw new Error(
        `Node ${id} 当前状态为 ${node.status}，只有 running 节点可回收（死认领恢复）`,
      );
    }
    const updated = transition(node, NodeStatus.Pending);
    updated.assigned_to = undefined;
    const prev = node.execution_report?.notes ?? "";
    const note =
      `[reclaim] ${new Date().toISOString()}${by ? ` by ${by}` : ""}: ` +
      `回收死认领（原执行者 ${node.assigned_to ?? "unknown"}）`;
    updated.execution_report = {
      ...(updated.execution_report ?? { summary: "" }),
      notes: prev ? `${prev}\n${note}` : note,
    };
    writeNode(rootDir, updated);
    appendEvent(rootDir, {
      actor: by ?? "unknown",
      kind: "node_reclaimed",
      node: id,
      from: NodeStatus.Running,
      to: NodeStatus.Pending,
      detail: `原执行者 ${node.assigned_to ?? "unknown"}`,
    });
    return updated;
  });
}

export function updateExecutionReport(
  rootDir: string,
  id: string,
  report: Partial<NonNullable<NodeSchema["execution_report"]>>,
  opts: { actor?: string } = {},
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
    appendEvent(rootDir, {
      actor: opts.actor ?? "unknown",
      kind: "execution_report",
      node: id,
      ...(report.verification
        ? {
            kind: "verdict" as const,
            detail: `verdict=${report.verification.verdict}`,
          }
        : {}),
    });
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
  opts: { actor?: string; resetAttempts?: boolean } = {},
): NodeSchema {
  return withLockSync(rootDir, id, () => {
    const node = getNode(rootDir, id);
    const updated: NodeSchema = {
      ...node,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    // FIX-A2（评审 A 级·自我豁免后门）：attempts 重置必须显式请求，
    // 且无论通过何种通道都写入 attempts_reset 审计事件。
    // 旧规则"修改 plan.description 自动重置"已移除——agent 可借此无限清零重试计数。
    let attemptsReset = false;
    if (opts.resetAttempts && node.attempts > 0) {
      updated.attempts = 0;
      attemptsReset = true;
    }
    writeNode(rootDir, updated);
    appendEvent(rootDir, {
      actor: opts.actor ?? "unknown",
      kind: "node_content_updated",
      node: id,
      detail: `fields: ${Object.keys(updates).join(", ")}`,
    });
    if (attemptsReset) {
      appendEvent(rootDir, {
        actor: opts.actor ?? "unknown",
        kind: "attempts_reset",
        node: id,
        from: String(node.attempts),
        to: "0",
        detail: "显式重置（reset_attempts）",
      });
    }
    return updated;
  });
}

export function updateCheckpoint(
  rootDir: string,
  nodeId: string,
  cpId: string,
  status: Checkpoint["status"],
  opts: { actor?: string } = {},
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
    const cpFrom = cp.status;
    cp.status = status;
    node.updated_at = new Date().toISOString();
    writeNode(rootDir, node);
    appendEvent(rootDir, {
      actor: opts.actor ?? "unknown",
      kind: "checkpoint_updated",
      node: nodeId,
      from: cpFrom,
      to: status,
      detail: `checkpoint=${cpId}`,
    });
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
  set_priority?: number;
  /** FIX-A2：显式重置 attempts（由 CLI --reset-attempts / MCP reset_attempts 传入，
   * buildNodeUpdates 不消费此字段——由调用方转为 updateNodeContent 的 opts.resetAttempts） */
  reset_attempts?: boolean;
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
  if (params.set_priority !== undefined) {
    updates.priority = params.set_priority;
  }
  return updates as Partial<
    Pick<
      NodeSchema,
      | "plan"
      | "expected_outcome"
      | "checkpoints"
      | "assigned_to"
      | "label"
      | "max_attempts"
      | "priority"
    >
  >;
}
