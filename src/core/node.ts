// src/core/node.ts
import {
  type NodeSchema,
  NodeStatus,
  AdrStatus,
  NodeType,
  type Checkpoint,
  type Contract,
  GATE_EDGE_TYPES,
} from "./types.js";
import {
  readNode,
  writeNode,
  writeNodeCore,
  nodeFilePath,
  addGraphRefLocked,
  ensureGraphDir,
  withGraphLock,
} from "./graph-io.js";
import { transition } from "./state-machine.js";
import { withLockSync } from "./lock.js";
import {
  assertCheckpointTransition,
  CHECKPOINT_STATUSES,
} from "./checkpoint.js";
import { listNodeFileNames } from "./schema.js";
import { assertValidEntityId } from "./schema.js";
import { buildGraphIndex } from "./index-service.js";
import { governingAdrsFor } from "./domain.js";
import { appendEvent } from "./eventlog.js";
import { withGraphAmend } from "./amend.js";
// arch-c1（C1）：NODE_NOT_FOUND / 门禁 / 非法转换 / 接替者缺失落机器可读 code
import { ErrorCode, GraphError, nodeNotFound } from "./errors.js";
import * as fs from "node:fs";
import { toGraphDir } from "./graph-dir.js";
import { invalidateIndex } from "./index-service.js";

export { GATE_EDGE_TYPES } from "./types.js";

export type CreateNodeParams = {
  id: string;
  type: NodeType;
  label: string;
  level?: number;
  priority?: number;
  /** v0.5：归属的 context 顶点 id（工作流节点用） */
  context?: string;
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
  // S0-3：入口断言（进锁之前）——非法 ID（含 Windows 非法文件名字符）若先进锁，
  // 锁文件名编码不覆盖 * 等字符会在 .locks/ 上 ENOENT 崩掉，报错面目全非
  assertValidEntityId("节点", params.id);
  const graphDir = toGraphDir(rootDir);
  return withLockSync(graphDir, params.id, () => {
    // 重复 id 检查（锁内）：不静默覆盖已有节点，并发创建也只有一个成功
    if (fs.existsSync(nodeFilePath(graphDir, params.id))) {
      throw new Error(`Node ${params.id} already exists`);
    }
    // F21 (a)(b)（C5 组合器）：结构修订守卫——落图前自动快照 + 成功后
    // graph_amended 事件/review 回置。重复 id 拒绝路径（上方）在守卫段之前，
    // 不留快照；batch_create 外层统一守卫，嵌套内层自动免守卫（防快照风暴）。
    return withGraphAmend(
      graphDir,
      { action: "add-node", target: params.id, actor: opts.actor },
      () => {
        const now = new Date().toISOString();
        const node: NodeSchema = {
          id: params.id,
          type: params.type,
          label: params.label,
          level: params.level ?? 1,
          ...(params.priority !== undefined ? { priority: params.priority } : {}),
          ...(params.context !== undefined ? { context: params.context } : {}),
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
        return withGraphLock(graphDir, () => {
          // 与直接 graph-io 写入并发时仍在图锁内复查，避免覆盖同名实体。
          if (fs.existsSync(nodeFilePath(graphDir, params.id))) {
            throw new Error(`Node ${params.id} already exists`);
          }
          ensureGraphDir(graphDir);
          let entityWritten = false;
          try {
            writeNodeCore(graphDir, node);
            entityWritten = true;
            if (opts.syncRef !== false) addGraphRefLocked(graphDir, "node", node.id);
          } catch (error) {
            if (entityWritten) {
              try {
                fs.rmSync(nodeFilePath(graphDir, node.id), { force: true });
                invalidateIndex(graphDir);
              } catch {
                /* best-effort compensation */
              }
            }
            throw error;
          }
          appendEvent(graphDir, {
            actor: opts.actor ?? "unknown",
            kind: "node_created",
            node: node.id,
            to: NodeStatus.Pending,
          });
          return node;
        });
      },
    );
  });
}

export function getNode(rootDir: string, id: string): NodeSchema {
  try {
    return readNode(rootDir, id);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      // arch-c1（C1）：NODE_NOT_FOUND 落地（message 与拆码前逐字一致，entityId 供 CLI 单源渲染）
      throw nodeNotFound(id);
    }
    throw err;
  }
}

