// src/core/amend.ts
// F21（DEC-7 / adr_0006，DEC-1 nudge 哲学）：改图三约束——全部 nudge/凭据类，
// 不加硬门禁、不新增任何拒绝规则。红线：守卫本身失败绝不阻断合法写操作。
//
//   (a) 结构修订落图前自动 snapshot：结构性改动入口（创建/删除节点、添加/删除边，
//       batch_create 整批一次）在实际写盘前自动快照，message 说明性
//       （"auto: structural amend (add-node <id>) by <channel>"）。
//       拦截点在 core 公共写入口（createNode/createAdr/createEdge/deleteNode/
//       deleteEdge），CLI / MCP / 脚本三通道天然一致；batch_create 与 cascade
//       删边等"一次用户操作、多次底层写"的路径由外层统一守卫一次，内层
//       传 skipAmendGuard 跳过（防快照风暴）。
//   (b) graph_amended 审计事件 + review 回置：结构修订落盘成功后追加
//       graph_amended 事件（events.jsonl，与既有事件同构）；图 yaml 已有
//       review 凭据则回置 status=unreviewed（by/at 记录触发修订的通道与时刻，
//       与 approveGraph 凭据形状一致），review_flag nudge 重新亮起走增量人审。
//       回置只写凭据字段，零门禁。
//   (c) 改 passed/blocked 节点 plan 的响应 nudge：planAmendNudge 供 CLI/MCP
//       update-node 双通道在响应中各自附加「计划已变更，是否重开/重验」提示，
//       纯提示不改状态。
import { createSnapshot } from "./snapshot.js";
import { resetGraphReview } from "./parser.js";
import { appendEvent } from "./eventlog.js";
import { NodeStatus, type NodeSchema } from "./types.js";

export type StructuralAmendAction =
  | "add-node" // createNode / createAdr（含 batch 内逐节点，由外层统一守卫）
  | "remove-node" // deleteNode
  | "add-edge" // createEdge
  | "remove-edge" // deleteEdge
  | "batch-create"; // graph_batch_create（整批一次快照/一次事件）

export interface StructuralAmendInfo {
  action: StructuralAmendAction;
  /** 单实体操作的实体 id（batch-create 省略，量级走 detail） */
  target?: string;
  /** 附加说明（reason、cascade 边清单、batch 量级），进快照 message 与事件 detail */
  detail?: string;
  /** 行为主体（cli / mcp 客户端名 / 脚本调用方），缺省 unknown */
  actor?: string;
}

export interface ActiveAmend {
  /** 本次守卫落下的自动快照 id（快照失败时为 undefined，不阻断写操作） */
  snapshotId?: string;
  /** 结构修订落盘成功后调用：追加 graph_amended 事件 + 已审核图 review 回置。
   * 写盘抛错时不调用（不为未发生的修订留凭据）；幂等，重复调用无副作用。 */
  complete: () => void;
}

/** 自动快照 message 前缀（graph_amended 事件与 snapshots --json 均可辨认） */
export const AMEND_SNAPSHOT_PREFIX = "auto: structural amend";

/**
 * (a)+(b) 结构修订守卫第一阶段：落图前自动快照。
 * 必须在实体锁内、重复/存在性检查之后、实际写盘之前调用（拒绝路径不留快照）；
 * 快照 best-effort——失败不抛出（红线：不拒绝合法写操作），失败事实随
 * graph_amended 事件 detail 留痕。持实体锁调本函数 = 既有锁序 实体锁→图锁，安全。
 */
export function beginStructuralAmend(
  rootDir: string,
  info: StructuralAmendInfo,
): ActiveAmend {
  const by = info.actor ?? "unknown";
  const scope = info.target !== undefined ? `${info.action} ${info.target}` : info.action;
  const message =
    `${AMEND_SNAPSHOT_PREFIX} (${scope}${info.detail ? `; ${info.detail}` : ""}) by ${by}`;
  let snapshotId: string | undefined;
  try {
    // skipDocsExport：自动快照是回滚安全网、不是设计定稿点（v0.5.1 的"快照即
    // 定稿点"文档导出语义留给显式 snapshot）——零文档副作用、零写放大
    snapshotId = createSnapshot(rootDir, message, { actor: by, skipDocsExport: true }).id;
  } catch {
    snapshotId = undefined; // best-effort：快照失败不阻断结构修订（红线）
  }
  let done = false;
  return {
    snapshotId,
    complete: () => {
      if (done) return;
      done = true;
      // (b) 审计事件：与既有事件同构（ts/actor/kind/detail），graph 级事件
      // 不带 node/edge 字段（node/edge 过滤读数保持纯净，target 走 detail）
      appendEvent(rootDir, {
        actor: by,
        kind: "graph_amended",
        detail:
          `action=${info.action}` +
          `${info.target !== undefined ? ` target=${info.target}` : ""}` +
          `${info.detail ? `; ${info.detail}` : ""}` +
          `; ${snapshotId !== undefined ? `auto_snapshot=${snapshotId}` : "auto_snapshot_failed"}`,
      });
      // (b) review 回置：只写凭据字段，零门禁；图从未审核（无 review 字段）不动。
      // best-effort——回置失败不阻断（事件已在案），也不让 complete 向写路径抛错。
      try {
        resetGraphReview(rootDir, { actor: by });
      } catch {
        /* 凭据回置失败不追溯阻断结构修订（红线） */
      }
    },
  };
}

/**
 * (c) 改 passed/blocked 节点 plan 的响应 nudge。update-node 双通道在
 * plan 变更且节点处于 passed/blocked 时附加本提示——纯提示，不改状态、
 * 不拦截写操作。CLI 与 MCP 引用同一实现保证文案一致。
 */
export function planAmendNudge(
  node: Pick<NodeSchema, "id" | "status">,
  opts: { planChanged?: boolean } = {},
): string | undefined {
  if (!opts.planChanged) return undefined;
  if (node.status !== NodeStatus.Passed && node.status !== NodeStatus.Blocked) {
    return undefined;
  }
  return (
    `⚠️ 计划已变更，是否重开/重验：节点 ${node.id} 当前状态为 ${node.status}，` +
    `plan 修改不会自动触发状态流转——既有执行报告与裁决可能已与新计划失配，` +
    `请评估是否重开节点重新验收（blocked → ready / 人工重开），纯文案微调可忽略本提示。`
  );
}
