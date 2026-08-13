// src/core/edge.ts
import { type EdgeSchema, type EdgeType } from "./types.js";
import { writeEdge, readEdge, edgeFilePath, addGraphRef } from "./parser.js";
import { listEdgeFileNames } from "./schema.js";
import { withLockSync } from "./lock.js";
import * as fs from "node:fs";

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
  return withLockSync(rootDir, params.id, () => {
    // 重复 id 检查（锁内）：不静默覆盖已有边，并发创建也只有一个成功
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
  });
}

export function getEdge(rootDir: string, id: string): EdgeSchema {
  return readEdge(rootDir, id);
}

export function listEdges(rootDir: string): EdgeSchema[] {
  return listEdgeFileNames(rootDir).map((f) =>
    readEdge(rootDir, f.replace(/\.yaml$/, "")),
  );
}
