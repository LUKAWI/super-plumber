// src/core/graph-dir.ts — v0.5.2 单工作区多图：图目录解析与工作区级状态
//
// 布局：.graph/{active, schema.yaml, workspace-events.jsonl, default/, <图名>/, .trash/}
// 每图一个一级目录（图内 = graph.yaml/nodes/edges/snapshots/index/events.jsonl/.locks）。
// 旧仓库兼容：.graph/graph.yaml 在根 = 名为 default 的图"原地"识别，零迁移；
// 创建第二张图时 migrateLegacyLayout 一次性把旧布局 7 项搬入 .graph/default/。
//
// toGraphDir 是全库的路径归一化点：传工作区根 → 降入解析后的图目录；传图目录 → 原样通过。
// 这让既有调用方（CLI cwd、测试 tmpDir、旧脚本）零改动获得兼容，新调用方显式传图目录。
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { GRAPH_DIR, GRAPH_FILE, NODES_DIR, EDGES_DIR, INDEX_DIR, type GraphSchema } from "./types.js";
// 循环依赖说明：lock → graph-dir（WORKSPACE_MIGRATE_LOCK 常量）与
// graph-dir → lock（迁移互斥）互为环，但两侧都只在函数体内互调，ESM 安全（同 parser↔index-service 先例）。
import { withLockSync } from "./lock.js";

export const GRAPH_NAME_RE = /^[a-z][a-z0-9-]{0,38}$/;
const WS_EVENTS_FILE = "workspace-events.jsonl";
const ACTIVE_FILE = "active";
const TRASH_DIR = ".trash";
/** 旧布局一次性迁移的图内项（6 项）。
 * .locks **故意不在迁移清单**（A4 并发缺陷）：它是工作区级互斥锁的家
 * （__ws_migrate__ 固定落 .graph/.locks/）——迁移时若连它一起搬走，
 * 并发等待锁的进程会 ENOENT 崩溃；default 图的节点锁在迁移后自然改落
 * .graph/default/.locks（锁文件瞬态、30s 陈锁自愈，无需迁移）。 */
const LEGACY_ITEMS = [GRAPH_FILE, NODES_DIR, EDGES_DIR, "snapshots", INDEX_DIR, "events.jsonl"];

function dotGraph(wsRoot: string): string {
  return path.join(wsRoot, GRAPH_DIR);
}

export function assertValidGraphName(name: string): void {
  if (!GRAPH_NAME_RE.test(name)) {
    throw new Error(
      `非法图名: "${name}"。规则: ^[a-z][a-z0-9-]{0,38}$（小写开头，仅小写字母/数字/连字符；内容命名，如 refactor-auth）`,
    );
  }
}

