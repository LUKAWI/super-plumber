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
  type GraphFog,
  NodeStatus,
  TOPOLOGICAL_EDGE_TYPES,
  GATE_EDGE_TYPES,
  isKnowledgeType,
  GRAPH_FILE,
  INDEX_DIR,
  NODES_DIR,
  EDGES_DIR,
} from "./types.js";
import { listNodeFileNames, listEdgeFileNames } from "./schema.js";
import { readNode, readEdge, readGraph } from "./parser.js";
import { adrFlagsFor } from "./domain.js";
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

// ── 调度决策（agent 规划循环的核心减负工具）──

// DEC-1（g080-approve-core）：review_flag 注入面（core 侧）。
// 图级判定一次：图无 review 凭据 → ready_eligible 条目附 review_flag（≤10 token，
// 风格对齐 adr_flags——只提示不拦截）。红线：review 仅记录、零门禁，核心状态机
// 不因此新增任何拒绝规则。文案已定稿（v082-tooling，设计文档 §4-4 收口）。
export const REVIEW_FLAG_UNREVIEWED =
  "设计审核凭据缺失或已失效——仅提示，可照常认领";

/** 图级 review_flag 判定（一次读 graph.yaml，不进索引缓存）：
 * 无 review 字段或 status=unreviewed → 注入定稿文案；有凭据 → undefined（不注入）。
 * F21（DEC-7）：结构修订把 review 回置为 status=unreviewed（只写凭据字段）——
 * 该状态同样视为未审核，nudge 重新亮起走增量人审。
 * 图未初始化/不可读同样视为未审核（提示不阻塞调度）。 */
export function reviewFlagFor(rootDir: string): string | undefined {
  try {
    const review = readGraph(rootDir).review;
    return review === undefined || review.status === "unreviewed"
      ? REVIEW_FLAG_UNREVIEWED
      : undefined;
  } catch {
    return REVIEW_FLAG_UNREVIEWED;
  }
}

// F04（adr_0007，0.9.0）：雾区概要读面（调度结果透出用）。
// 与 reviewFlagFor 同款：一次读 graph.yaml、不进索引缓存，图不可读 → undefined。
export function fogSummaryFor(rootDir: string): GraphFog | undefined {
  try {
    return readGraph(rootDir).fog;
  } catch {
    return undefined;
  }
}

export interface NextActionsResult {
  /** 可认领节点（状态 ready），按 priority 升序 → level → id 排序 */
  ready: { id: string; label: string; priority?: number; adr_flags?: string[] }[];
  /** 门禁已满足、可转 ready 的 pending/failed 节点（冷启动与重试入口），同上排序。
   * DEC-1：图无 review 凭据时条目附 review_flag（仅提示、零门禁；只在
   * ready_eligible 注入，ready 桶不注入） */
  ready_eligible: {
    id: string;
    label: string;
    priority?: number;
    adr_flags?: string[];
    review_flag?: string;
  }[];
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
    adr_flags?: string[];
  }[];
  /** 超过 staleMs 无更新的"疑似卡住"节点（默认 30 分钟） */
  stale_running: { id: string; label: string; elapsed_ms: number }[];
  /** F04（adr_0007）：雾区概要（图无雾时缺省；读面透出，零门禁） */
  fog?: GraphFog;
  /** 工作流顶点状态分布（知识顶点不参与——"全部 task 节点 passed 即完成"排除它们） */
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
  const { nodes, edges, gateReverseAdj } = index;
  const statusOf = new Map(nodes.map((n) => [n.id, n.status]));
  // v0.5：知识顶点（context/adr）调度豁免——永不进任何调度桶，也不计入完成判定。
  // adr_flags：superseded 的 ADR 沿 decides 边把"决策依据已过时"传播到工作流条目。
  const workflowNodes = nodes.filter((n) => !isKnowledgeType(n.type));
  const adrFlags = adrFlagsFor(nodes, edges);
  // DEC-1：review_flag 图级判定一次——无 review 凭据的图，ready_eligible 条目统一注入
  const reviewFlag = reviewFlagFor(rootDir);

  const summary = {
    total: workflowNodes.length,
    pending: 0,
    ready: 0,
    running: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
  } as NextActionsResult["summary"];
  for (const n of workflowNodes) {
    summary[n.status as NodeStatus] = (summary[n.status as NodeStatus] ?? 0) + 1;
  }

  const ready: NextActionsResult["ready"] = [];
  const readyEligible: NextActionsResult["ready_eligible"] = [];
  const blocked: NextActionsResult["blocked"] = [];
  const running: NextActionsResult["running"] = [];
  const staleRunning: NextActionsResult["stale_running"] = [];

  for (const n of workflowNodes) {
    if (n.status === NodeStatus.Ready) {
      ready.push({ ...schedEntry(n), ...(adrFlags.get(n.id) ? { adr_flags: adrFlags.get(n.id) } : {}) });
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
        ...(adrFlags.get(n.id) ? { adr_flags: adrFlags.get(n.id) } : {}),
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
        readyEligible.push({
          ...schedEntry(n),
          ...(adrFlags.get(n.id) ? { adr_flags: adrFlags.get(n.id) } : {}),
          ...(reviewFlag !== undefined ? { review_flag: reviewFlag } : {}),
        });
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

  // F04：雾区概要随调度结果透出（与 review_flag 同源读法，零门禁）
  const fog = fogSummaryFor(rootDir);

  return {
    ready,
    ready_eligible: readyEligible,
    blocked,
    running,
    stale_running: staleRunning,
    ...(fog !== undefined ? { fog } : {}),
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
