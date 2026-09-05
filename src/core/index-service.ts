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
// 缓存设计（双轨，源文件代际快照 + 精确的逐文件 mtime/ctime 比对）：
// 1. 进程内内存缓存：命中时零文件读；2 万次 stat 实测 ~0.4s，比 2 万次读+解析
//    ~9.4s 快一个量级。MCP/Web 等长驻进程的主要收益来源；
// 2. 磁盘缓存 .graph/index/graph.json（未命中时构建后落盘）：新进程冷启动时用
//    stat 校验 + JSON.parse 替代全量文件读，冷路径从 ~9s 降到 <1.5s。
//
// 每份新缓存都记录 generation 与 graph.yaml/nodes/edges 的源快照。构建前后、提交
// 前后均复核快照，且提交在图级锁内完成：外部写入或 watcher 触发的并发重建不能把旧
// 代际发布到新状态上。缺 generation/source snapshot 的旧磁盘缓存不再命中，
// 会回源重建；带完整代际但缺 gateReverseAdj 的早期 v2 缓存仍可就地推导兼容。
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
import { readNode, readEdge, withGraphLock } from "./graph-io.js";
import { toGraphDir } from "./graph-dir.js";

const INDEX_FILE = "graph.json";
const INDEX_CACHE_VERSION = 2;
const MAX_STABILITY_ATTEMPTS = 5;
let atomicWriteCounter = 0;

type SourceKind = "file" | "directory";

/** 参与索引代际判定的源文件/目录快照。mtime 之外保留 ctime/size/文件身份，
 * 这样直接写入后再把 mtime 回拨的外部进程仍会产生新代际，而无需逐次读取内容或
 * 为热路径付出 SHA-256 成本。 */
export interface IndexSourceStamp {
  path: string;
  kind: SourceKind;
  exists: boolean;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
}

interface SourceSnapshot {
  generation: string;
  sources: IndexSourceStamp[];
}

export interface GraphIndex {
  nodes: NodeSchema[];
  edges: EdgeSchema[];
  /** 拓扑正向邻接（depends_on/validates），源 → 目标列表 */
  adjacency: Map<string, string[]>;
  /** 拓扑反向邻接，目标 → 源列表 */
  reverseAdj: Map<string, string[]>;
  /** 门控反向邻接（depends_on/validates/fan_in/fan_out），目标 → 门控源列表 */
  gateReverseAdj: Map<string, string[]>;
  /** 构建该索引时对应的源文件代际令牌。 */
  generation: string;
}

/** 从源文件全量构建索引（读 + YAML 解析 + schema 校验，O(N+M) 文件读） */
function buildFromSources(rootDir: string): Omit<GraphIndex, "generation"> {
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
  snapshot: SourceSnapshot;
  index: GraphIndex;
}

const memCache = new Map<string, MemCacheEntry>();
const indexSnapshots = new WeakMap<GraphIndex, SourceSnapshot>();

/** 测试辅助：清空进程内索引缓存 */
export function resetIndexCache(): void {
  memCache.clear();
}

interface SourceEntry {
  absolutePath: string;
  relativePath: string;
  kind: SourceKind;
}

function sourceEntries(rootDir: string): SourceEntry[] {
  const g = toGraphDir(rootDir);
  const nodeFiles = [...listNodeFileNames(rootDir)].sort();
  const edgeFiles = [...listEdgeFileNames(rootDir)].sort();
  return [
    { absolutePath: path.join(g, GRAPH_FILE), relativePath: GRAPH_FILE, kind: "file" },
    ...nodeFiles.map((file) => ({
      absolutePath: path.join(g, NODES_DIR, file),
      relativePath: `${NODES_DIR}/${file}`,
      kind: "file" as const,
    })),
    ...edgeFiles.map((file) => ({
      absolutePath: path.join(g, EDGES_DIR, file),
      relativePath: `${EDGES_DIR}/${file}`,
      kind: "file" as const,
    })),
    // 目录 mtime 感知增删（内容修改不更新目录 mtime，因此仍逐文件比对）。
    { absolutePath: path.join(g, NODES_DIR), relativePath: NODES_DIR, kind: "directory" },
    { absolutePath: path.join(g, EDGES_DIR), relativePath: EDGES_DIR, kind: "directory" },
  ];
}

function missingStamp(entry: SourceEntry): IndexSourceStamp {
  return {
    path: entry.relativePath,
    kind: entry.kind,
    exists: false,
    size: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    dev: 0,
    ino: 0,
  };
}

