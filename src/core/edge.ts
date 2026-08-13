// src/core/edge.ts
import { type EdgeSchema, type EdgeType } from "./types.js";
import { writeEdge, readEdge, edgeFilePath, nodeFilePath, addGraphRef } from "./parser.js";
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
  opts: { syncRef?: boolean } = {},
): EdgeSchema {
  return withLockSync(rootDir, params.id, () => {
    // 重复 id 检查（锁内）：不静默覆盖已有边，并发创建也只有一个成功
    if (fs.existsSync(edgeFilePath(rootDir, params.id))) {
      throw new Error(`Edge ${params.id} already exists`);
    }
    // 端点存在性检查：核心层统一拦截幽灵边（CLI/MCP/脚本/批量创建全走这里）
    if (!fs.existsSync(nodeFilePath(rootDir, params.source))) {
      throw new Error(`Edge ${params.id}: source node ${params.source} not found`);
    }
    if (!fs.existsSync(nodeFilePath(rootDir, params.target))) {
      throw new Error(`Edge ${params.id}: target node ${params.target} not found`);
    }
    const edge: EdgeSchema = {
      id: params.id,
      source: params.source,
      target: params.target,
      type: params.type,
      ...(params.contract ? { contract: params.contract } : {}),
    };
    writeEdge(rootDir, edge);
    if (opts.syncRef !== false) addGraphRef(rootDir, "edge", edge.id);
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
