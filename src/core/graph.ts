// src/core/graph.ts
import {
  type NodeSchema,
  type EdgeSchema,
  NodeStatus,
  TOPOLOGICAL_EDGE_TYPES,
  GRAPH_FILE,
  INDEX_DIR,
  NODES_DIR,
  EDGES_DIR,
} from "./types.js";
import { listNodes, GATE_EDGE_TYPES } from "./node.js";
import { listEdges } from "./edge.js";
import { listNodeFileNames, listEdgeFileNames } from "./schema.js";
import * as fs from "node:fs";
import * as path from "node:path";

export interface GraphIndex {
  nodes: NodeSchema[];
  edges: EdgeSchema[];
  adjacency: Map<string, string[]>; // 正向邻接表
  reverseAdj: Map<string, string[]>; // 反向邻接表
}

/** 构建当前 .graph/ 目录的完整索引（内存） */
export function buildGraphIndex(
  rootDir: string,
  opts: { useCache?: boolean } = {},
): GraphIndex {
  if (opts.useCache) {
    const cached = tryLoadCache(rootDir);
    if (cached) return cached;
  }
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
 * index 新鲜度缓存（需求 4.7：index/ 是派生索引，可删可重建）。
 * 命中条件：index/graph.json 存在且其 mtime 晚于全部源文件与目录。
 * 必须逐文件比对 mtime：目录 mtime 只在增删条目时变化，
 * 文件内容修改（如状态流转）不会更新目录 mtime（Windows/macOS 实测教训）。
 * 变更后回源 YAML，graph rebuild 刷新缓存。
 */
function tryLoadCache(rootDir: string): GraphIndex | null {
  const cacheFile = path.join(rootDir, INDEX_DIR, "graph.json");
  if (!fs.existsSync(cacheFile)) return null;
  const cacheMtime = fs.statSync(cacheFile).mtimeMs;

  const sources: string[] = [path.join(rootDir, GRAPH_FILE)];
  sources.push(...listNodeFileNames(rootDir).map((f) => path.join(rootDir, NODES_DIR, f)));
  sources.push(...listEdgeFileNames(rootDir).map((f) => path.join(rootDir, EDGES_DIR, f)));
  // 目录 mtime 感知增删（listNodeFileNames 返回空时目录也可能不存在）
  sources.push(path.join(rootDir, NODES_DIR), path.join(rootDir, EDGES_DIR));
  for (const s of sources) {
    if (!fs.existsSync(s)) return null;
    if (fs.statSync(s).mtimeMs > cacheMtime) return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as {
      nodes: NodeSchema[];
      edges: EdgeSchema[];
      adjacency: Record<string, string[]>;
      reverseAdj: Record<string, string[]>;
    };
    return {
      nodes: data.nodes,
      edges: data.edges,
      adjacency: new Map(Object.entries(data.adjacency ?? {})),
      reverseAdj: new Map(Object.entries(data.reverseAdj ?? {})),
    };
  } catch {
    return null; // 缓存损坏 → 回源
  }
}

// ── 调度决策（agent 思考流程的核心减负工具）──

export interface NextActionsResult {
  /** 可认领节点（状态 ready） */
  ready: { id: string; label: string }[];
  /** pending/failed 且门控前驱未齐的节点 */
  blocked: {
    id: string;
    label: string;
    unmet: { id: string; status: string }[];
  }[];
  /** 执行中节点（含认领者与已运行时长） */
  running: {
    id: string;
    label: string;
    assigned_to?: string;
    started_at?: string;
    elapsed_ms: number | null;
  }[];
  /** 超过 staleMs 无更新的"疑似卡住"节点（默认 30 分钟） */
  stale_running: { id: string; label: string; elapsed_ms: number }[];
  summary: Record<NodeStatus, number> & { total: number };
}

export function computeNextActions(
  rootDir: string,
  opts: { staleMs?: number } = {},
): NextActionsResult {
  const staleMs = opts.staleMs ?? 30 * 60 * 1000;
  const nodes = listNodes(rootDir);
  const edges = listEdges(rootDir);
  const statusOf = new Map(nodes.map((n) => [n.id, n.status]));

  const summary = {
    total: nodes.length,
    pending: 0,
    ready: 0,
    running: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
  } as NextActionsResult["summary"];
  for (const n of nodes) {
    summary[n.status] = (summary[n.status] ?? 0) + 1;
  }

  const ready: NextActionsResult["ready"] = [];
  const blocked: NextActionsResult["blocked"] = [];
  const running: NextActionsResult["running"] = [];
  const stale_running: NextActionsResult["stale_running"] = [];

  for (const n of nodes) {
    if (n.status === NodeStatus.Ready) {
      ready.push({ id: n.id, label: n.label });
      continue;
    }
    if (n.status === NodeStatus.Running) {
      const started = n.execution_report?.started_at;
      const elapsed_ms = started ? Date.now() - Date.parse(started) : null;
      running.push({
        id: n.id,
        label: n.label,
        assigned_to: n.assigned_to,
        started_at: started,
        elapsed_ms,
      });
      if (elapsed_ms !== null && !Number.isNaN(elapsed_ms) && elapsed_ms > staleMs) {
        stale_running.push({ id: n.id, label: n.label, elapsed_ms });
      }
      continue;
    }
    if (n.status === NodeStatus.Pending || n.status === NodeStatus.Failed) {
      // 门控前驱未齐 → 等依赖（blocked 候选）
      const unmet: { id: string; status: string }[] = [];
      for (const e of edges) {
        if (e.target !== n.id) continue;
        if (!GATE_EDGE_TYPES.includes(e.type)) continue;
        const s = statusOf.get(e.source);
        if (s !== NodeStatus.Passed) {
          unmet.push({ id: e.source, status: s ?? "missing" });
        }
      }
      if (unmet.length > 0) {
        blocked.push({ id: n.id, label: n.label, unmet });
      }
    }
  }

  return { ready, blocked, running, stale_running, summary };
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