function sourceStamp(entry: SourceEntry): IndexSourceStamp {
  let st: fs.Stats;
  try {
    st = fs.statSync(entry.absolutePath);
  } catch (err: any) {
    if (err?.code === "ENOENT") return missingStamp(entry);
    throw err;
  }
  return {
    path: entry.relativePath,
    kind: entry.kind,
    exists: true,
    size: st.size,
    mtimeMs: st.mtimeMs,
    ctimeMs: st.ctimeMs,
    dev: st.dev,
    ino: st.ino,
  };
}

/** FNV-1a 仅用于生成短代际令牌；完整 source stamps 仍在缓存中逐项比对，
 * 因此令牌碰撞不会造成错误命中。 */
function generationFor(sources: IndexSourceStamp[]): string {
  const material = sources
    .map((source) =>
      [
        source.path,
        source.kind,
        source.exists ? "1" : "0",
        source.size,
        source.mtimeMs,
        source.ctimeMs,
        source.dev,
        source.ino,
      ].join("\u0000"),
    )
    .join("\u0001");
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `index-v${INDEX_CACHE_VERSION}:${hash.toString(16).padStart(8, "0")}`;
}

function captureSourceSnapshot(rootDir: string): SourceSnapshot | null {
  try {
    const sources = sourceEntries(rootDir).map(sourceStamp);
    return { generation: generationFor(sources), sources };
  } catch {
    // 源目录损坏/暂不可读时让正式构建抛出原始错误；缓存读取则回源。
    return null;
  }
}

function sameSourceStamp(a: IndexSourceStamp, b: IndexSourceStamp): boolean {
  return (
    a.path === b.path &&
    a.kind === b.kind &&
    a.exists === b.exists &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs &&
    a.dev === b.dev &&
    a.ino === b.ino
  );
}

function sameSourceSnapshot(a: SourceSnapshot, b: SourceSnapshot): boolean {
  return (
    a.generation === b.generation &&
    a.sources.length === b.sources.length &&
    a.sources.every((source, i) => sameSourceStamp(source, b.sources[i]!))
  );
}

function isSourceStamp(value: unknown): value is IndexSourceStamp {
  if (value === null || typeof value !== "object") return false;
  const source = value as Partial<IndexSourceStamp>;
  return (
    typeof source.path === "string" &&
    (source.kind === "file" || source.kind === "directory") &&
    typeof source.exists === "boolean" &&
    typeof source.size === "number" &&
    Number.isFinite(source.size) &&
    typeof source.mtimeMs === "number" &&
    Number.isFinite(source.mtimeMs) &&
    typeof source.ctimeMs === "number" &&
    Number.isFinite(source.ctimeMs) &&
    typeof source.dev === "number" &&
    Number.isFinite(source.dev) &&
    typeof source.ino === "number" &&
    Number.isFinite(source.ino)
  );
}

function decodeSourceStamps(value: unknown): IndexSourceStamp[] | null {
  return Array.isArray(value) && value.every(isSourceStamp)
    ? (value as IndexSourceStamp[])
    : null;
}

/** 内存缓存的新鲜度校验：必须命中同一源文件代际，不能只看墙钟。 */
function matchesCurrentSnapshot(rootDir: string, snapshot: SourceSnapshot): boolean {
  const current = captureSourceSnapshot(rootDir);
  return current !== null && sameSourceSnapshot(current, snapshot);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mapFromRecord(value: unknown): Map<string, string[]> {
  if (!isRecord(value)) return new Map();
  return new Map(
    Object.entries(value).filter(([, ids]) => Array.isArray(ids)) as [string, string[]][],
  );
}

function buildIndex(
  data: { nodes: NodeSchema[]; edges: EdgeSchema[]; adjacency?: unknown; reverseAdj?: unknown; gateReverseAdj?: unknown },
  generation: string,
): GraphIndex {
  const adjacency = mapFromRecord(data.adjacency);
  const reverseAdj = mapFromRecord(data.reverseAdj);
  let gateReverseAdj: Map<string, string[]>;
  if (data.gateReverseAdj !== undefined) {
    gateReverseAdj = mapFromRecord(data.gateReverseAdj);
  } else {
    // 早期 v2 缓存：从 edges 就地推导门控邻接（同 D2：源头去重）。
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
    nodes: data.nodes,
    edges: data.edges,
    adjacency,
    reverseAdj,
    gateReverseAdj,
    generation,
  };
}

interface IndexCachePayload {
  index_version: number;
  generation: string;
  sources: IndexSourceStamp[];
  nodes: NodeSchema[];
  edges: EdgeSchema[];
  adjacency: Record<string, string[]>;
  reverseAdj: Record<string, string[]>;
  gateReverseAdj: Record<string, string[]>;
}

function indexPayload(index: GraphIndex, snapshot: SourceSnapshot): IndexCachePayload {
  return {
    index_version: INDEX_CACHE_VERSION,
    generation: snapshot.generation,
    sources: snapshot.sources,
    nodes: index.nodes,
    edges: index.edges,
    adjacency: Object.fromEntries(index.adjacency),
    reverseAdj: Object.fromEntries(index.reverseAdj),
    gateReverseAdj: Object.fromEntries(index.gateReverseAdj),
  };
}

function validIndexPayload(value: unknown, snapshot: SourceSnapshot): value is IndexCachePayload {
  if (!isRecord(value)) return false;
  const sources = decodeSourceStamps(value.sources);
  return (
    value.index_version === INDEX_CACHE_VERSION &&
    value.generation === snapshot.generation &&
    sources !== null &&
    sameSourceSnapshot(
      snapshot,
      { generation: String(value.generation), sources },
    ) &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges)
  );
}

