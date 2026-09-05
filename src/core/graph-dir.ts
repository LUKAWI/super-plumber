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
import { AsyncLocalStorage } from "node:async_hooks";
import * as yaml from "js-yaml";
import { GRAPH_DIR, GRAPH_FILE, NODES_DIR, EDGES_DIR, INDEX_DIR, type GraphSchema, type GraphClass } from "./types.js";
// 循环依赖说明：lock → graph-dir（WORKSPACE_MIGRATE_LOCK 常量）与
// graph-dir → lock（迁移互斥）互为环，但两侧都只在函数体内互调，ESM 安全（同 parser↔index-service 先例）。
import { withLockSync } from "./lock.js";

export const GRAPH_NAME_RE = /^[a-z][a-z0-9-]{0,38}$/;
const WS_EVENTS_FILE = "workspace-events.jsonl";
const ACTIVE_FILE = "active";
const TRASH_DIR = ".trash";
let atomicWriteCounter = 0;
/** 旧布局一次性迁移的图内项（6 项）。
 * .locks **故意不在迁移清单**（A4 并发缺陷）：它是工作区级互斥锁的家
 * （__ws_migrate__ 固定落 .graph/.locks/）——迁移时若连它一起搬走，
 * 并发等待锁的进程会 ENOENT 崩溃；default 图的节点锁在迁移后自然改落
 * .graph/default/.locks（锁文件瞬态、30s 陈锁自愈，无需迁移）。 */
const LEGACY_ITEMS = [GRAPH_FILE, NODES_DIR, EDGES_DIR, "snapshots", INDEX_DIR, "events.jsonl"];

function dotGraph(wsRoot: string): string {
  return path.join(wsRoot, GRAPH_DIR);
}

