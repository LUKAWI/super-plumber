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
  SchemaValidationError,
  formatIssues,
} from "./schema.js";
import { withLockSync } from "./lock.js";

export { SchemaValidationError, formatIssues };

export function ensureGraphDir(rootDir: string): void {
  fs.mkdirSync(path.join(rootDir, NODES_DIR), { recursive: true });
  fs.mkdirSync(path.join(rootDir, EDGES_DIR), { recursive: true });
}

function enoent(file: string): Error & { code: string } {
  const err = new Error(`File not found: ${file}`) as Error & { code: string };
  err.code = "ENOENT";
  return err;
}

// ── Graph ──
export function readGraph(rootDir: string): GraphSchema {
  const res = loadGraphFile(rootDir);
  if (res.ok) return res.data;
  if (res.enoent) throw enoent(path.join(rootDir, GRAPH_FILE));
  throw new SchemaValidationError(
    GRAPH_FILE,
    res.issues,
    `graph.yaml schema 校验失败: ${formatIssues(res.issues)}`,
  );
}

export function writeGraph(rootDir: string, graph: GraphSchema): void {
  ensureGraphDir(rootDir);
  const content = yaml.dump(graph, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(path.join(rootDir, GRAPH_FILE), content, "utf-8");
}

// ── Node ──
export function nodeFilePath(rootDir: string, id: string): string {
  return path.join(rootDir, NODES_DIR, `${id}.yaml`);
}

export function readNode(rootDir: string, id: string): NodeSchema {
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
  const content = yaml.dump(node, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(nodeFilePath(rootDir, node.id), content, "utf-8");
}

// ── graph.yaml 引用列表同步（node/edge 创建与软删除时维护）──
function syncGraphRef(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
  remove: boolean,
): void {
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
  writeGraph(rootDir, graph);
}

export function addGraphRef(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
): void {
  syncGraphRef(rootDir, kind, id, false);
}

function removeGraphRef(
  rootDir: string,
  kind: "node" | "edge",
  id: string,
): void {
  syncGraphRef(rootDir, kind, id, true);
}

function softDelete(filePath: string): string {
  const deletedPath = filePath.replace(/\.yaml$/, ".deleted.yaml");
  // 如果已存在 .deleted 文件，先追加时间戳
  const finalPath = fs.existsSync(deletedPath)
    ? filePath.replace(/\.yaml$/, `.deleted.${Date.now()}.yaml`)
    : deletedPath;
  fs.renameSync(filePath, finalPath);
  return finalPath;
}

export function deleteNode(
  rootDir: string,
  id: string,
  opts: { cascade?: boolean } = {},
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
      for (const edgeId of referencing) deleteEdge(rootDir, edgeId);
    }

    // soft delete: rename to .deleted.yaml 保留历史
    softDelete(filePath);
    removeGraphRef(rootDir, "node", id);
  });
}

export function deleteEdge(rootDir: string, id: string): void {
  return withLockSync(rootDir, id, () => {
    const filePath = edgeFilePath(rootDir, id);
    if (!fs.existsSync(filePath)) throw new Error(`Edge ${id} not found`);
    softDelete(filePath);
    removeGraphRef(rootDir, "edge", id);
  });
}

// ── Edge ──
export function edgeFilePath(rootDir: string, id: string): string {
  return path.join(rootDir, EDGES_DIR, `${id}.yaml`);
}

export function readEdge(rootDir: string, id: string): EdgeSchema {
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
  const content = yaml.dump(edge, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(edgeFilePath(rootDir, edge.id), content, "utf-8");
}
