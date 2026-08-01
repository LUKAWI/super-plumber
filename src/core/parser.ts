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

export function ensureGraphDir(rootDir: string): void {
  fs.mkdirSync(path.join(rootDir, NODES_DIR), { recursive: true });
  fs.mkdirSync(path.join(rootDir, EDGES_DIR), { recursive: true });
}

// ── Graph ──
export function readGraph(rootDir: string): GraphSchema {
  const content = fs.readFileSync(path.join(rootDir, GRAPH_FILE), "utf-8");
  return yaml.load(content) as GraphSchema;
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
  const content = fs.readFileSync(nodeFilePath(rootDir, id), "utf-8");
  return yaml.load(content) as NodeSchema;
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
  } catch {
    return; // 图未初始化时跳过（无 graph.yaml 可同步）
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

export function deleteNode(rootDir: string, id: string): void {
  const filePath = nodeFilePath(rootDir, id);
  if (!fs.existsSync(filePath)) throw new Error(`Node ${id} not found`);
  // soft delete: rename to .deleted.yaml 保留历史
  const deletedPath = filePath.replace(/\.yaml$/, ".deleted.yaml");
  // 如果已存在 .deleted 文件，先追加时间戳
  const finalPath = fs.existsSync(deletedPath)
    ? filePath.replace(/\.yaml$/, `.deleted.${Date.now()}.yaml`)
    : deletedPath;
  fs.renameSync(filePath, finalPath);
  removeGraphRef(rootDir, "node", id);
}

export function deleteEdge(rootDir: string, id: string): void {
  const filePath = edgeFilePath(rootDir, id);
  if (!fs.existsSync(filePath)) throw new Error(`Edge ${id} not found`);
  const deletedPath = filePath.replace(/\.yaml$/, ".deleted.yaml");
  const finalPath = fs.existsSync(deletedPath)
    ? filePath.replace(/\.yaml$/, `.deleted.${Date.now()}.yaml`)
    : deletedPath;
  fs.renameSync(filePath, finalPath);
  removeGraphRef(rootDir, "edge", id);
}

// ── Edge ──
export function edgeFilePath(rootDir: string, id: string): string {
  return path.join(rootDir, EDGES_DIR, `${id}.yaml`);
}

export function readEdge(rootDir: string, id: string): EdgeSchema {
  const content = fs.readFileSync(edgeFilePath(rootDir, id), "utf-8");
  return yaml.load(content) as EdgeSchema;
}

export function writeEdge(rootDir: string, edge: EdgeSchema): void {
  ensureGraphDir(rootDir);
  const content = yaml.dump(edge, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(edgeFilePath(rootDir, edge.id), content, "utf-8");
}
