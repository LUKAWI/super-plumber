import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import {
  type NodeSchema,
  type EdgeSchema,
  type GraphSchema,
  NODES_DIR,
  EDGES_DIR,
  GRAPH_FILE,
} from "./types.js";
import {
  loadNodeFile,
  loadEdgeFile,
  loadGraphFile,
  listEdgeFileNames,
  listNodeFileNames,
  SchemaValidationError,
  formatIssues,
  assertValidEntityId,
  validateNode,
  validateEdge,
  validateGraph,
} from "./schema.js";
import { withLockSync } from "./lock.js";
import { toGraphDir } from "./graph-dir.js";
import { appendEvent } from "./eventlog.js";
// 循环依赖说明：index-service ← parser（读原语）与 parser ← index-service
//（invalidateIndex 写后失效）互为环，但两侧都只在函数体内调用对方导出，
// ESM 函数声明提升下安全。fix_index_cache：写路径必须主动失效索引缓存。
import { invalidateIndex } from "./index-service.js";

export { SchemaValidationError, formatIssues };

// ── A3 锁体系扩展（f7）：图级锁 ──
// 实体锁（withLockSync(rootDir, id)）只串行化同一实体的读-改-写；
// 跨文件操作（graph.yaml 引用列表 RMW、快照/回滚整树复制、写前校验落盘）
// 需要图级互斥。GRAPH_LOCK 以 "__graph__" 为 id：合法节点 ID 不可能以下划线
// 开头（NODE_ID_RE），天然无碰撞。锁序恒为 实体锁 → 图锁（图锁内不再取
// 任何锁），无死锁环；锁不可重入——图锁持有人必须调 *Core/*Locked 变体。
export const GRAPH_LOCK = "__graph__";

export function withGraphLock<T>(
  rootDir: string,
  fn: () => T,
  opts: { timeoutMs?: number } = {},
): T {
  return withLockSync(rootDir, GRAPH_LOCK, fn, opts);
}

export function ensureGraphDir(rootDir: string): void {
  const g = toGraphDir(rootDir);
  fs.mkdirSync(path.join(g, NODES_DIR), { recursive: true });
  fs.mkdirSync(path.join(g, EDGES_DIR), { recursive: true });
}

function enoent(file: string): Error & { code: string } {
  const err = new Error(`File not found: ${file}`) as Error & { code: string };
  err.code = "ENOENT";
  return err;
}

// A2 写前校验：任何写路径（CLI/MCP/内部 API/第三方库）落盘前统一执法。
// 此前是"读时校验、写时放行"——上游校验缺口（CLI NaN、MCP as never、内存对象
// 残缺）会变成落盘成功 + 后续全图读取失败的延时炸弹。写路径补校验后，
// 毒化文件在源头被拒，读侧校验退化为防手编文件的第二道防线。
function assertWritable(
  file: string,
  issues: ReturnType<typeof validateNode>,
): void {
  if (issues.length > 0) {
    throw new SchemaValidationError(
      file,
      issues,
      `${file} 写前校验失败（拒绝落盘）: ${formatIssues(issues)}`,
    );
  }
}

// ── Graph ──
export function readGraph(rootDir: string): GraphSchema {
  const res = loadGraphFile(rootDir);
  if (res.ok) return res.data;
  if (res.enoent) throw enoent(path.join(toGraphDir(rootDir), GRAPH_FILE));
  throw new SchemaValidationError(
    GRAPH_FILE,
    res.issues,
    `graph.yaml schema 校验失败: ${formatIssues(res.issues)}`,
  );
}

