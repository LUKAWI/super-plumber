// src/core/graph.ts
// 图操作：拓扑排序 + 循环检测（纯函数，无文件 I/O）。
// 索引构建（buildGraphIndex）与调度决策（computeNextActions）实现在
// index-service.ts（两级缓存 + 热路径优化），此处重导出以保持既有 import 路径兼容。
import {
  type EdgeSchema,
  EdgeType,
  TOPOLOGICAL_EDGE_TYPES,
  GATE_EDGE_TYPES,
} from "./types.js";

export {
  buildGraphIndex,
  computeNextActions,
  resetIndexCache,
  // DEC-1（g080-approve-core）：图级 review 凭据判定（claim 响应注入用，与 adr_flags 同款提示语义）
  reviewFlagFor,
  REVIEW_FLAG_UNREVIEWED,
} from "./index-service.js";
export type { GraphIndex, NextActionsResult } from "./index-service.js";

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
    // 悬挂边（source 或 target 不在图中）→ 忽略（与 detectCycles 一致），
    // 否则幽灵 target 被入队会导致 result 长度超过 nodeIds 误报环
    if (!outEdges.has(e.source)) continue;
    if (!inDegree.has(e.target)) continue;
    outEdges.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  // S3-8（f16）：头指针出队代替 queue.shift()——shift() 头删需整体搬移 O(n)，
  // 整个排序退化为 O(n²)，10k 节点（尤其链式图）达秒级以上；头指针只前进
  // 不搬移，出队 O(1)，总复杂度回到 O(V+E)。数组本身留给 GC，无需截断。
  let head = 0;
  while (head < queue.length) {
    const node = queue[head]!;
    head++;
    result.push(node);
    for (const neighbor of outEdges.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (result.length !== nodeIds.length) {
    // S3-8（f16）：环上节点收集用 Set——此前 filter×result.includes 是 O(n²)，
    // 10k 节点环图的报错路径本身就要跑秒级
    const processed = new Set(result);
    const unprocessed = nodeIds.filter((id) => !processed.has(id));
    throw new Error(`Cycle detected among nodes: [${unprocessed.join(", ")}].`);
  }

  return result;
}

/** 检测环，返回所有环路径。迭代版 DFS（显式栈），避免深链图递归栈溢出 */
export function detectCycles(
  nodeIds: string[],
  edges: Pick<EdgeSchema, "source" | "target" | "type">[],
): string[][] {
  return findCycles(nodeIds, edges, TOPOLOGICAL_EDGE_TYPES);
}

// FIX-B1（评审 B 级·运行时边装饰性）：隐藏环路 = 仅在引入 fan_out/fan_in
// 门控边之后才闭合的环。这些边参与 ready 门禁（互等前驱 passed），环即真实
// 互等死锁——今天就会发生，但拓扑排序/detectCycles 刻意忽略它们，完全不可见。
// fallback/iterates 的单边闭合属于设计内的回退/迭代模式（不告警，改为
// validate 对每条此类边发"无运行时语义"警告）。
const HIDDEN_CYCLE_EDGE_TYPES: readonly EdgeType[] = [...GATE_EDGE_TYPES];

function cycleKey(cycle: string[]): string {
  return [...new Set(cycle)].sort().join(",");
}

export function detectHiddenCycles(
  nodeIds: string[],
  edges: Pick<EdgeSchema, "source" | "target" | "type">[],
): string[][] {
  const visible = new Set(detectCycles(nodeIds, edges).map(cycleKey));
  const seen = new Set<string>();
  const hidden: string[][] = [];
  for (const cycle of findCycles(nodeIds, edges, HIDDEN_CYCLE_EDGE_TYPES)) {
    const key = cycleKey(cycle);
    if (visible.has(key) || seen.has(key)) continue;
    seen.add(key);
    hidden.push(cycle);
  }
  return hidden;
}

function findCycles(
  nodeIds: string[],
  edges: Pick<EdgeSchema, "source" | "target" | "type">[],
  allowedTypes: readonly EdgeType[],
): string[][] {
  const activeEdges = edges.filter((e) => allowedTypes.includes(e.type));

  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const e of activeEdges) {
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