/** 同目录临时文件 + rename，保证 active/骨架发布不会暴露半截内容。 */
function writeTextAtomic(file: string, content: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${++atomicWriteCounter}.tmp`,
  );
  try {
    fs.writeFileSync(temp, content, "utf-8");
    fs.renameSync(temp, file);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {
      /* rename 成功后临时路径已不存在 */
    }
  }
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
  const workspace = workspaceOf(wsRoot);
  withLockSync(workspace, WORKSPACE_MIGRATE_LOCK, () => {
    const names = listGraphNames(workspace);
    if (!names.includes(name)) {
      throw new Error(`图 "${name}" 不存在。可用: ${names.join(", ") || "（无）"}`);
    }
    fs.mkdirSync(dotGraph(workspace), { recursive: true });
    writeTextAtomic(path.join(dotGraph(workspace), ACTIVE_FILE), name);
    // 写路径显式失效（先于 appendWorkspaceEvent）
    clearGraphDirMemo();
    appendWorkspaceEvent(workspace, "switch", `active -> ${name}`, actor);
  });
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
    // 工作区审计必须固定在 .graph 根，不能随着 active 图切换而改变锁目标。
    withLockSync(workspaceOf(wsRoot), WORKSPACE_EVENTS_LOCK, () => {
      fs.appendFileSync(
        path.join(dotGraph(workspaceOf(wsRoot)), WS_EVENTS_FILE),
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
  const f = path.join(dotGraph(workspaceOf(wsRoot)), WS_EVENTS_FILE);
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

// 锁取得到的图目录在临界区内通过 async-local scope 固定。这样即使 active
// 在等待锁期间被别的进程切换，rootDir 的后续读写仍然落在同一张图。
const graphDirScope = new AsyncLocalStorage<Map<string, string>>();

export function withGraphDirTarget<T>(rootDir: string, targetDir: string, fn: () => T): T {
  const scoped = new Map<string, string>(graphDirScope.getStore() ?? []);
  const target = path.resolve(targetDir);
  scoped.set(path.resolve(rootDir), target);
  scoped.set(path.resolve(workspaceOf(rootDir)), target);
  return graphDirScope.run(scoped, fn);
}

/**
 * 全库路径归一化点：graph.yaml 在 p → p 已是图目录；p 含 .graph/ → 降入解析后的图目录
 * （旧布局 = .graph/ 原地，多图 = active/唯一图）；都没有 → 返回 p/.graph（未初始化，
 * 调用方报既有错误；写入方在此创建 = 旧布局位置，天然兼容）。
 * arch-c2：解析结果进程内 memo 化（键 = 绝对化 p），命中时免 readdir + 逐图 existsSync；
 * 探测与写路径显式失效保证语义不变（同 cwd 同结果，见上方 memo 说明）。
 */
export function toGraphDir(rootDir: string): string {
  const scoped = graphDirScope.getStore()?.get(path.resolve(rootDir));
  if (scoped !== undefined) return scoped;
  // 调用方已明确传入旧布局的 .graph 图目录时，即使 graph.yaml 尚未创建，
  // 也不能再拼成 .graph/.graph（写入口会先建目录再发布 graph.yaml）。
  if (path.basename(path.resolve(rootDir)) === GRAPH_DIR) return rootDir;
  if (fs.existsSync(path.join(rootDir, GRAPH_FILE))) return rootDir;
  const dg = path.join(rootDir, GRAPH_DIR);
  let dgStat: fs.Stats | null = null;
  try {
    dgStat = fs.statSync(dg);
  } catch {
    /* .graph 不存在：未初始化，无解析空间 */
  }
  if (dgStat === null) {
    graphDirMemo.delete(path.resolve(rootDir));
    return dg;
  }
  // memo 命中探测：布局变化动 .graph 目录 mtime，切默认图动 active 的 mtime/size
  const active = probeActiveFile(dg);
  const key = path.resolve(rootDir);
  const memo = graphDirMemo.get(key);
  if (
    memo !== undefined &&
    memo.dgMtimeMs === dgStat.mtimeMs &&
    memo.activeMtimeMs === (active !== null ? active.mtimeMs : null) &&
    memo.activeSize === (active !== null ? active.size : null)
  ) {
    graphDirMemoHits++;
    return memo.resolved;
  }
  let resolved: string;
  if (fs.existsSync(path.join(dg, GRAPH_FILE))) {
    resolved = dg;
  } else {
    try {
      resolved = resolveGraphDir(rootDir).dir;
    } catch {
      resolved = dg; // 多图但解析失败（active 缺失等）：返回 .graph/ 让调用方报错
    }
  }
  graphDirMemo.set(key, {
    resolved,
    dgMtimeMs: dgStat.mtimeMs,
    activeMtimeMs: active !== null ? active.mtimeMs : null,
    activeSize: active !== null ? active.size : null,
  });
  return resolved;
}

/** 图目录 → 工作区根（.graph/x/ 的上上级；旧布局 .graph/ 的上级；否则原样） */
export function workspaceOf(dir: string): string {
  if (path.basename(dir) === GRAPH_DIR) return path.dirname(dir);
  if (path.basename(path.dirname(dir)) === GRAPH_DIR) return path.dirname(path.dirname(dir));
  return dir;
}

// ── 路径解析 memo（arch-c2：10k 节点读路径的重复目录 I/O 减负）──
// toGraphDir 是全库读路径的咽喉（parser.nodeFilePath/edgeFilePath 每个实体文件、
// index-service 的新鲜度校验都要过这里）；多图布局下每次解析 = readdir + 逐图
// existsSync + 读 active，10k 节点全量构建会把这套目录 I/O 重复上万次。
// 设计：
//   - 进程内 memo，键 = path.resolve(rootDir)——键含绝对路径，天然不跨 cwd 污染；
//     不落盘、不跨进程（同 fix_index_cache 的进程内缓存边界）；
//   - 命中探测 = stat(.graph 目录) + stat(.graph/active)：目录 mtime 对"子项增删/
//     改名"敏感（建图/删图/迁移/改名必变），active 的 mtime+size 对"切换默认图"
//     敏感——两个廉价 syscall 替代 readdir + N×existsSync，语义不变（同 cwd 同结果）；
//   - 写路径原语（writeWorkspaceDefault/createGraph/trashGraph/migrateLegacyLayout）
//     落盘后显式清 memo——确定性失效，不与文件系统时钟粒度赌运气（同
//     fix_index_cache 的主动失效思路）。
interface GraphDirMemoEntry {
  resolved: string;
  dgMtimeMs: number;
  activeMtimeMs: number | null;
  activeSize: number | null;
}

const graphDirMemo = new Map<string, GraphDirMemoEntry>();
let graphDirMemoHits = 0;

/** 测试辅助：清空进程内路径解析 memo（含命中计数归零，便于用例断言） */
export function resetGraphDirMemo(): void {
  graphDirMemo.clear();
  graphDirMemoHits = 0;
}

/** 测试/诊断：memo 命中计数与当前条目数（memo 生效证据） */
export function graphDirMemoStats(): { hits: number; size: number } {
  return { hits: graphDirMemoHits, size: graphDirMemo.size };
}

function clearGraphDirMemo(): void {
  graphDirMemo.clear();
}

function probeActiveFile(dg: string): { mtimeMs: number; size: number } | null {
  try {
    const st = fs.statSync(path.join(dg, ACTIVE_FILE));
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null; // active 不存在（兜底解析/未指定）也参与 memo 键
  }
}

/** 工作区级迁移互斥锁 id（与各图自身锁空间隔离，锁文件在 .graph/.locks/） */
export const WORKSPACE_MIGRATE_LOCK = "__ws_migrate__";
/** 工作区审计锁也固定落在 .graph/.locks/，不随 active 图切换。 */
export const WORKSPACE_EVENTS_LOCK = "__ws_events__";

function restoreLegacyItems(wsRoot: string, moved: string[]): void {
  const dg = dotGraph(wsRoot);
  const target = path.join(dg, "default");
  for (const item of [...moved].reverse()) {
    const from = path.join(target, item);
    const to = path.join(dg, item);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    try {
      fs.renameSync(from, to);
    } catch {
      // 补偿尽力而为；原始异常仍由调用方抛出，避免伪报成功。
    }
  }
  clearGraphDirMemo();
}

/**
 * 旧布局一次性迁移：把 .graph/ 根上的 6 项 renameSync 进 .graph/default/。
 * 同卷 rename 原子（逐项）；调用方须持有工作区级锁。迁移中断时回滚已搬项。
 */
function migrateLegacyLayoutCore(wsRoot: string, actor = "unknown"): string[] {
  const dg = dotGraph(wsRoot);
  if (!fs.existsSync(path.join(dg, GRAPH_FILE))) return [];
  const target = path.join(dg, "default");
  fs.mkdirSync(target, { recursive: true });
  const pending = LEGACY_ITEMS.filter((item) => fs.existsSync(path.join(dg, item)));
  for (const item of pending) {
    const destination = path.join(target, item);
    if (fs.existsSync(destination)) {
      throw new Error(`旧布局迁移目标已存在: ${destination}`);
    }
  }
  const moved: string[] = [];
  try {
    for (const item of pending) {
      fs.renameSync(path.join(dg, item), path.join(target, item));
      moved.push(item);
    }
  } catch (error) {
    restoreLegacyItems(wsRoot, moved);
    throw error;
  }
  if (moved.length > 0) clearGraphDirMemo(); // 布局变更：确定性失效路径 memo
  appendWorkspaceEvent(wsRoot, "migrate", `legacy -> default/（${moved.join(", ")}）`, actor);
  return moved;
}

export function migrateLegacyLayout(wsRoot: string, actor = "unknown"): string[] {
  const workspace = workspaceOf(wsRoot);
  return withLockSync(workspace, WORKSPACE_MIGRATE_LOCK, () =>
    migrateLegacyLayoutCore(workspace, actor),
  );
}

/** 创建新图：在工作区锁内复查同名、迁移旧布局并原子发布完整骨架。 */
export function createGraph(
  wsRoot: string,
  name: string,
  label: string,
  // class 类型 = types.GraphClass（arch-c4a：运行时枚举单源在 core/schema.ts 的
  // GRAPH_CLASSES，GraphClass 是其类型镜像；此处不再重写字面量联合）
  opts: { actor?: string; version?: string; class?: GraphClass } = {},
): string {
  assertValidGraphName(name);
  const workspace = workspaceOf(wsRoot);
  return withLockSync(workspace, WORKSPACE_MIGRATE_LOCK, () => {
    const dg = dotGraph(workspace);
    fs.mkdirSync(dg, { recursive: true });
    const names = listGraphNames(workspace);
    if (names.includes(name)) {
      throw new Error(`图 "${name}" 已存在。可用名不含它: ${names.join(", ")}`);
    }

    let stage: string | undefined;
    let moved: string[] = [];
    try {
      stage = fs.mkdtempSync(path.join(dg, `.${name}.creating-`));
      for (const d of [NODES_DIR, EDGES_DIR, "snapshots", INDEX_DIR, ".locks"]) {
        fs.mkdirSync(path.join(stage, d), { recursive: true });
      }
      // S3-5/N4（f15）：graph.yaml 骨架改走 GraphSchema 对象 + yaml.dump 落盘——
      // 与 parser.writeGraph 同一序列化器，label 含 : # " 换行时自动加引号/转义。
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
      // F03/F13（DEC-2）：init --class 工作类预设（缺省不标注，schema 可选枚举）
      if (opts.class) skeleton.class = opts.class;
      writeTextAtomic(
        path.join(stage, GRAPH_FILE),
        yaml.dump(skeleton, { indent: 2, lineWidth: 120 }),
      );

      // 建第二图触发一次性迁移，且与骨架发布处于同一工作区事务。
      if (names.length > 0 && fs.existsSync(path.join(dg, GRAPH_FILE))) {
        moved = migrateLegacyLayoutCore(workspace, opts.actor);
      }
      const dir = path.join(dg, name);
      if (fs.existsSync(dir)) {
        throw new Error(`目录已存在: ${dir}`);
      }
      fs.renameSync(stage, dir);
      stage = undefined;
      clearGraphDirMemo(); // 新图目录入布局：确定性失效路径 memo
      appendWorkspaceEvent(workspace, "init", `graph=${name} label="${label}"`, opts.actor);
      return dir;
    } catch (error) {
      if (stage !== undefined) {
        try {
          fs.rmSync(stage, { recursive: true, force: true });
        } catch {
          /* staging 目录清理失败不掩盖主异常 */
        }
      }
      if (moved.length > 0) restoreLegacyItems(workspace, moved);
      throw error;
    }
  });
}

/** 软删除：移入 .trash/<名>-<时间戳>/（可手工救回）。调用方负责策略校验（最后一张/active）。 */
export function trashGraph(wsRoot: string, name: string, actor = "unknown"): string {
  assertValidGraphName(name);
  const workspace = workspaceOf(wsRoot);
  return withLockSync(workspace, WORKSPACE_MIGRATE_LOCK, () => {
    const dg = dotGraph(workspace);
    const src =
      name === "default" && fs.existsSync(path.join(dg, GRAPH_FILE))
        ? dg
        : path.join(dg, name);
    if (!fs.existsSync(path.join(src, GRAPH_FILE))) {
      throw new Error(`图 "${name}" 不存在。可用: ${listGraphNames(workspace).join(", ") || "（无）"}`);
    }
    const trash = path.join(dg, TRASH_DIR);
    fs.mkdirSync(trash, { recursive: true });
    let dest = path.join(trash, `${name}-${Date.now()}`);
    if (fs.existsSync(dest)) dest = `${dest}-${Math.random().toString(36).slice(2, 8)}`;
    fs.renameSync(src, dest);
    clearGraphDirMemo(); // 图目录移出布局：确定性失效路径 memo
    appendWorkspaceEvent(workspace, "delete", `graph=${name} -> .graph/.trash/（可手工救回）`, actor);
    return dest;
  });
}
