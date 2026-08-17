// src/core/index-service.ts
// 图索引服务：buildGraphIndex / computeNextActions 的实现与两级缓存。
//
// 为什么单独成文件：checkReadyGate（node.ts）与 computeNextActions 都是 agent
// 每轮必调的热路径。若每次调用都全量 listNodes + listEdges（10k 图 ≈ 2 万次文件读
// + YAML 解析 + schema 校验，实测 ~9s），多 agent 长程运行会被磁盘 I/O 拖垮；
// 而 computeNextActions 的 blocked 检测是 O(N×M)（16k 节点实测 15.9s）。
//
// 缓存设计（双轨，新鲜度校验均为精确的逐文件 mtime 比对——跨进程写入可见）：
// 1. 进程内内存缓存：命中时零文件读；2 万次 stat 实测 ~0.4s，比 2 万次读+解析
//    ~9.4s 快一个量级。MCP/Web 等长驻进程的主要收益来源；
// 2. 磁盘缓存 .graph/index/graph.json（未命中时构建后落盘）：新进程冷启动时用
//    stat 校验 + JSON.parse 替代全量文件读，冷路径从 ~9s 降到 <1.5s。
//
// 旧格式磁盘缓存（缺 gateReverseAdj 字段）在加载时从 edges 就地推导，保持兼容。
// 新增 gateReverseAdj（4 种门控边的反向邻接）是 checkReadyGate 与
// computeNextActions 从"全图扫描"变为"按需查表"的关键数据结构。

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type NodeSchema,
  type EdgeSchema,
  NodeStatus,
  TOPOLOGICAL_EDGE_TYPES,
  GATE_EDGE_TYPES,
  GRAPH_FILE,
  INDEX_DIR,
  NODES_DIR,
  EDGES_DIR,
} from "./types.js";
import { listNodeFileNames, listEdgeFileNames } from "./schema.js";
import { readNode, readEdge } from "./parser.js";

export interface GraphIndex {
  nodes: NodeSchema[];
  edges: EdgeSchema[];
  /** 拓扑正向邻接（depends_on/validates），源 → 目标列表 */
  adjacency: Map<string, string[]>;
  /** 拓扑反向邻接，目标 → 源列表 */
  reverseAdj: Map<string, string[]>;
  /** 门控反向邻接（depends_on/validates/fan_in/fan_out），目标 → 门控源列表 */
  gateReverseAdj: Map<string, string[]>;
}

/** 从源文件全量构建索引（读 + YAML 解析 + schema 校验，O(N+M) 文件读） */
function buildFromSources(rootDir: string): GraphIndex {
  const nodes = listNodeFileNames(rootDir).map((f) =>
    readNode(rootDir, f.replace(/\.yaml$/, "")),
  );
  const edges = listEdgeFileNames(rootDir).map((f) =>
    readEdge(rootDir, f.replace(/\.yaml$/, "")),
  );
  const adjacency = new Map<string, string[]>();
  const reverseAdj = new Map<string, string[]>();
  const gateReverseAdj = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
    reverseAdj.set(node.id, []);
    gateReverseAdj.set(node.id, []);
  }
  for (const edge of edges) {
    if (TOPOLOGICAL_EDGE_TYPES.includes(edge.type)) {
      if (adjacency.has(edge.source) && reverseAdj.has(edge.target)) {
        adjacency.get(edge.source)!.push(edge.target);
        reverseAdj.get(edge.target)!.push(edge.source);
      }
    }
    if (GATE_EDGE_TYPES.includes(edge.type)) {
      if (gateReverseAdj.has(edge.target)) {
        gateReverseAdj.get(edge.target)!.push(edge.source);
      }
    }
  }
  return { nodes, edges, adjacency, reverseAdj, gateReverseAdj };
}

interface MemCacheEntry {
  builtAt: number;
  index: GraphIndex;
}

const memCache = new Map<string, MemCacheEntry>();

/** 测试辅助：清空进程内索引缓存 */
export function resetIndexCache(): void {
  memCache.clear();
}

