// src/core/edge.ts
import { type EdgeSchema, type EdgeType, EDGES_DIR } from "./types.js";
import { writeEdge, readEdge, edgeFilePath, addGraphRef } from "./parser.js";
import * as fs from "node:fs";
import * as path from "node:path";

export type CreateEdgeParams = {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  contract?: EdgeSchema["contract"];
};

export function createEdge(
  rootDir: string,
  params: CreateEdgeParams,
): EdgeSchema {
  // 重复 id 检查：不静默覆盖已有边
  if (fs.existsSync(edgeFilePath(rootDir, params.id))) {
    throw new Error(`Edge ${params.id} already exists`);
  }
  const edge: EdgeSchema = {
    id: params.id,
    source: params.source,
    target: params.target,
    type: params.type,
    ...(params.contract ? { contract: params.contract } : {}),
  };
  writeEdge(rootDir, edge);
  addGraphRef(rootDir, "edge", edge.id);
  return edge;
}

export function getEdge(rootDir: string, id: string): EdgeSchema {
  return readEdge(rootDir, id);
}

export function listEdges(rootDir: string): EdgeSchema[] {
  const edgesDir = path.join(rootDir, EDGES_DIR);
  if (!fs.existsSync(edgesDir)) return [];
  return fs
    .readdirSync(edgesDir)
    .filter((f) => f.endsWith(".yaml") && !f.includes(".deleted"))
    .map((f) => readEdge(rootDir, f.replace(/\.yaml$/, "")));
}
