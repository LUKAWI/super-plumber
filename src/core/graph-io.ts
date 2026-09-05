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
  GRAPH_DIR,
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
import { GRAPH_LOCK, withLockSync } from "./lock.js";
import { toGraphDir } from "./graph-dir.js";
// arch-c1（C1）：graph.yaml 缺失 → WORKSPACE_NOT_INITIALIZED 单源（此前 CLI 六份手写提示）
import {
  workspaceNotInitialized,
  isWorkspaceNotInitialized,
} from "./errors.js";
// 循环依赖说明见文件头。fix_index_cache：写路径必须主动失效索引缓存。
import { invalidateIndex } from "./index-service.js";

// ── A3 锁体系扩展（f7）：图级锁 ──
// 实体锁（withLockSync(rootDir, id)）只串行化同一实体的读-改-写；
// 跨文件操作（graph.yaml 引用列表 RMW、快照/回滚整树复制、写前校验落盘）
// 需要图级互斥。GRAPH_LOCK 以 "__graph__" 为 id：合法节点 ID 不可能以下划线
// 开头（NODE_ID_RE），天然无碰撞。锁序恒为 实体锁 → 图锁（图锁内不再取
// 任何锁），无死锁环；锁不可重入——图锁持有人必须调 *Core/*Locked 变体。
export { GRAPH_LOCK } from "./lock.js";

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

let atomicWriteCounter = 0;

