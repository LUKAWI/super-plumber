// src/core/edge.ts
import { type EdgeSchema, type EdgeType } from "./types.js";
import { writeEdge, readEdge, edgeFilePath, nodeFilePath, addGraphRef } from "./parser.js";
import { listEdgeFileNames, assertValidEntityId } from "./schema.js";
import { withLockSync } from "./lock.js";
import { appendEvent } from "./eventlog.js";
import * as fs from "node:fs";

export type CreateEdgeParams = {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  contract?: EdgeSchema["contract"];
  /** v0.5：relates 边的领域关系标注（自由文本，非枚举） */
  rel_kind?: string;
};

export function createEdge(
  rootDir: string,
  params: CreateEdgeParams,
  opts: { syncRef?: boolean; actor?: string } = {},
): EdgeSchema {
  // S0-3：入口断言（进锁之前），id 与两端点一并校验（理由同 createNode）
  assertValidEntityId("边", params.id);
  assertValidEntityId("边 source", params.source);
  assertValidEntityId("边 target", params.target);
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
      ...(params.rel_kind !== undefined ? { rel_kind: params.rel_kind } : {}),
    };
    writeEdge(rootDir, edge);
    if (opts.syncRef !== false) addGraphRef(rootDir, "edge", edge.id);
    appendEvent(rootDir, {
      actor: opts.actor ?? "unknown",
      kind: "edge_created",
      edge: edge.id,
      detail: `${edge.source} -[${edge.type}]-> ${edge.target}`,
    });
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
