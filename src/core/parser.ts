import * as fs from "node:fs";
import * as yaml from "js-yaml";
import {
  type GraphSchema,
  type GraphFog,
  type GraphClass,
} from "./types.js";
import {
  loadEdgeFile,
  listEdgeFileNames,
  SchemaValidationError,
  formatIssues,
} from "./schema.js";
import { withLockSync } from "./lock.js";
import { appendEvent } from "./eventlog.js";
// 循环依赖说明：parser → amend（deleteNode/deleteEdge 的 F21 守卫）已降为单向——
// amend 的回指（原 resetGraphReview）改道 review.ts（arch-c4b 解环），
// 不再 import 本模块。
import { withGraphAmend } from "./amend.js";
// 循环依赖说明：parser → index-service（invalidateIndex 写后失效）已降为单向——
// index-service 的读原语（readNode/readEdge）改道 graph-io（arch-c4b 解环）。
// fix_index_cache：写路径必须主动失效索引缓存。
import { invalidateIndex } from "./index-service.js";
// arch-c4b 解环：文件 I/O 原语层（graph.yaml 与实体文件读写、图级锁、引用列表
// 重建）下沉至 graph-io.ts，本模块保留用例编排层。下方兼容 re-export 保持
// 对外路径（@lukawi/super-plumber/core 与 ../core/parser.js 深引）与函数签名
// 不变，CLI / MCP / 既有测试零改动（同 graduateFog 迁移 fog.ts 的先例）。
import {
  withGraphLock,
  readGraph,
  writeGraphCore,
  nodeFilePath,
  edgeFilePath,
  removeGraphRef,
} from "./graph-io.js";
export {
  GRAPH_LOCK,
  withGraphLock,
  ensureGraphDir,
  readGraph,
  writeGraphCore,
  writeGraph,
  nodeFilePath,
  readNode,
  writeNode,
  addGraphRef,
  edgeFilePath,
  readEdge,
  writeEdge,
  rebuildGraphRefs,
  rebuildGraphRefsLocked,
} from "./graph-io.js";

export { SchemaValidationError, formatIssues };

function softDelete(
  filePath: string,
  meta: { reason?: string; actor?: string } = {},
): string {
  const deletedPath = filePath.replace(/\.yaml$/, ".deleted.yaml");
  // 如果已存在 .deleted 文件，先追加时间戳
  const finalPath = fs.existsSync(deletedPath)
    ? filePath.replace(/\.yaml$/, `.deleted.${Date.now()}.yaml`)
    : deletedPath;
  fs.renameSync(filePath, finalPath);
  // F14（0.8.1）：删除理由随软删归档。.deleted.yaml 是审计档案不是数据源
  // （listNodeFileNames 按 DELETED_FILE_RE 排除，schema 不校验），追加顶层键
  // 安全；理由是凭据不是拒绝条件（DEC-3）——缺省不写、行为保持现状。
  const reason = meta.reason?.trim();
  if (reason) {
    const block = yaml.dump(
      {
        deleted_reason: reason,
        deleted_at: new Date().toISOString(),
        deleted_by: meta.actor ?? "unknown",
      },
      { indent: 2, lineWidth: 120 },
    );
    fs.appendFileSync(finalPath, block, "utf-8");
  }
  return finalPath;
}