function atomicWriteIndex(cacheFile: string, payload: IndexCachePayload, snapshot: SourceSnapshot): void {
  const dir = path.dirname(cacheFile);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(
    dir,
    `.${INDEX_FILE}.${process.pid}.${++atomicWriteCounter}.tmp`,
  );
  try {
    const serialized = JSON.stringify(payload, null, 2);
    fs.writeFileSync(temp, serialized, { encoding: "utf-8", flag: "wx" });
    // rename 前重新读取并解析临时文件，避免把截断/损坏内容发布成正式缓存。
    const checked = JSON.parse(fs.readFileSync(temp, "utf-8")) as unknown;
    if (!validIndexPayload(checked, snapshot)) {
      throw new Error("index cache temporary file validation failed");
    }
    fs.renameSync(temp, cacheFile);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {
      /* rename 成功后临时路径已不存在 */
    }
  }
}

function removeCacheIfGeneration(cacheFile: string, generation: string): void {
  try {
    const value = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as Record<string, unknown>;
    if (value.generation === generation) fs.unlinkSync(cacheFile);
  } catch {
    /* 其他进程已替换/删除，或缓存本身已损坏，无需覆盖其结果 */
  }
}

function commitDiskCache(rootDir: string, index: GraphIndex, snapshot: SourceSnapshot): boolean {
  return withGraphLock(rootDir, () => {
    // 图写路径也使用同一把图锁；把最后一次源快照检查与 rename 放进临界区，
    // 标准 CLI/MCP/Web 写入无法在检查后插入旧结果。
    const current = captureSourceSnapshot(rootDir);
    if (current === null || !sameSourceSnapshot(current, snapshot)) return false;

    const cacheFile = path.join(toGraphDir(rootDir), INDEX_DIR, INDEX_FILE);
    atomicWriteIndex(cacheFile, indexPayload(index, snapshot), snapshot);

    // 原始外部进程可能不走图锁；若它恰在 rename 后写源文件，立即撤掉本次旧
    // 发布。即便存在极窄窗口，后续读面也会因 generation 不匹配拒绝该缓存。
    const after = captureSourceSnapshot(rootDir);
    if (after === null || !sameSourceSnapshot(after, snapshot)) {
      removeCacheIfGeneration(cacheFile, snapshot.generation);
      return false;
    }
    return true;
  });
}

function stableBuild(rootDir: string): { index: GraphIndex; snapshot: SourceSnapshot } {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_STABILITY_ATTEMPTS; attempt++) {
    const before = captureSourceSnapshot(rootDir);
    if (before === null) {
      // 让源读取错误保持原始错误类型/消息，避免缓存层掩盖结构损坏。
      return attachSnapshot(rootDir, buildFromSources(rootDir), {
        generation: `index-v${INDEX_CACHE_VERSION}:untracked`,
        sources: [],
      });
    }

    let data: Omit<GraphIndex, "generation">;
    try {
      data = buildFromSources(rootDir);
    } catch (err) {
      const afterError = captureSourceSnapshot(rootDir);
      if (afterError !== null && !sameSourceSnapshot(before, afterError)) {
        lastError = err;
        continue;
      }
      throw err;
    }
    const after = captureSourceSnapshot(rootDir);
    if (after !== null && sameSourceSnapshot(before, after)) {
      return attachSnapshot(rootDir, data, after);
    }
    lastError = new Error("索引源文件在重建期间发生变化，请重试");
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("索引源文件在重建期间持续变化，无法生成稳定索引");
}

function attachSnapshot(
  _rootDir: string,
  data: Omit<GraphIndex, "generation">,
  snapshot: SourceSnapshot,
): { index: GraphIndex; snapshot: SourceSnapshot } {
  const index: GraphIndex = { ...data, generation: snapshot.generation };
  indexSnapshots.set(index, snapshot);
  return { index, snapshot };
}

