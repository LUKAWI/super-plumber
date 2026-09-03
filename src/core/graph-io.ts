// src/core/graph-io.ts
// 图与实体的文件 I/O 原语层（arch-c4b 解环下沉）：graph.yaml 读/写/写前校验落盘、
// 节点/边实体文件读写、graph.yaml 引用列表重建、图级锁。原住 parser.ts，现下沉
// 本文件——parser.ts 保留用例编排层（deleteNode/updateGraph 等），review / fog /
// index-service / snapshot 等低位模块直接依赖此处原语，不再经 parser 中转
// （剪断 amend→parser、fog→parser、index-service→parser 回边）。
//
// 循环依赖说明：graph-io → index-service（writeGraphCore 写后 invalidateIndex）
// 与 index-service → graph-io（readNode/readEdge 读原语）互为环，但两侧都只在
// 函数体内调用对方导出，ESM 函数声明提升下安全（原 parser↔index-service 先例移位）。
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
// 循环依赖说明见文件头。fix_index_cache：写路径必须主动失效索引缓存。
import { invalidateIndex } from "./index-service.js";

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

/** 落盘核心（无锁）：调用方必须已持有图锁（GRAPH_LOCK）。
 * 内部导出供持锁写路径复用（fog.ts 的 graduateFog 先例，同 rebuildGraphRefsLocked 约定）：
 * 图锁不可重入，持锁方不得改调自带加锁的 writeGraph。 */
export function writeGraphCore(rootDir: string, graph: GraphSchema): void {
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

/** 导出仅为 parser.ts 的 deleteNode/deleteEdge 复用（撤引用先于软删文件），非公共 API */
export function removeGraphRef(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
): void {
  syncGraphRef(rootDir, kind, id, true);
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