export function deleteNode(
  rootDir: string,
  id: string,
  opts: { cascade?: boolean; actor?: string; reason?: string } = {},
): void {
  return withLockSync(rootDir, id, () => {
    const filePath = nodeFilePath(rootDir, id);
    if (!fs.existsSync(filePath)) throw new Error(`Node ${id} not found`);

    // 引用边检查：默认拒绝（防悬挂引用），--cascade 连同软删除
    const referencing: string[] = [];
    for (const f of listEdgeFileNames(rootDir)) {
      const r = loadEdgeFile(rootDir, f);
      if (r.ok && (r.data.source === id || r.data.target === id)) {
        referencing.push(r.data.id);
      }
    }
    if (referencing.length > 0 && !opts.cascade) {
      throw new Error(
        `Node ${id} 被 ${referencing.length} 条边引用 (${referencing.join(", ")}），` +
        `直接删除会留下悬挂引用。使用 --cascade 连同这些边一起删除`,
      );
    }
    // F21 (a)(b)（C5 组合器）：结构修订落图前自动快照 + 落盘成功后 graph_amended
    // 事件/review 回置。拒绝路径（上方 not found / 悬挂引用）在守卫段之前，不留
    // 快照；cascade 删除的边由本层统一守卫一次，内层 deleteEdge 嵌套自动免守卫
    // （防一次操作多份快照）。
    const reason = opts.reason?.trim();
    return withGraphAmend(
      rootDir,
      {
        action: "remove-node",
        target: id,
        actor: opts.actor,
        detail: [
          ...(reason ? [`reason="${reason}"`] : []),
          ...(opts.cascade && referencing.length > 0
            ? [`cascade edges: ${referencing.join(", ")}`]
            : []),
        ].join("; ") || undefined,
      },
      () => {
        if (opts.cascade) {
          for (const edgeId of referencing) {
            deleteEdge(rootDir, edgeId, { actor: opts.actor });
          }
        }

        // S1-11：先撤引用再软删文件。快照按 graph.yaml → nodes/ → edges/ 顺序复制：
        // 若先删文件后撤引用，窗口内快照会得到"引用存在但文件缺失"的致命混装
        // （隐藏节点）；反序最多产生"文件尚在但引用已撤"的良性形态
        // （validate 警告，rebuild 可自愈）。
        removeGraphRef(rootDir, "node", id);
        softDelete(filePath, { reason: opts.reason, actor: opts.actor });
        invalidateIndex(rootDir); // 目录内容变了（rename 不改源文件 mtime 语义），主动失效
        // F14：删除理由写入审计事件（detail）。理由与 cascade 说明可并存（"；"连接）；
        // 缺省理由时 detail 保持既有语义（仅 cascade 时才有）。（reason 取守卫段声明）
        const detailParts = [
          ...(reason ? [`reason="${reason}"`] : []),
          ...(opts.cascade ? [`cascade 删除边: ${referencing.join(", ")}`] : []),
        ];
        appendEvent(rootDir, {
          actor: opts.actor ?? "unknown",
          kind: "node_deleted",
          node: id,
          ...(detailParts.length > 0 ? { detail: detailParts.join("；") } : {}),
        });
      },
    );
  });
}

export function deleteEdge(
  rootDir: string,
  id: string,
  opts: { actor?: string } = {},
): void {
  return withLockSync(rootDir, id, () => {
    const filePath = edgeFilePath(rootDir, id);
    if (!fs.existsSync(filePath)) throw new Error(`Edge ${id} not found`);
    // F21 (a)(b)（C5 组合器）：结构修订守卫——not found 拒绝路径在守卫段之前，
    // 不留快照；cascade 路径由 deleteNode 外层统一守卫，此处嵌套自动免守卫
    return withGraphAmend(
      rootDir,
      { action: "remove-edge", target: id, actor: opts.actor },
      () => {
        // S1-11：先撤引用再软删文件（理由同 deleteNode——防快照致命混装）
        removeGraphRef(rootDir, "edge", id);
        softDelete(filePath);
        invalidateIndex(rootDir);
        appendEvent(rootDir, {
          actor: opts.actor ?? "unknown",
          kind: "edge_deleted",
          edge: id,
        });
      },
    );
  });
}

