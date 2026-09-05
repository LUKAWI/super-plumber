// src/core/edge.ts
import { type EdgeSchema, type EdgeType } from "./types.js";
import {
  writeEdgeCore,
  readEdge,
  readNode,
  edgeFilePath,
  nodeFilePath,
  addGraphRefLocked,
  ensureGraphDir,
  withGraphLock,
} from "./graph-io.js";
import { listEdgeFileNames, assertValidEntityId } from "./schema.js";
import { withLocksSync } from "./lock.js";
import { appendEvent } from "./eventlog.js";
import { withGraphAmend } from "./amend.js";
import { toGraphDir } from "./graph-dir.js";
import { invalidateIndex } from "./index-service.js";
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
  const graphDir = toGraphDir(rootDir);
  return withLocksSync(graphDir, [params.source, params.target], () => {
    // 重复 id 检查（锁内）：不静默覆盖已有边，并发创建也只有一个成功
    if (fs.existsSync(edgeFilePath(graphDir, params.id))) {
      throw new Error(`Edge ${params.id} already exists`);
    }
    // 端点存在性检查：核心层统一拦截幽灵边（CLI/MCP/脚本/批量创建全走这里）
    if (!fs.existsSync(nodeFilePath(graphDir, params.source))) {
      throw new Error(`Edge ${params.id}: source node ${params.source} not found`);
    }
    if (!fs.existsSync(nodeFilePath(graphDir, params.target))) {
      throw new Error(`Edge ${params.id}: target node ${params.target} not found`);
    }
    // 文件存在不等于身份正确：删除/重命名补偿或手工文件不能被边创建误认。
    readNode(graphDir, params.source);
    readNode(graphDir, params.target);
    // F21 (a)(b)（C5 组合器）：结构修订守卫——落图前自动快照 + 成功后
    // graph_amended 事件/review 回置。拒绝路径（上方重复/幽灵端点）在守卫段
    // 之前，不留快照；batch_create 外层统一守卫，嵌套内层自动免守卫。
    return withGraphAmend(
      graphDir,
      { action: "add-edge", target: params.id, actor: opts.actor },
      () => {
        const edge: EdgeSchema = {
          id: params.id,
          source: params.source,
          target: params.target,
          type: params.type,
          ...(params.contract ? { contract: params.contract } : {}),
          ...(params.rel_kind !== undefined ? { rel_kind: params.rel_kind } : {}),
        };
        return withGraphLock(graphDir, () => {
          if (fs.existsSync(edgeFilePath(graphDir, params.id))) {
            throw new Error(`Edge ${params.id} already exists`);
          }
          ensureGraphDir(graphDir);
          let entityWritten = false;
          try {
            writeEdgeCore(graphDir, edge);
            entityWritten = true;
            if (opts.syncRef !== false) addGraphRefLocked(graphDir, "edge", edge.id);
          } catch (error) {
            // graph.yaml 写失败时补偿已发布的边文件，避免“边在磁盘但无引用”
            // 或下一次重试被半成品占名；清理失败仍抛原始异常供上层处置。
            if (entityWritten) {
              try {
                fs.rmSync(edgeFilePath(graphDir, edge.id), { force: true });
                invalidateIndex(graphDir);
              } catch {
                /* best-effort compensation */
              }
            }
            throw error;
          }
          appendEvent(graphDir, {
            actor: opts.actor ?? "unknown",
            kind: "edge_created",
            edge: edge.id,
            detail: `${edge.source} -[${edge.type}]-> ${edge.target}`,
          });
          return edge;
        });
      },
    );
  });
}

export function getEdge(rootDir: string, id: string): EdgeSchema {
  return readEdge(rootDir, id);
}

export function listEdges(rootDir: string): EdgeSchema[] {
  const graphDir = toGraphDir(rootDir);
  return listEdgeFileNames(graphDir).map((f) =>
    readEdge(graphDir, f.replace(/\.yaml$/, "")),
  );
}