/** 列出工作区全部图名（旧布局根级 graph.yaml → ["default"]；多图布局 → 含 graph.yaml 的一级子目录） */
export function listGraphNames(wsRoot: string): string[] {
  const dg = dotGraph(wsRoot);
  if (!fs.existsSync(dg)) return [];
  if (fs.existsSync(path.join(dg, GRAPH_FILE))) return ["default"]; // 旧布局原地
  const names: string[] = [];
  for (const e of fs.readdirSync(dg, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue; // .trash 等系统目录
    if (fs.existsSync(path.join(dg, e.name, GRAPH_FILE))) names.push(e.name);
  }
  return names.sort();
}

export function readWorkspaceDefault(wsRoot: string): string | null {
  const f = path.join(dotGraph(wsRoot), ACTIVE_FILE);
  try {
    const v = fs.readFileSync(f, "utf-8").trim();
    return GRAPH_NAME_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeWorkspaceDefault(wsRoot: string, name: string, actor = "unknown"): void {
  assertValidGraphName(name);
  fs.mkdirSync(dotGraph(wsRoot), { recursive: true });
  fs.writeFileSync(path.join(dotGraph(wsRoot), ACTIVE_FILE), name, "utf-8");
  appendWorkspaceEvent(wsRoot, "switch", `active -> ${name}`, actor);
}

/** 工作区级审计（init/switch/migrate/rename/delete 五类；图内操作仍在各图 events.jsonl） */
export function appendWorkspaceEvent(
  wsRoot: string,
  kind: "init" | "switch" | "migrate" | "rename" | "delete",
  detail: string,
  actor = "unknown",
): void {
  try {
    fs.mkdirSync(dotGraph(wsRoot), { recursive: true });
    // S3-6：与图内 eventlog（"__events__" 锁）对齐加锁，不再裸 append。
    // 已知边界：锁文件经 toGraphDir 随 active 图走（图级），跨图并发追加
    // 依赖单行 appendFileSync 的 O_APPEND 原子性（单次 write 原子追加）；
    // 同图内（单图工作区/同 active——绝大多数场景）完全互斥。
    // 备注：做工作区级锁需 lock.ts 扩展 ws 专属锁 id（f7 文件边界外，留 r1 裁决）。
    withLockSync(wsRoot, "__ws_events__", () => {
      fs.appendFileSync(
        path.join(dotGraph(wsRoot), WS_EVENTS_FILE),
        JSON.stringify({ ts: new Date().toISOString(), actor, kind, detail }) + "\n",
        "utf-8",
      );
    });
  } catch {
    /* 审计失败不阻断主操作 */
  }
}

export function readWorkspaceEvents(
  wsRoot: string,
  filter: { kind?: string } = {},
): { ts: string; actor: string; kind: string; detail: string }[] {
  const f = path.join(dotGraph(wsRoot), WS_EVENTS_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(f, "utf-8");
  } catch {
    return [];
  }
  const events = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (filter.kind === undefined || e.kind === filter.kind) events.push(e);
    } catch {
      /* 撕裂行跳过 */
    }
  }
  return events;
}

/** did-you-mean：前缀命中优先，其次编辑距离 ≤2 的最近匹配 */
export function didYouMean(name: string, candidates: string[]): string[] {
  const lower = name.toLowerCase();
  const prefix = candidates.filter((c) => c.startsWith(lower));
  if (prefix.length > 0) return prefix.slice(0, 3);
  return candidates
    .map((c) => ({ c, d: editDistance(lower, c) }))
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.c)
    .slice(0, 3);
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

export interface ResolvedGraphDir {
  dir: string;
  name: string;
  /** 命中来源：explicit（--graph 参数）/ env（SUPER_PLUMBER_GRAPH）/ process（进程内 active，仅 MCP）/ active（工作区默认文件）/ default（兜底） */
  source: "explicit" | "env" | "process" | "active" | "default";
}

/**
 * 五级优先级链解析图目录（explicit > env > process(仅 MCP) > active 文件 > default）。
 * name 不存在时报错列出全部可用图 + did-you-mean——提示自动，绝不静默猜一个。
 */
export function resolveGraphDir(
  wsRoot: string,
  opts: { name?: string; env?: string; processActive?: string } = {},
): ResolvedGraphDir {
  const names = listGraphNames(wsRoot);
  const tryCandidate = (
    name: string | undefined,
    source: ResolvedGraphDir["source"],
  ): ResolvedGraphDir | null => {
    if (name === undefined || name === "") return null;
    assertValidGraphName(name);
    // 旧布局：default 即 .graph/ 根（graph.yaml 原地）
    if (name === "default" && fs.existsSync(path.join(dotGraph(wsRoot), GRAPH_FILE))) {
      return { dir: dotGraph(wsRoot), name: "default", source };
    }
    const dir = path.join(dotGraph(wsRoot), name);
    if (fs.existsSync(path.join(dir, GRAPH_FILE))) return { dir, name, source };
    return null;
  };

  const chain: [string | undefined, ResolvedGraphDir["source"]][] = [
    [opts.name, "explicit"],
    [opts.env, "env"],
    [opts.processActive, "process"],
    [readWorkspaceDefault(wsRoot) ?? undefined, "active"],
  ];
  for (const [name, source] of chain) {
    // 链上候选非法（如图名拼错）→ 立即报错带提示，不静默滑到下一级
    if (name !== undefined && name !== "") assertValidGraphName(name);
    const hit = tryCandidate(name, source);
    if (hit) return hit;
    if (name !== undefined && name !== "" && names.length > 0) {
      const hint = didYouMean(name, names);
      throw new Error(
        `图 "${name}" 不存在。可用: ${names.join(", ")}` +
          (hint.length > 0 ? `（你是想切 ${hint.join(" / ")} 吗？）` : ""),
      );
    }
  }
  // 兜底 default（旧布局原地 / .graph/default/ / 唯一图 / 未初始化）
  const legacy = fs.existsSync(path.join(dotGraph(wsRoot), GRAPH_FILE));
  if (legacy) return { dir: dotGraph(wsRoot), name: "default", source: "default" };
  const dd = path.join(dotGraph(wsRoot), "default");
  if (fs.existsSync(path.join(dd, GRAPH_FILE))) return { dir: dd, name: "default", source: "default" };
  if (names.length === 1) return resolveSingleGraph(wsRoot, names[0]);
  if (names.length > 1) {
    throw new Error(`多图工作区未指定图（active 文件缺失或无效）。可用: ${names.join(", ")}`);
  }
  // 未初始化：返回 .graph/ 原样（调用方走既有"未初始化"错误路径）
  return { dir: dotGraph(wsRoot), name: "default", source: "default" };
}

function resolveSingleGraph(wsRoot: string, name: string): ResolvedGraphDir {
  return {
    dir: path.join(dotGraph(wsRoot), name),
    name,
    source: "default",
  };
}

/**
 * 全库路径归一化点：graph.yaml 在 p → p 已是图目录；p 含 .graph/ → 降入解析后的图目录
 * （旧布局 = .graph/ 原地，多图 = active/唯一图）；都没有 → 返回 p/.graph（未初始化，
 * 调用方报既有错误；写入方在此创建 = 旧布局位置，天然兼容）。
 */
export function toGraphDir(rootDir: string): string {
  if (fs.existsSync(path.join(rootDir, GRAPH_FILE))) return rootDir;
  const dg = path.join(rootDir, GRAPH_DIR);
  if (fs.existsSync(dg)) {
    if (fs.existsSync(path.join(dg, GRAPH_FILE))) return dg;
    try {
      return resolveGraphDir(rootDir).dir;
    } catch {
      return dg; // 多图但解析失败（active 缺失等）：返回 .graph/ 让调用方报错
    }
  }
  return dg;
}

/** 图目录 → 工作区根（.graph/x/ 的上上级；旧布局 .graph/ 的上级；否则原样） */
export function workspaceOf(dir: string): string {
  if (path.basename(dir) === GRAPH_DIR) return path.dirname(dir);
  if (path.basename(path.dirname(dir)) === GRAPH_DIR) return path.dirname(path.dirname(dir));
  return dir;
}

/**
 * 旧布局一次性迁移：把 .graph/ 根上的 7 项 renameSync 进 .graph/default/。
 * 同卷 rename 原子（逐项）；调用方须持有工作区级锁（migrateWorkspaceLock）。
 * 幂等：无旧布局时返回空列表。
 */
export function migrateLegacyLayout(wsRoot: string, actor = "unknown"): string[] {
  const dg = dotGraph(wsRoot);
  if (!fs.existsSync(path.join(dg, GRAPH_FILE))) return [];
  const target = path.join(dg, "default");
  fs.mkdirSync(target, { recursive: true });
  const moved: string[] = [];
  for (const item of LEGACY_ITEMS) {
    const src = path.join(dg, item);
    if (!fs.existsSync(src)) continue;
    fs.renameSync(src, path.join(target, item));
    moved.push(item);
  }
  appendWorkspaceEvent(wsRoot, "migrate", `legacy -> default/（${moved.join(", ")}）`, actor);
  return moved;
}

/** 工作区级迁移互斥锁 id（与各图自身锁空间隔离，锁文件在 .graph/.locks/） */
export const WORKSPACE_MIGRATE_LOCK = "__ws_migrate__";

/** 创建新图：校验图名 → 若存在其它图且仍为旧布局则先迁移 → 建骨架。返回图目录。 */
export function createGraph(
  wsRoot: string,
  name: string,
  label: string,
  opts: { actor?: string; version?: string } = {},
): string {
  assertValidGraphName(name);
  const dg = dotGraph(wsRoot);
  const names = listGraphNames(wsRoot);
  if (names.includes(name)) throw new Error(`图 "${name}" 已存在。可用名不含它: ${names.join(", ")}`);
  // 建第二图触发一次性迁移——工作区级互斥锁内（并发建图不交错半迁移）
  withLockSync(wsRoot, WORKSPACE_MIGRATE_LOCK, () => {
    if (names.length > 0 && fs.existsSync(path.join(dg, GRAPH_FILE))) {
      migrateLegacyLayout(wsRoot, opts.actor);
    }
  });
  const dir = path.join(dg, name);
  if (fs.existsSync(dir)) throw new Error(`目录已存在: ${dir}`);
  for (const d of [NODES_DIR, EDGES_DIR, "snapshots", INDEX_DIR, ".locks"]) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  // S3-5/N4（f15）：graph.yaml 骨架改走 GraphSchema 对象 + yaml.dump 落盘——
  // 与 parser.writeGraph 同一序列化器，label 含 : # " 换行时自动加引号/转义。
  // 旧实现手拼 `label: ${label}` 模板：冒号形产出非法 YAML（init 退出码 0 但
  // status 误报"无 graph.yaml"）；换行形更静默注入额外字段（如 tampered: true）
  // 且 graph validate 零错误——注入面而非解析面。
  // id 加随机后缀：graph_${Date.now()} 毫秒粒度不足，同毫秒建两图会撞 id。
  const skeleton: Omit<GraphSchema, "version"> & { version?: string } = {
    id: `graph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label,
    entry: { description: "", defined_by: "human", level: 0 },
    exit: { description: "", acceptance_criteria: [], defined_by: "human", level: 0 },
    nodes: [],
    edges: [],
  };
  if (opts.version) skeleton.version = opts.version;
  fs.writeFileSync(
    path.join(dir, GRAPH_FILE),
    yaml.dump(skeleton, { indent: 2, lineWidth: 120 }),
    "utf-8",
  );
  appendWorkspaceEvent(wsRoot, "init", `graph=${name} label="${label}"`, opts.actor);
  return dir;
}

/** 软删除：移入 .trash/<名>-<时间戳>/（可手工救回）。调用方负责策略校验（最后一张/active）。 */
export function trashGraph(wsRoot: string, name: string, actor = "unknown"): string {
  const dg = dotGraph(wsRoot);
  const src =
    name === "default" && fs.existsSync(path.join(dg, GRAPH_FILE))
      ? dg
      : path.join(dg, name);
  if (!fs.existsSync(path.join(src, GRAPH_FILE))) {
    throw new Error(`图 "${name}" 不存在。可用: ${listGraphNames(wsRoot).join(", ") || "（无）"}`);
  }
  const trash = path.join(dg, TRASH_DIR);
  fs.mkdirSync(trash, { recursive: true });
  const dest = path.join(trash, `${name}-${Date.now()}`);
  fs.renameSync(src, dest);
  appendWorkspaceEvent(wsRoot, "delete", `graph=${name} -> .trash/（可手工救回）`, actor);
  return dest;
}
