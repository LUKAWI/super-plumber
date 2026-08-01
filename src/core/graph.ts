// src/core/graph.ts
import {
  type NodeSchema,
  type EdgeSchema,
  TOPOLOGICAL_EDGE_TYPES,
} from "./types.js";
import { listNodes } from "./node.js";
import { listEdges } from "./edge.js";

export interface GraphIndex {
  nodes: NodeSchema[];
  edges: EdgeSchema[];
  adjacency: Map<string, string[]>; // 正向邻接表
  reverseAdj: Map<string, string[]>; // 反向邻接表
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
  edges: Pick<EdgeSchema, "source" | "target" | "type">[],
): string[] {
  const topologicalEdges = edges.filter((e) =>
    TOPOLOGICAL_EDGE_TYPES.includes(e.type),
  );

  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    outEdges.set(id, []);
  }

  for (const e of topologicalEdges) {
    // 悬挂边：source 不在图中 → 忽略（与 detectCycles 一致），否则入度永不归零误报环
    if (!outEdges.has(e.source)) continue;
    outEdges.get(e.source)!.push(e.target);
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
    throw new Error(`Cycle detected among nodes: [${unprocessed.join(", ")}].`);
  }

  return result;
}

/** 检测环，返回所有环路径。迭代版 DFS（显式栈），避免深链图递归栈溢出 */
export function detectCycles(
  nodeIds: string[],
  edges: Pick<EdgeSchema, "source" | "target" | "type">[],
): string[][] {
  const topologicalEdges = edges.filter((e) =>
    TOPOLOGICAL_EDGE_TYPES.includes(e.type),
  );

  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const e of topologicalEdges) {
    adjacency.get(e.source)?.push(e.target);
  }

  const cycles: string[][] = [];
  const color = new Map<string, 0 | 1 | 2>(); // 0=未访问 1=在栈中 2=已完成
  const stack: string[] = [];
  const path: string[] = [];
  const nextIdx = new Map<string, number>();

  for (const id of nodeIds) {
    if (color.get(id) === 2) continue;
    color.set(id, 1);
    stack.push(id);
    path.push(id);
    nextIdx.set(id, 0);

    while (stack.length > 0) {
      const cur = stack[stack.length - 1];
      const neighbors = adjacency.get(cur) ?? [];
      const i = nextIdx.get(cur) ?? 0;

      if (i < neighbors.length) {
        nextIdx.set(cur, i + 1);
        const nb = neighbors[i];
        const c = color.get(nb) ?? 0;
        if (c === 1) {
          // 后向边：记录从 nb 到当前路径末尾再回到 nb 的环
          const cycleStart = path.indexOf(nb);
          cycles.push([...path.slice(cycleStart), nb]);
        } else if (c === 0) {
          color.set(nb, 1);
          stack.push(nb);
          path.push(nb);
          nextIdx.set(nb, 0);
        }
        // c === 2：已完成节点的边，跳过
      } else {
        color.set(cur, 2);
        stack.pop();
        path.pop();
        nextIdx.delete(cur);
      }
    }
  }

  return cycles;
}
