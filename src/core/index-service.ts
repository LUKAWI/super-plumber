// src/core/index-service.ts
// 图索引服务：buildGraphIndex 的实现与两级缓存（索引缓存基础设施）。
// arch-c2 分家：next 五桶调度策略（computeNextActions）、旗标装配（reviewFlagFor /
// fogSummaryFor / classNudgeFor）与认领提示包（buildClaimNudgePackage）已迁至
// scheduler.ts（依赖方向 scheduler → index-service，取缓存索引）；本文件只留
// "读得快"的缓存设施，不再含任何调度决策。
//
// 为什么单独成文件：checkReadyGate（node.ts）与 computeNextActions 都是 agent
// 每轮必调的热路径。若每次调用都全量 listNodes + listEdges（10k 图 ≈ 2 万次文件读
// + YAML 解析 + schema 校验，实测 ~9s），多 agent 长程运行会被磁盘 I/O 拖垮。
//
// 缓存设计（双轨，新鲜度校验均为精确的逐文件 mtime 比对——跨进程写入可见）：
// 1. 进程内内存缓存：命中时零文件读；2 万次 stat 实测 ~0.4s，比 2 万次读+解析
//    ~9.4s 快一个量级。MCP/Web 等长驻进程的主要收益来源；
// 2. 磁盘缓存 .graph/index/graph.json（未命中时构建后落盘）：新进程冷启动时用
//    stat 校验 + JSON.parse 替代全量文件读，冷路径从 ~9s 降到 <1.5s。
//
// 旧格式磁盘缓存（缺 gateReverseAdj 字段）在加载时从 edges 就地推导，保持兼容。
// 新增 gateReverseAdj（4 种门控边的反向邻接）是 checkReadyGate（node.ts）与
// computeNextActions（scheduler.ts）从"全图扫描"变为"按需查表"的关键数据结构。

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type NodeSchema,
  type EdgeSchema,
  TOPOLOGICAL_EDGE_TYPES,
  GATE_EDGE_TYPES,
  GRAPH_FILE,
  INDEX_DIR,
  NODES_DIR,
  EDGES_DIR,
} from "./types.js";
import { listNodeFileNames, listEdgeFileNames } from "./schema.js";
import { readNode, readEdge } from "./graph-io.js";
import { toGraphDir } from "./graph-dir.js";

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
      const list = gateReverseAdj.get(edge.target);
      // D2 修复（v0.5.1）：去重——fan_out 与 depends_on 平行同向标注同一前驱时，
      // 门禁 unmet 列表不再重复点名（调度语义本就按集合处理，此处消除显示噪音）
      if (list && !list.includes(edge.source)) list.push(edge.source);
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
  const g = toGraphDir(rootDir);
  const files: string[] = [path.join(g, GRAPH_FILE)];
  files.push(
    ...listNodeFileNames(rootDir).map((f) => path.join(g, NODES_DIR, f)),
  );
  files.push(
    ...listEdgeFileNames(rootDir).map((f) => path.join(g, EDGES_DIR, f)),
  );
  // 目录 mtime 感知增删（内容修改不更新目录 mtime，因此必须逐文件比对）
  files.push(path.join(g, NODES_DIR), path.join(g, EDGES_DIR));
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
  const cacheFile = path.join(toGraphDir(rootDir), INDEX_DIR, "graph.json");
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
      // 旧格式缓存：从 edges 就地推导门控邻接（同 D2：源头去重）
      gateReverseAdj = new Map<string, string[]>();
      for (const n of data.nodes) gateReverseAdj.set(n.id, []);
      for (const e of data.edges) {
        if (GATE_EDGE_TYPES.includes(e.type)) {
          const list = gateReverseAdj.get(e.target);
          if (list && !list.includes(e.source)) list.push(e.source);
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
    const dir = path.join(toGraphDir(rootDir), INDEX_DIR);
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
  const key = path.resolve(toGraphDir(rootDir)); // 归一缓存键：工作区根/图目录两种传法命中同一缓存
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

/**
 * 写路径主动失效（fix_index_cache）：Windows NTFS mtime 系统性滞后墙钟 ~2ms，
 * "mtime > builtAt" 的新鲜度判定会把"写盘在缓存构建之后、mtime 却更早"的文件
 * 误判为新鲜——同进程内缓存永久陈旧（MCP/Web 长驻进程写后读不一致的根因）。
 * parser 的所有变更原语（writeNode/writeEdge/writeGraph/deleteNode/deleteEdge/updateGraph）
 * 落盘后必须调用本函数：确定性失效，不与文件系统时钟赌运气。
 */
export function invalidateIndex(rootDir: string): void {
  // S1-7：失效键必须与 buildGraphIndex 的归一缓存键一致
  //（path.resolve(toGraphDir(rootDir))）——此前误用 path.resolve(rootDir)，
  // 工作区根/图目录两种传法混用时删错键，缓存失效落空 → 写后读陈旧
  memCache.delete(path.resolve(toGraphDir(rootDir)));
  try {
    fs.rmSync(path.join(toGraphDir(rootDir), INDEX_DIR, "graph.json"), { force: true });
  } catch {
    /* 磁盘缓存删除失败不影响正确性（下次 isFresh 会回源重建） */
  }
}