/** 落盘核心（无锁）：调用方必须已持有图锁（GRAPH_LOCK） */
function writeGraphCore(rootDir: string, graph: GraphSchema): void {
  assertWritable(GRAPH_FILE, validateGraph(graph));
  const content = yaml.dump(graph, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(path.join(toGraphDir(rootDir), GRAPH_FILE), content, "utf-8");
  invalidateIndex(rootDir);
}

export function writeGraph(rootDir: string, graph: GraphSchema): void {
  ensureGraphDir(rootDir);
  // S1-4：graph.yaml 写入纳入图级锁——与引用列表 RMW、快照/回滚互斥
  withGraphLock(rootDir, () => writeGraphCore(rootDir, graph));
}

// ── Node ──
export function nodeFilePath(rootDir: string, id: string): string {
  // S0-3 咽喉点：所有 id→路径的构造（读/写/删）统一拒绝穿越形 ID
  assertValidEntityId("节点", id);
  return path.join(toGraphDir(rootDir), NODES_DIR, `${id}.yaml`);
}

export function readNode(rootDir: string, id: string): NodeSchema {
  assertValidEntityId("节点", id); // loadNodeFile 以 id 拼文件名，先行拦截
  const res = loadNodeFile(rootDir, `${id}.yaml`);
  if (res.ok) return res.data;
  if (res.enoent) throw enoent(nodeFilePath(rootDir, id));
  throw new SchemaValidationError(
    `nodes/${id}.yaml`,
    res.issues,
    `Node ${id} schema 校验失败: ${formatIssues(res.issues)}`,
  );
}

export function writeNode(rootDir: string, node: NodeSchema): void {
  ensureGraphDir(rootDir);
  // S1-11：单文件写入纳入图级锁——快照逐文件 copyFileSync 期间不再与写路径
  // 穿插（撕裂副本），回滚恢复期间写入被互斥（防复活半旧状态）
  withGraphLock(rootDir, () => {
    assertWritable(`nodes/${node.id}.yaml`, validateNode(node));
    const content = yaml.dump(node, { indent: 2, lineWidth: 120 });
    fs.writeFileSync(nodeFilePath(rootDir, node.id), content, "utf-8");
    invalidateIndex(rootDir);
  });
}

// ── graph.yaml 引用列表同步（node/edge 创建与软删除时维护）──
// S1-4：读-改-写全程持图级锁——调用方只持各自实体 id 锁，不同 id 并发时
// 旧实现互相覆盖（丢条目），此处补上图级互斥（公共咽喉，CLI/MCP 全覆盖）。
function syncGraphRef(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
  remove: boolean,
): void {
  withGraphLock(rootDir, () => {
    let graph: GraphSchema;
    try {
      graph = readGraph(rootDir);
    } catch (err: any) {
      if (err?.code === "ENOENT") return; // 图未初始化时跳过（无 graph.yaml 可同步）
      throw err; // schema 损坏必须浮出，不得静默
    }
    const list = kind === "node" ? graph.nodes : graph.edges;
    const file = kind === "node" ? `nodes/${id}.yaml` : `edges/${id}.yaml`;
    const idx = list.findIndex((r) => r.file === file);
    if (remove) {
      if (idx === -1) return;
      list.splice(idx, 1);
    } else {
      if (idx !== -1) return; // 已存在
      list.push({ file });
    }
    writeGraphCore(rootDir, graph);
  });
}

export function addGraphRef(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
): void {
  syncGraphRef(rootDir, kind, id, false);
}

/**
 * 从 nodes/edges 目录一次性重建 graph.yaml 引用列表。
 * 批量创建（graph_batch_create / 脚本）时配合 syncRef:false 使用，
 * 避免每个节点/边创建都重写一次 graph.yaml（O(n²) → O(n)）。
 * 重建含读-改-写，公共入口自持图级锁；持锁调用方（rollback）用 *Locked 变体。
 */
export function rebuildGraphRefs(rootDir: string): void {
  withGraphLock(rootDir, () => rebuildGraphRefsLocked(rootDir));
}

/** 重建核心（无锁）：调用方必须已持有图锁（GRAPH_LOCK） */
export function rebuildGraphRefsLocked(rootDir: string): void {
  let graph: GraphSchema;
  try {
    graph = readGraph(rootDir);
  } catch (err: any) {
    if (err?.code === "ENOENT") return; // 图未初始化
    throw err;
  }
  graph.nodes = listNodeFileNames(rootDir).map((f) => ({ file: `nodes/${f}` }));
  graph.edges = listEdgeFileNames(rootDir).map((f) => ({ file: `edges/${f}` }));
  writeGraphCore(rootDir, graph);
}

function removeGraphRef(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
): void {
  syncGraphRef(rootDir, kind, id, true);
}

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
        `Node ${id} 被 ${referencing.length} 条边引用 (${referencing.join(", ")})，` +
        `直接删除会留下悬挂引用。使用 --cascade 连同这些边一起删除`,
      );
    }
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
    // 缺省理由时 detail 保持既有语义（仅 cascade 时才有）。
    const reason = opts.reason?.trim();
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
    // S1-11：先撤引用再软删文件（理由同 deleteNode——防快照致命混装）
    removeGraphRef(rootDir, "edge", id);
    softDelete(filePath);
    invalidateIndex(rootDir);
    appendEvent(rootDir, {
      actor: opts.actor ?? "unknown",
      kind: "edge_deleted",
      edge: id,
    });
  });
}

