import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import {
  NodeSchema,
  EdgeSchema,
  GraphSchema,
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

export function deleteNode(rootDir: string, id: string): void {
  const filePath = nodeFilePath(rootDir, id);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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

export function deleteEdge(rootDir: string, id: string): void {
  const filePath = edgeFilePath(rootDir, id);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
