// src/core/edge.ts
import { EdgeSchema, EdgeType, EDGES_DIR } from "./types.js";
import { writeEdge, readEdge } from "./parser.js";
import * as fs from "node:fs";
import * as path from "node:path";

export type CreateEdgeParams = {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  contract?: EdgeSchema["contract"];
};

export function createEdge(rootDir: string, params: CreateEdgeParams): EdgeSchema {
  const edge: EdgeSchema = {
    id: params.id,
    source: params.source,
    target: params.target,
    type: params.type,
    ...(params.contract ? { contract: params.contract } : {}),
  };
  writeEdge(rootDir, edge);
  return edge;
}

export function getEdge(rootDir: string, id: string): EdgeSchema {
  return readEdge(rootDir, id);
}

export function listEdges(rootDir: string): EdgeSchema[] {
  const edgesDir = path.join(rootDir, EDGES_DIR);
  if (!fs.existsSync(edgesDir)) return [];
  return fs.readdirSync(edgesDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => readEdge(rootDir, f.replace(/\.yaml$/, "")));
}