function allSourcePaths(rootDir: string): string[] {
  const files: string[] = [path.join(rootDir, GRAPH_FILE)];
  files.push(
    ...listNodeFileNames(rootDir).map((f) => path.join(rootDir, NODES_DIR, f)),
  );
  files.push(
    ...listEdgeFileNames(rootDir).map((f) => path.join(rootDir, EDGES_DIR, f)),
  );
  // 目录 mtime 感知增删（内容修改不更新目录 mtime，因此必须逐文件比对）
  files.push(path.join(rootDir, NODES_DIR), path.join(rootDir, EDGES_DIR));
  return files;
}

/** 精确新鲜度校验：任何源文件/目录 mtime 晚于 builtAt 即失效 */
function isFresh(rootDir: string, builtAt: number): boolean {
  for (const f of allSourcePaths(rootDir)) {
    let st: fs.Stats;
    try {
      st = fs.statSync(f);
    } catch {
      return false;
    }
    if (st.mtimeMs > builtAt) return false;
  }
  return true;
}

function loadDiskCache(rootDir: string): MemCacheEntry | null {
  const cacheFile = path.join(rootDir, INDEX_DIR, "graph.json");
  if (!fs.existsSync(cacheFile)) return null;
  let cacheStat: fs.Stats;
  try {
    cacheStat = fs.statSync(cacheFile);
  } catch {
    return null;
  }
  if (!isFresh(rootDir, cacheStat.mtimeMs)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as {
      nodes: NodeSchema[];
      edges: EdgeSchema[];
      adjacency?: Record<string, string[]>;
      reverseAdj?: Record<string, string[]>;
      gateReverseAdj?: Record<string, string[]>;
    };
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;
    const adjacency = new Map<string, string[]>(
      Object.entries(data.adjacency ?? {}),
    );
    const reverseAdj = new Map<string, string[]>(
      Object.entries(data.reverseAdj ?? {}),
    );
    let gateReverseAdj: Map<string, string[]>;
    if (data.gateReverseAdj !== undefined) {
      gateReverseAdj = new Map(Object.entries(data.gateReverseAdj));
    } else {
      // 旧格式缓存：从 edges 就地推导门控邻接
      gateReverseAdj = new Map<string, string[]>();
      for (const n of data.nodes) gateReverseAdj.set(n.id, []);
      for (const e of data.edges) {
        if (GATE_EDGE_TYPES.includes(e.type)) {
          const list = gateReverseAdj.get(e.target);
          if (list) list.push(e.source);
        }
      }
    }
    return {
      builtAt: cacheStat.mtimeMs,
      index: {
        nodes: data.nodes,
        edges: data.edges,
        adjacency,
        reverseAdj,
        gateReverseAdj,
      },
    };
  } catch {
    return null; // 缓存损坏 → 回源
  }
}

function writeDiskCache(rootDir: string, index: GraphIndex): void {
  try {
    const dir = path.join(rootDir, INDEX_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "graph.json"),
      JSON.stringify(
        {
          nodes: index.nodes,
          edges: index.edges,
          adjacency: Object.fromEntries(index.adjacency),
          reverseAdj: Object.fromEntries(index.reverseAdj),
          gateReverseAdj: Object.fromEntries(index.gateReverseAdj),
        },
        null,
        2,
      ),
      "utf-8",
    );
  } catch {
    /* 磁盘缓存写入失败不影响正确性（下次回源重建） */
  }
}

/**
 * 构建当前 .graph/ 目录的完整索引。
 * useCache=true：内存缓存 → 磁盘缓存 → 源文件全量构建（构建后回填两级缓存）。
 */
export function buildGraphIndex(
  rootDir: string,
  opts: { useCache?: boolean } = {},
): GraphIndex {
  const key = path.resolve(rootDir);
  if (opts.useCache) {
    const mem = memCache.get(key);
    if (mem && isFresh(rootDir, mem.builtAt)) return mem.index;
    const disk = loadDiskCache(rootDir);
    if (disk) {
      memCache.set(key, disk);
      return disk.index;
    }
  }
  const index = buildFromSources(rootDir);
  memCache.set(key, { builtAt: Date.now(), index });
  if (opts.useCache) writeDiskCache(rootDir, index);
  return index;
}

