// src/core/review.ts
// 设计审核凭据的单一家（arch-c4b 审批凭据成家）：approveGraph（DEC-1 凭据写入）
// 与 resetGraphReview（F21(b) 结构修订后回置）原住 parser.ts，现搬入本文件——
// 低位凭据原语只依赖 graph-io，不回指 parser（配合 amend 改道 review，
// 剪断 parser↔amend 循环 import）。对外路径（@lukawi/super-plumber/core 与
// ../core/parser.js 深引）经 parser 兼容 re-export 保持不变，CLI / MCP 与既有
// 测试零改动（同 graduateFog 迁入 fog.ts 的先例）。
import { type GraphSchema, type GraphReviewLayer } from "./types.js";
import { withGraphLock, readGraph, writeGraphCore } from "./graph-io.js";
import { isWorkspaceNotInitialized } from "./errors.js";
import { appendEvent } from "./eventlog.js";

// ── F21 (b)（DEC-7 / adr_0006）：结构修订后的 review 凭据回置 ──
// 图已有 review 凭据 → 回置 status=unreviewed（by=触发修订的通道/actor，
// at=now，凭据形状与 approveGraph 一致），review_flag nudge 重新亮起走增量人审；
// 图从未审核（无 review 字段）→ 原样不动（返回 false）。红线：只写凭据字段，
// 零门禁——不触碰任何节点状态机规则，不新增任何拒绝规则。返回是否发生了回置。
export function resetGraphReview(
  rootDir: string,
  opts: { actor?: string } = {},
): boolean {
  return withGraphLock(rootDir, () => {
    let graph: GraphSchema;
    try {
      graph = readGraph(rootDir);
    } catch (err: any) {
      if (isWorkspaceNotInitialized(err)) return false; // 图未初始化：无凭据可回置（arch-c1 code 判定）
      throw err;
    }
    if (graph.review === undefined) return false;
    // F08：整体重写凭据对象——分层批准记录（layers）随整图凭据一并作废：
    // 层批的是修订前的旧结构，回置后增量人审从零重走（层批历史仍可查 events）。
    graph.review = {
      status: "unreviewed",
      by: opts.actor ?? "unknown",
      at: new Date().toISOString(),
    };
    writeGraphCore(rootDir, graph); // 写前校验 + 落盘 + invalidateIndex
    return true;
  });
}

// ── DEC-1（g080-approve-core）：设计审核凭据写入 ──
// approve 双通道（CLI approve / MCP graph_approve）共用的核心原语：
//   1. graph.yaml 写入 review 字段（status/by/at，self=quick 自签与 approved=人工审核可区分）；
//   2. events.jsonl 追加 design_approved 事件（payload 含 by/status；带 level 时附 level=L…）；
//   3. writeGraphCore 内含 invalidateIndex——调度缓存失效，review_flag 判定立即可见。
// 红线：review 仅记录、零门禁——不触碰任何节点状态机规则，调度面只做提示。
// 幂等语义：重复 approve 覆盖旧凭据（最新一次审核生效）。
// F08（0.9.2 渐进审批）：带 level 的 approve = 分层凭据——除整图凭据外向
// review.layers 追加一条 {level,by,at}（同层重复覆盖更新该层，首次批准顺序保持）；
// 不带 level 行为与从前完全一致（layers 缺省不存在）。零新增拒绝规则：level 在
// quick/standard 图上照写不拒——档位路由是 skill 口径，工具不强制。
export interface ApproveGraphParams {
  /** 审核人（quick 自签时为 quick 操作者名） */
  by: string;
  /** 审核状态：approved=人工审核（默认）| self=quick 自签 */
  status?: "approved" | "self";
  /** F08：分层批准层标（如 L1/L2/...）——提供时向 review.layers 追加/覆盖该层记录 */
  level?: string;
}

export function approveGraph(
  rootDir: string,
  params: ApproveGraphParams,
  opts: { actor?: string } = {},
): GraphSchema {
  if (typeof params.by !== "string" || params.by === "") {
    throw new Error("approve 需要非空审核人（--by <名> / by 参数）");
  }
  if (
    params.level !== undefined &&
    (typeof params.level !== "string" || params.level === "")
  ) {
    throw new Error("approve --level 需要非空层标（如 L1/L2/...）");
  }
  const status = params.status ?? "approved";
  return withGraphLock(rootDir, () => {
    const graph = readGraph(rootDir); // 未初始化/schema 损坏直接报错
    const at = new Date().toISOString();
    // F08：仅带 level 的 approve 继承既有分层记录做追加/覆盖；不带 level 的整图
    // approve 是全量凭据，覆盖一切层批记录（与"最新一次审核生效"幂等语义一致，
    // 层批历史仍可经 events.jsonl 追溯）。
    const prevLayers = params.level !== undefined ? graph.review?.layers : undefined;
    graph.review = { status, by: params.by, at };
    if (params.level !== undefined) {
      const layer: GraphReviewLayer = { level: params.level, by: params.by, at };
      const layers = [...(prevLayers ?? [])]; // 旧图无 layers 字段照常追加（零迁移）
      const existing = layers.findIndex((l) => l.level === params.level);
      if (existing >= 0) layers[existing] = layer; // 同层重复 approve：覆盖更新该层
      else layers.push(layer); // 新层：追加式，首次批准顺序保持
      graph.review.layers = layers;
    }
    writeGraphCore(rootDir, graph); // 写前校验 + 落盘 + invalidateIndex
    appendEvent(rootDir, {
      actor: opts.actor ?? params.by, // 审核动作的行为主体就是审核人
      kind: "design_approved",
      detail:
        `by=${params.by}, status=${status}` +
        (params.level !== undefined ? `, level=${params.level}` : ""),
    });
    return graph;
  });
}