function loadDiskCache(rootDir: string): MemCacheEntry | null {
  const cacheFile = path.join(toGraphDir(rootDir), INDEX_DIR, INDEX_FILE);
  if (!fs.existsSync(cacheFile)) return null;
  const before = captureSourceSnapshot(rootDir);
  if (before === null) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as Record<string, unknown>;
  } catch {
    return null; // 缓存损坏 → 回源
  }
  const after = captureSourceSnapshot(rootDir);
  if (after === null || !sameSourceSnapshot(before, after)) return null;
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;

  const hasGenerationMetadata =
    data.index_version !== undefined ||
    data.generation !== undefined ||
    data.sources !== undefined;
  if (!hasGenerationMetadata) {
    // 0.9.6：没有源快照就无法证明旧缓存没有在 mtime 回拨后复活更新节点/边，
    // 不能再用 cache mtime 猜新鲜度；回源后会写入带代际的 v2 缓存。
    return null;
  }
  // 新格式必须同时具备版本、代际和完整源快照；不完整的临时/手写文件不得命中。
  if (!validIndexPayload(data, after)) return null;

  const index = buildIndex(
    {
      nodes: data.nodes as NodeSchema[],
      edges: data.edges as EdgeSchema[],
      adjacency: data.adjacency,
      reverseAdj: data.reverseAdj,
      gateReverseAdj: data.gateReverseAdj,
    },
    after.generation,
  );
  indexSnapshots.set(index, after);
  return { snapshot: after, index };
}

/** 将已构建的索引以代际元数据 + 临时文件校验 + 原子 rename 发布到磁盘。
 * 返回 false 表示构建快照已过期（调用方应重建），I/O/锁错误则抛出，便于 CLI
 * 明确失败、而长驻读路径可继续使用内存结果。 */
export function persistGraphIndex(rootDir: string, index: GraphIndex): boolean {
  const snapshot = indexSnapshots.get(index) ?? captureSourceSnapshot(rootDir);
  if (snapshot === null || index.generation !== snapshot.generation) return false;
  return commitDiskCache(rootDir, index, snapshot);
}

/**
 * 构建当前 .graph/ 目录的完整索引。
 * useCache=true：内存缓存 → 磁盘缓存 → 稳定源文件构建（构建后回填两级缓存）。
 */
export function buildGraphIndex(
  rootDir: string,
  opts: { useCache?: boolean } = {},
): GraphIndex {
  const key = path.resolve(toGraphDir(rootDir)); // 归一缓存键：工作区根/图目录两种传法命中同一缓存
  if (opts.useCache) {
    const mem = memCache.get(key);
    if (mem && matchesCurrentSnapshot(rootDir, mem.snapshot)) return mem.index;
    const disk = loadDiskCache(rootDir);
    if (disk) {
      memCache.set(key, disk);
      return disk.index;
    }
  }

  const built = stableBuild(rootDir);
  memCache.set(key, built);
  if (opts.useCache) {
    try {
      // 读路径的磁盘缓存是派生优化；即使锁/权限导致发布失败，内存结果仍正确。
      persistGraphIndex(rootDir, built.index);
    } catch {
      /* 磁盘缓存写入失败不影响正确性（下次回源重建） */
    }
  }
  return built.index;
}

/**
 * 写路径主动失效（fix_index_cache）：Windows NTFS mtime 系统性滞后墙钟 ~2ms，
 * "mtime > builtAt" 的新鲜度判定会把"写盘在缓存构建之后、mtime 却更早"的文件
 * 误判为新鲜；代际快照与主动失效双保险，确保同进程/跨进程写后读不陈旧。
 * parser 的所有变更原语（writeNode/writeEdge/writeGraph/deleteNode/deleteEdge/updateGraph）
 * 落盘后必须调用本函数：确定性失效，不与文件系统时钟赌运气。
 */
export function invalidateIndex(rootDir: string): void {
  // S1-7：失效键必须与 buildGraphIndex 的归一缓存键一致
  //（path.resolve(toGraphDir(rootDir))）——此前误用 path.resolve(rootDir)，
  // 工作区根/图目录两种传法混用时删错键，缓存失效落空 → 写后读陈旧
  memCache.delete(path.resolve(toGraphDir(rootDir)));
  try {
    fs.rmSync(path.join(toGraphDir(rootDir), INDEX_DIR, INDEX_FILE), { force: true });
  } catch {
    /* 磁盘缓存删除失败不影响正确性（下次代际校验会回源重建） */
  }
}