function writeFileAtomic(file: string, content: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${++atomicWriteCounter}.tmp`,
  );
  try {
    fs.writeFileSync(temp, content, "utf-8");
    fs.renameSync(temp, file);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {
      /* rename 成功后临时路径已不存在 */
    }
  }
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

function graphRefId(kind: "node" | "edge", file: string): string {
  const prefix = kind === "node" ? `${NODES_DIR}/` : `${EDGES_DIR}/`;
  if (!file.startsWith(prefix) || !file.endsWith(".yaml")) {
    throw new Error(
      `${kind === "node" ? "节点" : "边"}引用必须是 ${prefix}<id>.yaml: "${file}"`,
    );
  }
  const id = file.slice(prefix.length, -".yaml".length);
  assertValidEntityId(kind === "node" ? "节点" : "边", id);
  if (file !== `${prefix}${id}.yaml`) {
    throw new Error(`非规范${kind === "node" ? "节点" : "边"}引用: "${file}"`);
  }
  return id;
}

/**
 * graph.yaml 允许先写引用、后写实体（兼容 parser 的作者式工作流），但只要
 * 实体文件已经存在，就必须证明文件名中的 id 与正文 id 相同；否则拒绝写图，
 * 不让一次 graph.yaml 更新覆盖/掩盖另一实体的身份。
 */
function assertExistingEntityIdentity(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
): void {
  const file = kind === "node" ? nodeFilePath(rootDir, id) : edgeFilePath(rootDir, id);
  const res = kind === "node"
    ? loadNodeFile(rootDir, `${id}.yaml`)
    : loadEdgeFile(rootDir, `${id}.yaml`);
  if (res.ok) {
    if (res.data.id !== id) {
      throw new Error(
        `${kind === "node" ? "节点" : "边"}文件身份不一致: ${file} 内部 id="${res.data.id}"，文件名 id="${id}"`,
      );
    }
    return;
  }
  if (res.enoent) return; // 兼容先写 graph.yaml 引用、后落实体的旧工作流
  throw new SchemaValidationError(
    file,
    res.issues,
    `${file} schema 校验失败: ${formatIssues(res.issues)}`,
  );
}

function assertEntityIdentityExists(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
): void {
  const file = kind === "node" ? nodeFilePath(rootDir, id) : edgeFilePath(rootDir, id);
  const res = kind === "node"
    ? loadNodeFile(rootDir, `${id}.yaml`)
    : loadEdgeFile(rootDir, `${id}.yaml`);
  if (res.ok) {
    if (res.data.id !== id) {
      throw new Error(
        `${kind === "node" ? "节点" : "边"}文件身份不一致: ${file} 内部 id="${res.data.id}"，文件名 id="${id}"`,
      );
    }
    return;
  }
  if (res.enoent) throw enoent(file);
  throw new SchemaValidationError(
    file,
    res.issues,
    `${file} schema 校验失败: ${formatIssues(res.issues)}`,
  );
}

function assertGraphReferenceBindings(rootDir: string, graph: GraphSchema): void {
  for (const ref of graph.nodes) {
    const id = graphRefId("node", ref.file);
    assertExistingEntityIdentity(rootDir, "node", id);
  }
  for (const ref of graph.edges) {
    const id = graphRefId("edge", ref.file);
    assertExistingEntityIdentity(rootDir, "edge", id);
  }
}

// ── Graph ──
export function readGraph(rootDir: string): GraphSchema {
  const graphDir = toGraphDir(rootDir);
  const res = loadGraphFile(graphDir);
  if (res.ok) return res.data;
  if (res.enoent) {
    // arch-c1（C1）：WORKSPACE_NOT_INITIALIZED 单源。toGraphDir 对未初始化的
    // ".graph" 目录会再降一级（.graph/.graph）——错误消息里归一回去，提示可读。
    const g = graphDir;
    const dir = path.basename(g) === GRAPH_DIR ? path.dirname(g) : g;
    throw workspaceNotInitialized(dir);
  }
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
  assertGraphReferenceBindings(rootDir, graph);
  const content = yaml.dump(graph, { indent: 2, lineWidth: 120 });
  writeFileAtomic(path.join(toGraphDir(rootDir), GRAPH_FILE), content);
  invalidateIndex(rootDir);
}

export function writeGraph(rootDir: string, graph: GraphSchema): void {
  const graphDir = toGraphDir(rootDir);
  ensureGraphDir(graphDir);
  // S1-4：graph.yaml 写入纳入图级锁——与引用列表 RMW、快照/回滚互斥
  withGraphLock(graphDir, () => writeGraphCore(graphDir, graph));
}

// ── Node ──
export function nodeFilePath(rootDir: string, id: string): string {
  // S0-3 咽喉点：所有 id→路径的构造（读/写/删）统一拒绝穿越形 ID
  assertValidEntityId("节点", id);
  return path.join(toGraphDir(rootDir), NODES_DIR, `${id}.yaml`);
}

export function readNode(rootDir: string, id: string): NodeSchema {
  assertValidEntityId("节点", id); // loadNodeFile 以 id 拼文件名，先行拦截
  const graphDir = toGraphDir(rootDir);
  const res = loadNodeFile(graphDir, `${id}.yaml`);
  if (res.ok) {
    if (res.data.id !== id) {
      throw new Error(
        `节点文件身份不一致: ${nodeFilePath(graphDir, id)} 内部 id="${res.data.id}"，文件名 id="${id}"`,
      );
    }
    return res.data;
  }
  if (res.enoent) throw enoent(nodeFilePath(graphDir, id));
  throw new SchemaValidationError(
    `nodes/${id}.yaml`,
    res.issues,
    `Node ${id} schema 校验失败: ${formatIssues(res.issues)}`,
  );
}

export function writeNodeCore(rootDir: string, node: NodeSchema): void {
  assertWritable(`nodes/${node.id}.yaml`, validateNode(node));
  assertExistingEntityIdentity(rootDir, "node", node.id);
  const content = yaml.dump(node, { indent: 2, lineWidth: 120 });
  writeFileAtomic(nodeFilePath(rootDir, node.id), content);
  invalidateIndex(rootDir);
}

export function writeNode(rootDir: string, node: NodeSchema): void {
  const graphDir = toGraphDir(rootDir);
  ensureGraphDir(graphDir);
  // S1-11：单文件写入纳入图级锁——快照逐文件 copyFileSync 期间不再与写路径
  // 穿插（撕裂副本），回滚恢复期间写入被互斥（防复活半旧状态）
  withGraphLock(graphDir, () => writeNodeCore(graphDir, node));
}

/**
 * 从 nodes/edges 目录一次性重建 graph.yaml 引用列表。
 * 批量创建（graph_batch_create / 脚本）时配合 syncRef:false 使用，
 * 避免每个节点/边创建都重写一次 graph.yaml（O(n²) → O(n)）。
 * 重建含读-改-写，公共入口自持图级锁；持锁调用方（rollback）用 *Locked 变体。
 */
export function rebuildGraphRefs(rootDir: string): void {
  const graphDir = toGraphDir(rootDir);
  withGraphLock(graphDir, () => rebuildGraphRefsLocked(graphDir));
}

/** 重建核心（无锁）：调用方必须已持有图锁（GRAPH_LOCK） */
export function rebuildGraphRefsLocked(rootDir: string): void {
  let graph: GraphSchema;
  try {
    graph = readGraph(rootDir);
  } catch (err: any) {
    if (isWorkspaceNotInitialized(err)) return; // 图未初始化（arch-c1：code 判定单源）
    throw err;
  }
  graph.nodes = listNodeFileNames(rootDir).map((f) => ({ file: `nodes/${f}` }));
  graph.edges = listEdgeFileNames(rootDir).map((f) => ({ file: `edges/${f}` }));
  writeGraphCore(rootDir, graph);
}

// ── graph.yaml 引用列表同步（node/edge 创建与软删除时维护）──
// S1-4：读-改-写全程持图级锁——调用方只持各自实体 id 锁，不同 id 并发时
// 旧实现互相覆盖（丢条目），此处补上图级互斥（公共咽喉，CLI/MCP 全覆盖）。
function syncGraphRefLocked(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
  remove: boolean,
): void {
  assertValidEntityId(kind === "node" ? "节点" : "边", id);
  let graph: GraphSchema;
  try {
    graph = readGraph(rootDir);
  } catch (err: any) {
    if (isWorkspaceNotInitialized(err)) return; // 图未初始化时跳过（无 graph.yaml 可同步；arch-c1 code 判定）
    throw err; // schema 损坏必须浮出，不得静默
  }
  const list = kind === "node" ? graph.nodes : graph.edges;
  const file = kind === "node" ? `nodes/${id}.yaml` : `edges/${id}.yaml`;
  const idx = list.findIndex((r) => r.file === file);
  if (remove) {
    if (idx === -1) return;
    list.splice(idx, 1);
  } else {
    // 创建引用是实体+graph.yaml 的一次事务的一部分，不能接受缺失或身份错配文件。
    assertEntityIdentityExists(rootDir, kind, id);
    if (idx !== -1) return; // 已存在
    list.push({ file });
  }
  writeGraphCore(rootDir, graph);
}

export function addGraphRefLocked(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
): void {
  syncGraphRefLocked(rootDir, kind, id, false);
}

export function removeGraphRefLocked(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
): void {
  syncGraphRefLocked(rootDir, kind, id, true);
}

export function addGraphRef(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
): void {
  const graphDir = toGraphDir(rootDir);
  withGraphLock(graphDir, () => addGraphRefLocked(graphDir, kind, id));
}

/** 导出仅为 parser.ts 的 deleteNode/deleteEdge 复用（撤引用先于软删文件），非公共 API */
export function removeGraphRef(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
): void {
  const graphDir = toGraphDir(rootDir);
  withGraphLock(graphDir, () => removeGraphRefLocked(graphDir, kind, id));
}

// ── Edge ──
export function edgeFilePath(rootDir: string, id: string): string {
  assertValidEntityId("边", id);
  return path.join(toGraphDir(rootDir), EDGES_DIR, `${id}.yaml`);
}

export function readEdge(rootDir: string, id: string): EdgeSchema {
  assertValidEntityId("边", id);
  const graphDir = toGraphDir(rootDir);
  const res = loadEdgeFile(graphDir, `${id}.yaml`);
  if (res.ok) {
    if (res.data.id !== id) {
      throw new Error(
        `边文件身份不一致: ${edgeFilePath(graphDir, id)} 内部 id="${res.data.id}"，文件名 id="${id}"`,
      );
    }
    return res.data;
  }
  if (res.enoent) throw enoent(edgeFilePath(graphDir, id));
  throw new SchemaValidationError(
    `edges/${id}.yaml`,
    res.issues,
    `Edge ${id} schema 校验失败: ${formatIssues(res.issues)}`,
  );
}

export function writeEdgeCore(rootDir: string, edge: EdgeSchema): void {
  assertWritable(`edges/${edge.id}.yaml`, validateEdge(edge));
  assertExistingEntityIdentity(rootDir, "edge", edge.id);
  const content = yaml.dump(edge, { indent: 2, lineWidth: 120 });
  writeFileAtomic(edgeFilePath(rootDir, edge.id), content);
  invalidateIndex(rootDir);
}

export function writeEdge(rootDir: string, edge: EdgeSchema): void {
  const graphDir = toGraphDir(rootDir);
  ensureGraphDir(graphDir);
  withGraphLock(graphDir, () => writeEdgeCore(graphDir, edge));
}