// ── Edge ──
export function edgeFilePath(rootDir: string, id: string): string {
  assertValidEntityId("边", id);
  return path.join(toGraphDir(rootDir), EDGES_DIR, `${id}.yaml`);
}

export function readEdge(rootDir: string, id: string): EdgeSchema {
  assertValidEntityId("边", id);
  const res = loadEdgeFile(rootDir, `${id}.yaml`);
  if (res.ok) return res.data;
  if (res.enoent) throw enoent(edgeFilePath(rootDir, id));
  throw new SchemaValidationError(
    `edges/${id}.yaml`,
    res.issues,
    `Edge ${id} schema 校验失败: ${formatIssues(res.issues)}`,
  );
}

export function writeEdge(rootDir: string, edge: EdgeSchema): void {
  ensureGraphDir(rootDir);
  withGraphLock(rootDir, () => {
    assertWritable(`edges/${edge.id}.yaml`, validateEdge(edge));
    const content = yaml.dump(edge, { indent: 2, lineWidth: 120 });
    fs.writeFileSync(edgeFilePath(rootDir, edge.id), content, "utf-8");
    invalidateIndex(rootDir);
  });
}

// ── 图级字段编辑（entry/exit/label/root_context，需求 4.2 创建图 + P2-1）──
export type UpdateGraphParams = {
  label?: string;
  entry_description?: string;
  exit_description?: string;
  add_criteria?: string[];
  clear_criteria?: boolean;
  root_context?: Record<string, unknown>;
};

export function updateGraph(
  rootDir: string,
  params: UpdateGraphParams,
): GraphSchema {
  // S1-4 同源：读-改-写全程持图级锁，与引用列表同步/快照互斥
  return withGraphLock(rootDir, () => {
    const graph = readGraph(rootDir); // 未初始化/schema 损坏直接报错
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
    writeGraphCore(rootDir, graph);
    return graph;
  });
}

// ── DEC-1（g080-approve-core）：设计审核凭据写入 ──
// approve 双通道（CLI approve / MCP graph_approve）共用的核心原语：
//   1. graph.yaml 写入 review 字段（status/by/at，self=quick 自签与 approved=人工审核可区分）；
//   2. events.jsonl 追加 design_approved 事件（payload 含 by/status）；
//   3. writeGraphCore 内含 invalidateIndex——调度缓存失效，review_flag 判定立即可见。
// 红线：review 仅记录、零门禁——不触碰任何节点状态机规则，调度面只做提示。
// 幂等语义：重复 approve 覆盖旧凭据（最新一次审核生效）。
export interface ApproveGraphParams {
  /** 审核人（quick 自签时为 quick 操作者名） */
  by: string;
  /** 审核状态：approved=人工审核（默认）| self=quick 自签 */
  status?: "approved" | "self";
}

export function approveGraph(
  rootDir: string,
  params: ApproveGraphParams,
  opts: { actor?: string } = {},
): GraphSchema {
  if (typeof params.by !== "string" || params.by === "") {
    throw new Error("approve 需要非空审核人（--by <名> / by 参数）");
  }
  const status = params.status ?? "approved";
  return withGraphLock(rootDir, () => {
    const graph = readGraph(rootDir); // 未初始化/schema 损坏直接报错
    graph.review = { status, by: params.by, at: new Date().toISOString() };
    writeGraphCore(rootDir, graph); // 写前校验 + 落盘 + invalidateIndex
    appendEvent(rootDir, {
      actor: opts.actor ?? params.by, // 审核动作的行为主体就是审核人
      kind: "design_approved",
      detail: `by=${params.by}, status=${status}`,
    });
    return graph;
  });
}