// ── 调度决策（agent 规划循环的核心减负工具）──

export interface NextActionsResult {
  /** 可认领节点（状态 ready），按 priority 升序 → level → id 排序 */
  ready: { id: string; label: string; priority?: number }[];
  /** 门禁已满足、可转 ready 的 pending/failed 节点（冷启动与重试入口），同上排序 */
  ready_eligible: { id: string; label: string; priority?: number }[];
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

/**
 * 调度决策（O(N+M)，基于缓存索引）：
 * ready / ready_eligible / blocked / running / stale_running 一屏返回。
 */
export function computeNextActions(
  rootDir: string,
  opts: { staleMs?: number } = {},
): NextActionsResult {
  const staleMs = opts.staleMs ?? 30 * 60 * 1000;
  const index = buildGraphIndex(rootDir, { useCache: true });
  const { nodes, gateReverseAdj } = index;
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
  const readyEligible: NextActionsResult["ready_eligible"] = [];
  const blocked: NextActionsResult["blocked"] = [];
  const running: NextActionsResult["running"] = [];
  const staleRunning: NextActionsResult["stale_running"] = [];

  for (const n of nodes) {
    if (n.status === NodeStatus.Ready) {
      ready.push(schedEntry(n));
      continue;
    }
    if (n.status === NodeStatus.Running) {
      const started = n.execution_report?.started_at;
      // FIX-F2：stale 判据 = 最后活动时间 max(updated_at, started_at)。
      // checkpoint / execution_report 上报都会刷新 updated_at——"上报即心跳"，
      // 持续工作的长任务不再因 started_at 陈旧被误报疑似卡住。
      const lastActivity = Math.max(
        Date.parse(n.updated_at ?? "") || 0,
        started ? Date.parse(started) || 0 : 0,
      );
      const elapsed_ms = lastActivity > 0 ? Date.now() - lastActivity : null;
      running.push({
        id: n.id,
        label: n.label,
        assigned_to: n.assigned_to,
        started_at: started,
        elapsed_ms,
      });
      if (
        elapsed_ms !== null &&
        !Number.isNaN(elapsed_ms) &&
        elapsed_ms > staleMs
      ) {
        staleRunning.push({ id: n.id, label: n.label, elapsed_ms });
      }
      continue;
    }
    if (n.status === NodeStatus.Pending || n.status === NodeStatus.Failed) {
      // 门控前驱检查：只查该节点的门控入边（gateReverseAdj），不再全量扫边
      const unmet: { id: string; status: string }[] = [];
      for (const src of gateReverseAdj.get(n.id) ?? []) {
        const s = statusOf.get(src);
        if (s !== NodeStatus.Passed) {
          unmet.push({ id: src, status: s ?? "missing" });
        }
      }
      if (unmet.length > 0) {
        blocked.push({ id: n.id, label: n.label, unmet });
      } else {
        readyEligible.push(schedEntry(n));
      }
    }
  }

  // FIX-F1：可认领桶按调度优先级排序（priority 升序，缺省最低；level、id 决胜），
  // agent 面对几十个 ready 节点时不再只能按 readdir 字典序盲选
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));
  const bySched = (
    a: { id: string },
    b: { id: string },
  ): number => {
    const na = nodeOf.get(a.id)!;
    const nb = nodeOf.get(b.id)!;
    return (
      (na.priority ?? Number.MAX_SAFE_INTEGER) -
        (nb.priority ?? Number.MAX_SAFE_INTEGER) ||
      na.level - nb.level ||
      na.id.localeCompare(nb.id)
    );
  };
  ready.sort(bySched);
  readyEligible.sort(bySched);

  return {
    ready,
    ready_eligible: readyEligible,
    blocked,
    running,
    stale_running: staleRunning,
    summary,
  };
}

function schedEntry(n: NodeSchema): { id: string; label: string; priority?: number } {
  return {
    id: n.id,
    label: n.label,
    ...(n.priority !== undefined ? { priority: n.priority } : {}),
  };
}