// ── 图级字段编辑（entry/exit/label/root_context，需求 4.2 创建图 + P2-1；
//    0.9.0 F04/F03：+ fog / class，adr_0007 + DEC-2）──
export type UpdateGraphParams = {
  label?: string;
  entry_description?: string;
  exit_description?: string;
  add_criteria?: string[];
  clear_criteria?: boolean;
  root_context?: Record<string, unknown>;
  /** adr_0007（F04）：登记/更新雾区（整体 upsert——雾是单字段，毕业走 graduateFog
   * 拿专用凭据，不走这里清空） */
  fog?: GraphFog;
  /** DEC-2（F03/F13）：工作类标注 quick|standard|program */
  class?: GraphClass;
  /** v091-class-command（adr_0016）：class 变更的操作者凭据（缺省 "agent"）。
   * 用户直发凭据（/plumber-class 命令或对话批准）时由命令文本指示传 "user"——
   * 血统落进 class_changed 事件的结构化 by 字段，雾/档矛盾 nudge 据此静默。 */
  by?: string;
};

export function updateGraph(
  rootDir: string,
  params: UpdateGraphParams,
): GraphSchema {
  // S1-4 同源：读-改-写全程持图级锁，与引用列表同步/快照互斥
  return withGraphLock(rootDir, () => {
    const graph = readGraph(rootDir); // 未初始化/schema 损坏直接报错
    const previousClass = graph.class; // v091：变更前快照，供 class_changed 血统
    if (params.label !== undefined) graph.label = params.label;
    if (params.entry_description !== undefined) {
      graph.entry.description = params.entry_description;
    }
    if (params.exit_description !== undefined) {
      graph.exit.description = params.exit_description;
    }
    if (params.clear_criteria) {
      graph.exit.acceptance_criteria = [];
    }
    if (params.add_criteria && params.add_criteria.length > 0) {
      graph.exit.acceptance_criteria = [
        ...graph.exit.acceptance_criteria,
        ...params.add_criteria,
      ];
    }
    if (params.root_context !== undefined) {
      graph.root_context = params.root_context;
    }
    if (params.fog !== undefined) {
      graph.fog = params.fog;
    }
    if (params.class !== undefined) {
      graph.class = params.class;
    }
    writeGraphCore(rootDir, graph);
    // v091-class-command（adr_0016）：class 实际变更才落凭据事件（同值重设不落，
    // 审计不噪音）；from 缺省 = 首次设置。状态是真相源、事件是影子（先写后记）。
    if (params.class !== undefined && params.class !== previousClass) {
      const by = params.by ?? "agent";
      appendEvent(rootDir, {
        actor: by, // 档位凭据的行为主体就是凭据人（同 approveGraph 的 actor=by 先例）
        kind: "class_changed",
        ...(previousClass !== undefined ? { from: previousClass } : {}),
        to: params.class,
        by,
        detail: `class: ${previousClass ?? "(未设)"} → ${params.class}（by=${by}）`,
      });
    }
    return graph;
  });
}

// ── F05（adr_0007，0.9.0）：雾区毕业 ──
// arch-c4a：毕业写路径迁入 core/fog.ts（雾区的读/警告/毕业单家收敛），此处保留
// 兼容 re-export——对外路径（@lukawi/super-plumber/core 与 ../core/parser.js 深引）
// 与函数签名不变，CLI graduate-fog / MCP graph_graduate_fog 及既有测试零改动。
// 循环依赖说明：parser → fog（本 re-export）已降为单向——fog 的写读原语
// （readGraph/withGraphLock/writeGraphCore）改道 graph-io（arch-c4b 解环）。
export { graduateFog, type GraduateFogParams } from "./fog.js";

// ── 审批凭据（DEC-1 approveGraph / F21(b) resetGraphReview，arch-c4b 成家）──
// 写/重置 API 迁入 core/review.ts（审批凭据单家收敛），此处保留兼容 re-export，
// 对外路径与函数签名不变，CLI approve / MCP graph_approve 及既有测试零改动。
// 循环依赖说明：parser → review（本 re-export）单向——review 只依赖 graph-io，
// 不回指本模块；amend → review 改道后 parser↔amend 循环 import 已剪断。
export {
  resetGraphReview,
  approveGraph,
  type ApproveGraphParams,
} from "./review.js";
