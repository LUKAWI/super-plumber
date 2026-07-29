// src/core/graph.ts
import { NodeSchema, EdgeSchema, TOPOLOGICAL_EDGE_TYPES } from "./types.js";
import { listNodes } from "./node.js";
import { listEdges } from "./edge.js";

export interface GraphIndex {
  nodes: NodeSchema[];
  edges: EdgeSchema[];
  adjacency: Map<string, string[]>;   // 正向邻接表
  reverseAdj: Map<string, string[]>;  // 反向邻接表
}

/** 构建当前 .graph/ 目录的完整索引（内存） */
export function buildGraphIndex(rootDir: string): GraphIndex {
  const nodes = listNodes(rootDir);
  const edges = listEdges(rootDir);
  const adjacency = new Map<string, string[]>();
  const reverseAdj = new Map<string, string[]>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
    reverseAdj.set(node.id, []);
  }

  for (const edge of edges) {
    if (!TOPOLOGICAL_EDGE_TYPES.includes(edge.type)) continue;
    if (adjacency.has(edge.source)) {
      adjacency.get(edge.source)!.push(edge.target);
    }
    if (reverseAdj.has(edge.target)) {
      reverseAdj.get(edge.target)!.push(edge.source);
    }
  }

  return { nodes, edges, adjacency, reverseAdj };
}

/**
 * 拓扑排序（Kahn 算法）。只考虑 TOPOLOGICAL_EDGE_TYPES 中的边。
 */
export function topologicalSort(
  nodeIds: string[],
  edges: Pick<EdgeSchema, "source" | "target" | "type">[]
): string[] {
  const topologicalEdges = edges.filter((e) =>
    TOPOLOGICAL_EDGE_TYPES.includes(e.type)
  );

  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    outEdges.set(id, []);
  }

  for (const e of topologicalEdges) {
    outEdges.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const neighbor of outEdges.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (result.length !== nodeIds.length) {
    const unprocessed = nodeIds.filter((id) => !result.includes(id));
    throw new Error(
      `Cycle detected among nodes: [${unprocessed.join(", ")}].`
    );
  }

  return result;
}

/** 检测环，返回所有环路径 */
export function detectCycles(
  nodeIds: string[],
  edges: Pick<EdgeSchema, "source" | "target" | "type">[]
): string[][] {
  const topologicalEdges = edges.filter((e) =>
    TOPOLOGICAL_EDGE_TYPES.includes(e.type)
  );

  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const e of topologicalEdges) {
    adjacency.get(e.source)?.push(e.target);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string) {
    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (inStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push([...path.slice(cycleStart), neighbor]);
      }
    }

    path.pop();
    inStack.delete(node);
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) dfs(id);
  }

  return cycles;
}