// v0.5：节点（含其 context）的管辖 ADR——claim / get-node 时注入的标题级指针。
// 复用缓存索引（O(1) 查表），纯逻辑在 domain.ts 的 governingAdrsFor。
export function getGoverningAdrs(
  rootDir: string,
  nodeId: string,
): ReturnType<typeof governingAdrsFor> {
  const graphDir = toGraphDir(rootDir);
  const index = buildGraphIndex(graphDir, { useCache: true });
  return governingAdrsFor(index.nodes, index.edges, nodeId);
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
  const graphDir = toGraphDir(rootDir);
  const index = buildGraphIndex(graphDir, { useCache: true });
  const sources = index.gateReverseAdj.get(nodeId) ?? [];
  if (sources.length === 0) return { ok: true, unmet: [] };

  // 前驱状态直读文件：不信任缓存内容（跨进程写入下保持门禁精确性）
  const statuses = new Map<string, string>();
  for (const src of sources) {
    try {
      statuses.set(src, getNode(graphDir, src).status);
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
  to: NodeStatus | AdrStatus,
  claimBy?: string, // claim 语义：ready→running 时记录执行者
  opts: { force?: boolean; actor?: string } = {},
): NodeSchema {
  return withLockSync(rootDir, id, () => {
    // 锁内重读：并发 claim 只有一个能通过状态机（原子认领）
    const node = getNode(rootDir, id);

    // v0.5 知识顶点：context 拒绝一切状态变更（无执行语义）
    if (node.type === NodeType.Context) {
      throw new GraphError(
        ErrorCode.InvalidTransition,
        `Node ${id} 是 context 顶点：无状态（status 恒 pending）、无执行语义，不支持任何状态变更`,
      );
    }

    // v0.5 ADR：三态机（proposed→accepted→superseded），不经门禁/claim/completed_at。
    // superseded 前校验接替者真实存在且为 adr 顶点（cross-file，锁内直读保证新鲜）。
    if (node.type === NodeType.Adr) {
      if (to === AdrStatus.Superseded) {
        const by = node.superseded_by;
        if (!by) {
          throw new GraphError(
            ErrorCode.InvalidTransition,
            `ADR ${id} 置 superseded 前必须设置 superseded_by（接替 ADR id）`,
          );
        }
        if (by === id) {
          throw new GraphError(
            ErrorCode.InvalidTransition,
            `ADR ${id} 的 superseded_by 不能指向自身`,
          );
        }
        let succ: NodeSchema;
        try {
          succ = getNode(rootDir, by);
        } catch {
          throw nodeNotFound(by, `ADR ${id} 的 superseded_by 指向的节点不存在: ${by}`);
        }
        if (succ.type !== NodeType.Adr) {
          throw new GraphError(
            ErrorCode.InvalidTransition,
            `ADR ${id} 的 superseded_by 指向的节点不是 adr 顶点: ${by}`,
          );
        }
      }
      const updated = transition(node, to);
      writeNode(rootDir, updated);
      appendEvent(rootDir, {
        actor: opts.actor ?? claimBy ?? "unknown",
        kind:
          to === AdrStatus.Accepted
            ? "adr_accepted"
            : to === AdrStatus.Superseded
              ? "adr_superseded"
              : "node_status",
        node: id,
        from: node.status,
        to,
        ...(to === AdrStatus.Superseded
          ? { detail: `superseded_by=${node.superseded_by}` }
          : {}),
      });
      return updated;
    }

    // 幂等：同一认领者重复 claim 返回成功（agent 重试友好）
    if (to === NodeStatus.Running && node.status === NodeStatus.Running) {
      if (claimBy && node.assigned_to === claimBy) {
        // S2-12：幂等 re-claim 补审计痕迹——此前静默短路，重试风暴/网络抖动
        // 场景下审计日志看不出"发生了重复认领尝试"，裁决方无法回溯
        appendEvent(rootDir, {
          actor: opts.actor ?? claimBy ?? "unknown",
          kind: "node_status",
          node: id,
          from: node.status,
          to,
          detail: "幂等 re-claim（同一认领者重复 claim，无状态变更）",
        });
        return node;
      }
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
        throw new GraphError(
          ErrorCode.GateNotSatisfied,
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
      throw new GraphError(
        ErrorCode.InvalidTransition,
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
    // S3-3（f14）：kind 显式分支——带 verification 恒为 verdict，否则恒为
    // execution_report。此前对象字面量先写 kind: "execution_report" 再条件展开
    // kind: "verdict"，靠后键覆盖前键的隐式顺序；重构后一次只写一个 kind。
    if (report.verification) {
      appendEvent(rootDir, {
        actor: opts.actor ?? "unknown",
        kind: "verdict",
        node: id,
        detail: `verdict=${report.verification.verdict}`,
      });
    } else {
      appendEvent(rootDir, {
        actor: opts.actor ?? "unknown",
        kind: "execution_report",
        node: id,
      });
    }
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
      | "contracts"
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
  const graphDir = toGraphDir(rootDir);
  return listNodeFileNames(graphDir).map((f) =>
    readNode(graphDir, f.replace(/\.yaml$/, "")),
  );
}

// ── v0.5 ADR 生命周期操作（CLI graph adr / MCP graph_create_adr 共享）──

export interface CreateAdrParams {
  title: string; // 落 label
  decision: string;
  background?: string;
  considered_options?: string;
  why?: string;
  consequences?: string;
}

/** 下一个 ADR 编号：扫描现有 adr_NNNN 顶点取最大号+1（四位零填充） */
export function nextAdrId(rootDir: string): string {
  const graphDir = toGraphDir(rootDir);
  let max = 0;
  for (const f of listNodeFileNames(graphDir)) {
    const m = f.replace(/\.yaml$/, "").match(/^adr_(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `adr_${String(max + 1).padStart(4, "0")}`;
}

/**
 * 创建 ADR 顶点：自动编号、状态落 proposed（记录在案但不生效——
 * accept/supersede 归裁决方，提议/裁决分离）。任何 agent 可提议。
 * S1-3：编号扫描在锁外、锁内缺重复检查——并发双 adr_0007 后到者静默覆盖
 * 先到者。修复：锁内补 existsSync 重复检查（对齐 createNode），冲突时重扫
 * 编号重试（各得唯一编号），重试上限防御病态场景。
 */
const ADR_CONFLICT_RETRIES = 5;

export function createAdr(
  rootDir: string,
  params: CreateAdrParams,
  opts: { actor?: string } = {},
): NodeSchema {
  const graphDir = toGraphDir(rootDir);
  for (let attempt = 1; ; attempt++) {
    const id = nextAdrId(graphDir);
    const now = new Date().toISOString();
    const node: NodeSchema = {
      id,
      type: NodeType.Adr,
      label: params.title,
      level: 1,
      status: AdrStatus.Proposed,
      attempts: 0,
      max_attempts: 0,
      created_at: now,
      updated_at: now,
      decision: params.decision,
      ...(params.background !== undefined ? { background: params.background } : {}),
      ...(params.considered_options !== undefined
        ? { considered_options: params.considered_options }
        : {}),
      ...(params.why !== undefined ? { why: params.why } : {}),
      ...(params.consequences !== undefined ? { consequences: params.consequences } : {}),
    };
    try {
      withLockSync(graphDir, id, () => {
        // S1-3：锁内重复检查——编号扫描与抢锁之间的竞争在此收口，绝不覆盖
        if (fs.existsSync(nodeFilePath(graphDir, id))) {
          throw new Error(`Node ${id} already exists`);
        }
        // F21 (a)(b)：ADR 顶点创建 = 建节点，同受结构修订守卫（C5 组合器；
        // 拒绝路径在守卫段之前，不留快照）
        withGraphAmend(
          graphDir,
          { action: "add-node", target: id, actor: opts.actor },
          () => {
            return withGraphLock(graphDir, () => {
              if (fs.existsSync(nodeFilePath(graphDir, id))) {
                throw new Error(`Node ${id} already exists`);
              }
              ensureGraphDir(graphDir);
              writeNodeCore(graphDir, node);
              addGraphRefLocked(graphDir, "node", id);
              appendEvent(graphDir, {
                actor: opts.actor ?? "unknown",
                kind: "adr_created",
                node: id,
                to: AdrStatus.Proposed,
                detail: params.title,
              });
              return node;
            });
          },
        );
      });
      return node;
    } catch (err: any) {
      const conflict =
        typeof err?.message === "string" && err.message.includes("already exists");
      if (conflict && attempt < ADR_CONFLICT_RETRIES) continue; // 重扫编号（他人已占号）
      throw err;
    }
  }
}

/**
 * 原子废弃：单锁内一步完成"写 superseded_by + 置 superseded"——
 * 两操作要么都成要么都不成（分两步会产生被 schema 拒绝的中间态）。
 */
export function supersedeAdr(
  rootDir: string,
  id: string,
  by: string,
  opts: { actor?: string } = {},
): NodeSchema {
  return withLockSync(rootDir, id, () => {
    const node = getNode(rootDir, id);
    if (node.type !== NodeType.Adr) {
      throw new GraphError(
        ErrorCode.InvalidTransition,
        `Node ${id} 不是 adr 顶点，无法废弃`,
      );
    }
    // 接替者校验（锁内直读保证新鲜；与 updateNodeStatus 的守卫一致）
    if (by === id) {
      throw new GraphError(
        ErrorCode.InvalidTransition,
        `ADR ${id} 的 superseded_by 不能指向自身`,
      );
    }
    let succ: NodeSchema;
    try {
      succ = getNode(rootDir, by);
    } catch {
      throw nodeNotFound(by, `接替者不存在: ${by}`);
    }
    if (succ.type !== NodeType.Adr) {
      throw new GraphError(
        ErrorCode.InvalidTransition,
        `接替者不是 adr 顶点: ${by}`,
      );
    }
    const updated = transition({ ...node, superseded_by: by }, AdrStatus.Superseded);
    writeNode(rootDir, updated);
    appendEvent(rootDir, {
      actor: opts.actor ?? "unknown",
      kind: "adr_superseded",
      node: id,
      from: node.status,
      to: AdrStatus.Superseded,
      detail: `superseded_by=${by}`,
    });
    return updated;
  });
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
  /** v0.5 领域字段：归属 context（空串清除归属） */
  set_context?: string;
  boundary?: string;
  glossary_add?: { term: string; definition: string }[];
  /** IL-012（context 顶点）：追加对其他 context 的默认契约声明——跨 context 工作流边
   * 自动继承（validate 判定层面），单边 contract 仍可覆写；to 悬空由 domain 校验报 error */
  contract_add?: { to: string; contract: Contract }[];
  /** v0.5（adr 顶点）：接替者——置 superseded 前必须设置（MCP supersede 两步法的第一步） */
  superseded_by?: string;
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
    | "plan"
    | "expected_outcome"
    | "checkpoints"
    | "assigned_to"
    | "label"
    | "max_attempts"
    | "context"
    | "boundary"
    | "glossary"
    | "contracts"
    | "superseded_by"
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
  // v0.5 领域字段：归属（空串=清除）、边界描述、术语追加
  if (params.set_context !== undefined) {
    updates.context = params.set_context === "" ? undefined : params.set_context;
  }
  if (params.boundary !== undefined) {
    updates.boundary = params.boundary;
  }
  if (params.glossary_add && params.glossary_add.length > 0) {
    updates.glossary = [...(node.glossary ?? []), ...params.glossary_add];
  }
  // IL-012：默认契约声明追加（对齐 glossary_add 的追加语义；重复 to 由 domain 校验警告）
  if (params.contract_add && params.contract_add.length > 0) {
    updates.contracts = [...(node.contracts ?? []), ...params.contract_add];
  }
  if (params.superseded_by !== undefined) {
    updates.superseded_by = params.superseded_by;
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
      | "context"
      | "boundary"
      | "glossary"
      | "contracts"
      | "superseded_by"
    >
  >;
}
