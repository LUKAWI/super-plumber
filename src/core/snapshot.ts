// src/core/snapshot.ts
// 版本控制原语（需求 4.3）：文件级 Snapshot / Diff / Rollback。
// Branch / Merge 由 Git 承担（文件即真相源），本模块只做三个文件级原语。
// 快照布局：.graph/snapshots/<id>/{manifest.json, graph.yaml, nodes/*, edges/*}
// S3-10（f16）：manifest 文件名修正——内容自始是 JSON.stringify 产物、JSON.parse
// 读出，此前叫 manifest.yaml 名不副实，现统一为 manifest.json；历史快照目录里
// 的 manifest.yaml 由 readManifest 兼容读取（只读兼容，不再写出）。
// rollback 前自动备份当前状态（pre-rollback 快照），且必须显式 confirm。
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { type NodeSchema } from "./types.js";
import {
  assertValidEntityId,
  formatIssues,
  isValidEntityId,
  listEdgeFileNames,
  listNodeFileNames,
  validateEdge,
  validateGraph,
  validateNode,
} from "./schema.js";
import { appendEvent } from "./eventlog.js";
import { withGraphLock } from "./graph-io.js";
import { runDocsExport } from "./docs-export.js";
import { toGraphDir } from "./graph-dir.js";

export interface SnapshotFileEntry {
  file: string; // 相对 .graph/ 的路径（正斜杠）
  sha256: string;
}

export interface SnapshotManifest {
  id: string;
  created_at: string;
  message?: string;
  files: SnapshotFileEntry[];
}

export interface StatusChange {
  node: string;
  from: string;
  to: string;
}

export interface DiffResult {
  from: string; // 快照 id 或 "working"
  to: string; // 快照 id 或 "working"
  added: string[];
  removed: string[];
  modified: string[];
  status_changes: StatusChange[];
}

const SNAPSHOTS_DIR = "snapshots";
const MANIFEST = "manifest.json";
// S3-10（f16）之前的旧名：内容同为 JSON，仅供 readManifest 向后兼容读取——
// 存量历史快照（.graph/*/snapshots/ 下）只有 manifest.yaml，不认它会让
// listSnapshots/diff/rollback 对全部历史快照失明（行为回归）
const LEGACY_MANIFEST = "manifest.yaml";
const SNAPSHOT_STAGE_PREFIX = ".snapshot-";
const ROLLBACK_STAGE_PREFIX = ".rollback-stage-";
const ROLLBACK_BACKUP_PREFIX = ".rollback-backup-";
const ARCHIVED_FILE_RE = /\.deleted(?:\.\d+)?\.yaml$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;

// 0.9.6 以前生成的 ID 含有 ISO 的大写 T/Z。新 ID 使用同一安全字符集的
// 小写形式；仅对这个历史生成格式保留读取/回滚兼容，不放宽到任意大写或路径字符。
const LEGACY_SNAPSHOT_ID_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]{6}$/;

const ROLLBACK_COMPONENTS = ["graph.yaml", "nodes", "edges"] as const;
type RollbackComponent = (typeof ROLLBACK_COMPONENTS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathWithin(base: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function pathExists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return false;
    throw err;
  }
}

/** 找到路径上最近的已存在项，用 realpath 捕获父目录 symlink 越界。 */
function nearestExistingPath(file: string): string {
  let current = path.resolve(file);
  while (true) {
    try {
      fs.lstatSync(current);
      return current;
    } catch (err: any) {
      if (err?.code !== "ENOENT" && err?.code !== "ENOTDIR") throw err;
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

/**
 * 同时做词法 containment 与已存在路径的 realpath containment。
 * 词法检查挡住 .. / 绝对路径，realpath 检查挡住 symlink 目录或文件。
 */
function assertContainedPath(base: string, candidate: string, label: string): string {
  const baseResolved = path.resolve(base);
  const candidateResolved = path.resolve(candidate);
  if (!isPathWithin(baseResolved, candidateResolved)) {
    throw new Error(
      `${label}路径越界: "${candidate}" 不在受保护目录 "${base}" 内`,
    );
  }

  const realBase = path.resolve(fs.realpathSync(nearestExistingPath(baseResolved)));
  const realCandidate = path.resolve(
    fs.realpathSync(nearestExistingPath(candidateResolved)),
  );
  if (!isPathWithin(realBase, realCandidate)) {
    throw new Error(
      `${label}路径越界: "${candidate}" 解析后不在受保护目录 "${base}" 内`,
    );
  }
  return candidateResolved;
}

function assertDirectory(dir: string, label: string, allowMissing = false): void {
  try {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${label}不是安全目录: ${dir}`);
    }
  } catch (err: any) {
    if (err?.code === "ENOENT" && allowMissing) return;
    throw err;
  }
}

function ensureDirectory(dir: string, label: string): void {
  if (!pathExists(dir)) fs.mkdirSync(dir, { recursive: true });
  assertDirectory(dir, label);
}

function assertRegularFile(file: string, label: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (err: any) {
    throw new Error(`${label}不存在或无法读取: ${file} (${err?.message ?? String(err)})`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label}不是安全普通文件: ${file}`);
  }
}

function graphDirOf(rootDir: string): string {
  const graphDir = path.resolve(toGraphDir(rootDir));
  assertDirectory(graphDir, "graph 目录");
  return graphDir;
}

function snapshotsDir(rootDir: string): string {
  const graphDir = graphDirOf(rootDir);
  const dir = assertContainedPath(
    graphDir,
    path.join(graphDir, SNAPSHOTS_DIR),
    "快照目录",
  );
  return dir;
}

function snapshotIdIsValid(id: unknown): id is string {
  return (
    typeof id === "string" &&
    (isValidEntityId(id) || LEGACY_SNAPSHOT_ID_RE.test(id))
  );
}

function assertSnapshotId(id: string): void {
  if (!snapshotIdIsValid(id)) {
    throw new Error(
      `非法快照 ID: "${String(id)}"。必须符合实体 ID 规则（小写字母/数字/./_/-，≤64 字符；禁路径分隔符、冒号、..、Windows 保留名），或是旧版 ISO 快照 ID`,
    );
  }
}

function snapPath(rootDir: string, id: string): string {
  assertSnapshotId(id);
  const snapshots = snapshotsDir(rootDir);
  return assertContainedPath(
    snapshots,
    path.join(snapshots, id),
    "快照 ID",
  );
}

/** 只允许真相源文件名，不接受 snapshots/manifest 或任意用户路径。 */
function normalizeSnapshotRelativePath(file: unknown, label: string): string {
  if (typeof file !== "string" || file.length === 0 || file.includes("\0")) {
    throw new Error(`${label}文件路径非法: 必须是非空安全相对路径`);
  }
  const normalized = file.replace(/\\/g, "/");
  if (normalized === "graph.yaml") return normalized;

  const match = /^(nodes|edges)\/([^/]+)\.yaml$/.exec(normalized);
  if (match === null || !isValidEntityId(match[2])) {
    throw new Error(
      `${label}文件路径非法: "${file}" 只能是 graph.yaml、nodes/<实体ID>.yaml 或 edges/<实体ID>.yaml`,
    );
  }
  return normalized;
}

function resolveSafeRelativePath(
  base: string,
  relative: unknown,
  label: string,
): string {
  const normalized = normalizeSnapshotRelativePath(relative, label);
  return assertContainedPath(
    base,
    path.join(base, ...normalized.split("/")),
    label,
  );
}

function validateManifestShape(id: string, value: unknown): SnapshotManifest {
  assertSnapshotId(id);
  if (!isRecord(value)) throw new Error(`快照 ${id} manifest 必须是 JSON 对象`);
  if (value.id !== id) {
    throw new Error(
      `快照 manifest 身份不一致: 目录/请求 id="${id}"，manifest id="${String(value.id)}"`,
    );
  }
  if (typeof value.created_at !== "string" || value.created_at.length === 0) {
    throw new Error(`快照 ${id} manifest.created_at 非法`);
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    throw new Error(`快照 ${id} manifest.message 必须是字符串`);
  }
  if (!Array.isArray(value.files)) {
    throw new Error(`快照 ${id} manifest.files 必须是数组`);
  }

  const files: SnapshotFileEntry[] = [];
  const seen = new Set<string>();
  for (const raw of value.files) {
    if (!isRecord(raw)) throw new Error(`快照 ${id} manifest.files 存在非法项`);
    const file = normalizeSnapshotRelativePath(raw.file, `快照 ${id} manifest`);
    if (seen.has(file)) throw new Error(`快照 ${id} manifest 存在重复文件: ${file}`);
    seen.add(file);
    if (typeof raw.sha256 !== "string" || !SHA256_RE.test(raw.sha256)) {
      throw new Error(`快照 ${id} manifest 的 ${file} sha256 非法`);
    }
    files.push({ file, sha256: raw.sha256.toLowerCase() });
  }
  if (!seen.has("graph.yaml")) {
    throw new Error(`快照 ${id} manifest 缺少 graph.yaml`);
  }

  return {
    id,
    created_at: value.created_at,
    ...(value.message !== undefined ? { message: value.message as string } : {}),
    files,
  };
}

/** 读取 manifest；非 strict 模式供列表跳过损坏/非法历史目录。 */
function readManifest(
  rootDir: string,
  id: string,
  strict = false,
): SnapshotManifest | null {
  try {
    assertSnapshotId(id);
    const dir = snapPath(rootDir, id);
    if (!pathExists(dir)) return null;
    assertDirectory(dir, `快照 ${id} 目录`);

    let parseError: unknown;
    for (const name of [MANIFEST, LEGACY_MANIFEST]) {
      const file = assertContainedPath(
        dir,
        path.join(dir, name),
        `快照 ${id} manifest`,
      );
      if (!pathExists(file)) continue;
      try {
        assertRegularFile(file, `快照 ${id} manifest`);
        const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
        return validateManifestShape(id, parsed);
      } catch (err) {
        parseError = err;
      }
    }
    if (strict && parseError !== undefined) throw parseError;
    return null;
  } catch (err) {
    if (strict) throw err;
    return null;
  }
}

export function listSnapshots(rootDir: string): SnapshotManifest[] {
  const graphDir = path.resolve(toGraphDir(rootDir));
  if (!pathExists(graphDir)) return [];
  assertDirectory(graphDir, "graph 目录");
  const dir = assertContainedPath(
    graphDir,
    path.join(graphDir, SNAPSHOTS_DIR),
    "快照目录",
  );
  if (!pathExists(dir)) return [];
  assertDirectory(dir, "快照目录");

  const manifests: SnapshotManifest[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !snapshotIdIsValid(entry.name)) {
      continue;
    }
    const manifest = readManifest(rootDir, entry.name);
    if (manifest !== null) manifests.push(manifest);
  }
  return manifests.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function hashFile(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** 收集当前 .graph/ 下全部真相源文件（相对 .graph/ 的路径） */
function collectSourceFiles(rootDir: string): string[] {
  const graphDir = graphDirOf(rootDir);
  const graphFile = assertContainedPath(
    graphDir,
    path.join(graphDir, "graph.yaml"),
    "工作区 graph.yaml",
  );
  assertRegularFile(graphFile, "工作区 graph.yaml");

  const files: string[] = ["graph.yaml"];
  const collect = (kind: "nodes" | "edges", names: string[]): void => {
    const entityDir = path.join(graphDir, kind);
    if (!pathExists(entityDir)) return;
    assertContainedPath(graphDir, entityDir, `${kind} 目录`);
    assertDirectory(entityDir, `${kind} 目录`);
    for (const name of names) {
      const id = name.endsWith(".yaml") ? name.slice(0, -5) : "";
      assertValidEntityId(kind === "nodes" ? "节点" : "边", id);
      const relative = `${kind}/${name}`;
      const source = resolveSafeRelativePath(graphDir, relative, `${kind} 源文件`);
      assertRegularFile(source, `${kind} 源文件`);
      files.push(relative);
    }
  };
  collect("nodes", listNodeFileNames(graphDir));
  collect("edges", listEdgeFileNames(graphDir));
  return files;
}

function readYamlForValidation(file: string, label: string): unknown {
  try {
    return yaml.load(fs.readFileSync(file, "utf-8"));
  } catch (err: any) {
    throw new Error(`${label} YAML 校验失败: ${err?.message ?? String(err)}`);
  }
}

function assertSchemaValid(
  data: unknown,
  validate: (value: unknown) => { field: string; message: string }[],
  label: string,
): void {
  const issues = validate(data);
  if (issues.length > 0) {
    throw new Error(`${label} schema 校验失败: ${formatIssues(issues)}`);
  }
}

function validateGraphReferences(
  graphData: unknown,
  entryFiles: Set<string>,
  label: string,
): void {
  if (!isRecord(graphData)) return;
  for (const kind of ["nodes", "edges"] as const) {
    const refs = graphData[kind];
    if (!Array.isArray(refs)) continue;
    const prefix = `${kind}/`;
    for (const ref of refs) {
      if (!isRecord(ref)) continue;
      const normalized = normalizeSnapshotRelativePath(ref.file, `${label} ${kind} 引用`);
      if (!normalized.startsWith(prefix) || !entryFiles.has(normalized)) {
        throw new Error(`${label} ${kind} 引用不存在或类型不匹配: ${String(ref.file)}`);
      }
    }
  }
}

/** 对快照或 staging 中的全部真相源做哈希、路径和 YAML/schema 完整校验。 */
function validateSnapshotFilesAtDir(
  rootDir: string,
  snapshotId: string,
  snapshotDir: string,
  manifest: SnapshotManifest,
  options: { checkHashes: boolean },
): void {
  const graphDir = graphDirOf(rootDir);
  assertContainedPath(graphDir, snapshotDir, `快照 ${snapshotId} staging`);
  assertDirectory(snapshotDir, `快照 ${snapshotId} staging`);

  const entryFiles = new Set(manifest.files.map((entry) => entry.file));
  let graphData: unknown;
  for (const entry of manifest.files) {
    const file = resolveSafeRelativePath(
      snapshotDir,
      entry.file,
      `快照 ${snapshotId} 文件`,
    );
    assertRegularFile(file, `快照 ${snapshotId} 文件 ${entry.file}`);
    if (options.checkHashes) {
      const actual = hashFile(file);
      if (actual.toLowerCase() !== entry.sha256.toLowerCase()) {
        throw new Error(
          `快照 ${snapshotId} 文件校验失败: ${entry.file} sha256 不匹配`,
        );
      }
    }

    const data = readYamlForValidation(file, `快照 ${snapshotId} 文件 ${entry.file}`);
    if (entry.file === "graph.yaml") {
      assertSchemaValid(data, validateGraph, `快照 ${snapshotId} graph.yaml`);
      graphData = data;
    } else if (entry.file.startsWith("nodes/")) {
      assertSchemaValid(data, validateNode, `快照 ${snapshotId} ${entry.file}`);
      const expectedId = entry.file.slice("nodes/".length, -".yaml".length);
      if (!isRecord(data) || data.id !== expectedId) {
        throw new Error(
          `快照 ${snapshotId} 节点身份不一致: ${entry.file} 内部 id="${String(isRecord(data) ? data.id : undefined)}"`,
        );
      }
    } else {
      assertSchemaValid(data, validateEdge, `快照 ${snapshotId} ${entry.file}`);
      const expectedId = entry.file.slice("edges/".length, -".yaml".length);
      if (!isRecord(data) || data.id !== expectedId) {
        throw new Error(
          `快照 ${snapshotId} 边身份不一致: ${entry.file} 内部 id="${String(isRecord(data) ? data.id : undefined)}"`,
        );
      }
    }
  }
  validateGraphReferences(graphData, entryFiles, `快照 ${snapshotId}`);
}

function loadSnapshot(rootDir: string, id: string): SnapshotManifest {
  assertSnapshotId(id);
  const manifest = readManifest(rootDir, id, true);
  if (manifest === null) throw new Error(`Snapshot ${id} not found`);
  const dir = snapPath(rootDir, id);
  validateSnapshotFilesAtDir(rootDir, id, dir, manifest, { checkHashes: true });
  return manifest;
}

// FIX-E1 + S1-11（f7）：快照/回滚改持图级锁（GRAPH_LOCK）——
// 不再只串行化同类操作：writeNode/writeEdge/writeGraph/syncGraphRef 等
// 写路径同样持图级锁，逐文件复制期间写入被互斥（无撕裂副本/新旧混装），
// 回滚恢复期间写入被互斥（防复活半旧状态）。备份走无锁内层避免重入死锁
// （锁不可重入——图锁持有人只能调 *Core/*Locked 变体）。
// 持锁超 30s 会被判陈锁；常规规模图复制远低于该阈值，写方默认 3s 超时
// 撞上大图快照会收到可读的 LockTimeoutError（可重试，不静默腐化）。
export function createSnapshot(
  rootDir: string,
  message?: string,
  opts: { actor?: string; skipDocsExport?: boolean } = {},
): SnapshotManifest {
  return withGraphLock(rootDir, () =>
    createSnapshotUnlocked(rootDir, message, opts),
  );
}

function removeTemporaryDirectory(dir: string, parent: string, label: string): void {
  try {
    if (!pathExists(dir)) return;
    assertContainedPath(parent, dir, label);
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(dir);
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // 清理失败不掩盖原始异常；事务备份在切换失败时会被保留并写入报错。
  }
}

function createSnapshotUnlocked(
  rootDir: string,
  message?: string,
  opts: { actor?: string; skipDocsExport?: boolean } = {},
): SnapshotManifest {
  const graphDir = graphDirOf(rootDir);
  const snapshots = assertContainedPath(
    graphDir,
    path.join(graphDir, SNAPSHOTS_DIR),
    "快照目录",
  );
  ensureDirectory(snapshots, "快照目录");

  const now = new Date();
  // 小写化 ISO 的 T/Z，使新 ID 与实体 ID 规则一致；旧大写格式由读取兼容。
  const id = `${now.toISOString().replace(/[:.]/g, "-")}-${Math.random()
    .toString(36)
    .slice(2, 8)}`.toLowerCase();
  assertSnapshotId(id);
  const target = snapPath(graphDir, id);
  if (pathExists(target)) throw new Error(`Snapshot ${id} already exists`);

  const stage = fs.mkdtempSync(path.join(snapshots, SNAPSHOT_STAGE_PREFIX));
  assertContainedPath(snapshots, stage, "快照 staging");
  assertDirectory(stage, "快照 staging");
  try {
    const files: SnapshotFileEntry[] = [];
    for (const rel of collectSourceFiles(graphDir)) {
      const src = resolveSafeRelativePath(graphDir, rel, "快照源");
      assertRegularFile(src, `快照源 ${rel}`);
      const dest = resolveSafeRelativePath(stage, rel, "快照 staging");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      const sha256 = hashFile(src);
      if (hashFile(dest) !== sha256) {
        throw new Error(`快照文件复制校验失败: ${rel}`);
      }
      files.push({ file: rel, sha256 });
    }

    const manifest: SnapshotManifest = {
      id,
      created_at: now.toISOString(),
      ...(message ? { message } : {}),
      files,
    };
    validateManifestShape(id, manifest);
    const manifestFile = assertContainedPath(
      stage,
      path.join(stage, MANIFEST),
      "快照 manifest",
    );
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf-8");
    // 在原子发布前再做一遍完整校验，保证最终快照不是半成品。
    validateSnapshotFilesAtDir(graphDir, id, stage, manifest, { checkHashes: true });

    // stage 与 target 同父目录，rename 在同一文件系统上原子发布完整快照。
    fs.renameSync(stage, target);

    // v0.5.1：快照即设计定稿点——创建快照时自动导出领域文档视图（纯工具行为，无 LLM 决策）：
    // CONTEXT-MAP.md + docs/contexts/*.md + docs/adr/*.md 随快照点落盘，git 一并提交即冻结。
    // F21（DEC-7）：结构修订的自动快照（amend.ts）是回滚安全网、不是设计定稿点——
    // skipDocsExport 跳过导出（零文档副作用、零额外写放大；文档视图仍由显式
    // snapshot 落盘）。adr_0013：导出经 runDocsExport 统一默认——多图工作区自动落
    // docs/<图名>/ 分离目录；单图工作区路径不变。
    // 非致命：导出失败不回滚快照（图仍是真相源），失败原因记入事件。
    let docsDetail = "";
    if (opts.skipDocsExport) {
      docsDetail = " docs_export=skipped";
    } else {
      try {
        const docs = runDocsExport(rootDir);
        docsDetail = ` docs_exported=${docs.written.length}`;
      } catch (err: any) {
        docsDetail = ` docs_export_failed=${err?.message ?? "unknown"}`;
      }
    }
    appendEvent(rootDir, {
      actor: opts.actor ?? "unknown",
      kind: "snapshot_created",
      detail: `snapshot=${id}${message ? ` message="${message}"` : ""}${docsDetail}`,
    });
    return manifest;
  } catch (err) {
    removeTemporaryDirectory(stage, snapshots, "快照 staging");
    throw err;
  }
}

/** 读取某侧（working 或快照）的节点 status：rel 形如 nodes/x.yaml */
function nodeStatusOf(
  rootDir: string,
  fromId: string | null,
  rel: string,
): string | null {
  const base = fromId === null ? graphDirOf(rootDir) : snapPath(rootDir, fromId);
  const file = resolveSafeRelativePath(base, rel, "diff 文件");
  try {
    const data = yaml.load(fs.readFileSync(file, "utf-8")) as {
      status?: string;
    };
    return data?.status ?? null;
  } catch {
    return null;
  }
}

export function diffSnapshot(
  rootDir: string,
  fromId: string | null, // null = working
  toId: string | null, // null = working
): DiffResult {
  const fromLabel = fromId ?? "working";
  const toLabel = toId ?? "working";

  const fromFiles = new Map<string, string>(); // rel → sha
  for (const rel of sideFiles(rootDir, fromId)) {
    fromFiles.set(rel, shaOf(rootDir, fromId, rel));
  }
  const toFiles = new Map<string, string>();
  for (const rel of sideFiles(rootDir, toId)) {
    toFiles.set(rel, shaOf(rootDir, toId, rel));
  }

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  const status_changes: StatusChange[] = [];

  for (const [rel, sha] of toFiles) {
    if (!fromFiles.has(rel)) {
      added.push(rel);
    } else if (fromFiles.get(rel) !== sha) {
      modified.push(rel);
      if (rel.startsWith("nodes/")) {
        const fromStatus = nodeStatusOf(rootDir, fromId, rel);
        const toStatus = nodeStatusOf(rootDir, toId, rel);
        if (fromStatus !== null && toStatus !== null && fromStatus !== toStatus) {
          status_changes.push({
            node: rel.replace(/^nodes\//, "").replace(/\.yaml$/, ""),
            from: fromStatus,
            to: toStatus,
          });
        }
      }
    }
  }
  for (const rel of fromFiles.keys()) {
    if (!toFiles.has(rel)) removed.push(rel);
  }

  return { from: fromLabel, to: toLabel, added, removed, modified, status_changes };
}

function sideFiles(rootDir: string, id: string | null): string[] {
  if (id !== null) return loadSnapshot(rootDir, id).files.map((f) => f.file);
  return collectSourceFiles(rootDir);
}

function shaOf(rootDir: string, id: string | null, rel: string): string {
  const base = id === null ? graphDirOf(rootDir) : snapPath(rootDir, id);
  const file = resolveSafeRelativePath(base, rel, "diff 文件");
  try {
    return hashFile(file);
  } catch {
    return "missing";
  }
}

export function rollbackToSnapshot(
  rootDir: string,
  id: string,
  opts: { confirm?: boolean; designOnly?: boolean; actor?: string } = {},
): { restored: SnapshotManifest; backup: SnapshotManifest } {
  if (!opts.confirm) {
    throw new Error(
      `rollback 会覆盖当前 .graph/ 内容，请显式加 --confirm（自动备份当前状态）`,
    );
  }
  // FIX-E1 + S1-11：与写路径共持图级锁（备份走无锁内层，避免重入死锁）
  return withGraphLock(rootDir, () =>
    rollbackToSnapshotUnlocked(rootDir, id, opts),
  );
}

// FIX-C2（评审 C 级·设计态与执行态同卷）：design-only 回滚。
// 全量回滚会把执行进度（status/attempts/execution_report）一起冲掉——
// "撤回三天前的错误结构重构，保留两百个节点的执行成果"此前不可能。
// designOnly：graph.yaml 与边文件全量恢复（纯设计态）；节点文件字段级合并
// （保留执行态字段，恢复设计字段）；快照后新增的节点被删除（撤销设计新增）。
const DESIGN_ONLY_KEEP_FIELDS = [
  "status",
  "attempts",
  "assigned_to",
  "execution_report",
  "created_at",
  "updated_at",
] as const;

function designOnlyMergeNode(current: unknown, fromSnap: unknown): NodeSchema {
  const cur = current as Record<string, unknown>;
  const snap = fromSnap as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...snap };
  for (const k of DESIGN_ONLY_KEEP_FIELDS) {
    if (cur[k] !== undefined) merged[k] = cur[k];
    else delete merged[k];
  }
  return merged as unknown as NodeSchema;
}

function activeFileNames(graphDir: string, kind: "nodes" | "edges"): string[] {
  const dir = path.join(graphDir, kind);
  if (!pathExists(dir)) return [];
  assertContainedPath(graphDir, dir, `${kind} 目录`);
  assertDirectory(dir, `${kind} 目录`);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".yaml") && !ARCHIVED_FILE_RE.test(name))
    .map((name) => {
      const id = name.slice(0, -".yaml".length);
      assertValidEntityId(kind === "nodes" ? "节点" : "边", id);
      const file = resolveSafeRelativePath(graphDir, `${kind}/${name}`, `${kind} 文件`);
      assertRegularFile(file, `${kind} 文件`);
      return name;
    });
}

function archivedFileNames(graphDir: string, kind: "nodes" | "edges"): string[] {
  const dir = path.join(graphDir, kind);
  if (!pathExists(dir)) return [];
  assertContainedPath(graphDir, dir, `${kind} 目录`);
  assertDirectory(dir, `${kind} 目录`);
  return fs
    .readdirSync(dir)
    .filter((name) => ARCHIVED_FILE_RE.test(name))
    .map((name) => {
      if (path.basename(name) !== name) {
        throw new Error(`${kind} 软删除归档文件名非法: ${name}`);
      }
      const file = assertContainedPath(dir, path.join(dir, name), `${kind} 归档`);
      assertRegularFile(file, `${kind} 归档`);
      return name;
    });
}

function copyArchivedFiles(
  graphDir: string,
  stage: string,
  kind: "nodes" | "edges",
): void {
  for (const name of archivedFileNames(graphDir, kind)) {
    const source = assertContainedPath(
      path.join(graphDir, kind),
      path.join(graphDir, kind, name),
      `${kind} 归档源`,
    );
    const dest = assertContainedPath(
      path.join(stage, kind),
      path.join(stage, kind, name),
      `${kind} 归档 staging`,
    );
    fs.copyFileSync(source, dest);
    assertRegularFile(dest, `${kind} 归档 staging`);
  }
}

function copySnapshotEntry(
  rootDir: string,
  id: string,
  snapshotDir: string,
  stage: string,
  entry: SnapshotFileEntry,
): void {
  const source = resolveSafeRelativePath(snapshotDir, entry.file, `快照 ${id} 源`);
  assertRegularFile(source, `快照 ${id} 源 ${entry.file}`);
  const dest = resolveSafeRelativePath(stage, entry.file, `回滚 ${id} staging`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
  assertRegularFile(dest, `回滚 ${id} staging ${entry.file}`);
  if (hashFile(dest).toLowerCase() !== entry.sha256.toLowerCase()) {
    throw new Error(`回滚 ${id} staging 文件校验失败: ${entry.file}`);
  }
  // rootDir 参数保留在签名中，令调用点明确该复制属于当前图而非跨图路径。
  void rootDir;
}

function copyOrMergeDesignNode(
  rootDir: string,
  id: string,
  snapshotDir: string,
  stage: string,
  graphDir: string,
  entry: SnapshotFileEntry,
): void {
  const current = resolveSafeRelativePath(graphDir, entry.file, `当前图节点 ${entry.file}`);
  const dest = resolveSafeRelativePath(stage, entry.file, `回滚 ${id} staging`);
  const source = resolveSafeRelativePath(snapshotDir, entry.file, `快照 ${id} 源`);
  assertRegularFile(source, `快照 ${id} 源 ${entry.file}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  let currentData: unknown = null;
  if (pathExists(current)) {
    assertRegularFile(current, `当前图节点 ${entry.file}`);
    try {
      currentData = yaml.load(fs.readFileSync(current, "utf-8"));
    } catch {
      currentData = null;
    }
  }
  if (currentData !== null && currentData !== undefined && validateNode(currentData).length === 0) {
    const snapData = readYamlForValidation(source, `快照 ${id} 节点 ${entry.file}`);
    const merged = designOnlyMergeNode(currentData, snapData);
    assertSchemaValid(merged, validateNode, `回滚 ${id} 节点 ${entry.file}`);
    fs.writeFileSync(dest, yaml.dump(merged, { indent: 2, lineWidth: 120 }), "utf-8");
  } else {
    fs.copyFileSync(source, dest);
    if (hashFile(dest).toLowerCase() !== entry.sha256.toLowerCase()) {
      throw new Error(`回滚 ${id} staging 文件校验失败: ${entry.file}`);
    }
  }
  assertRegularFile(dest, `回滚 ${id} staging ${entry.file}`);
  void rootDir;
}

function prepareRollbackStage(
  rootDir: string,
  id: string,
  snapshot: SnapshotManifest,
  designOnly: boolean,
): { stage: string; removedNodes: string[] } {
  const graphDir = graphDirOf(rootDir);
  const snapshotDir = snapPath(graphDir, id);
  const stage = fs.mkdtempSync(path.join(graphDir, ROLLBACK_STAGE_PREFIX));
  assertContainedPath(graphDir, stage, "回滚 staging");
  assertDirectory(stage, "回滚 staging");
  try {
    ensureDirectory(path.join(stage, "nodes"), "回滚 nodes staging");
    ensureDirectory(path.join(stage, "edges"), "回滚 edges staging");

    const snapshotNodeFiles = new Set(
      snapshot.files
        .filter((entry) => entry.file.startsWith("nodes/"))
        .map((entry) => entry.file.slice("nodes/".length)),
    );
    const currentNodeFiles = designOnly ? activeFileNames(graphDir, "nodes") : [];
    const removedNodes = designOnly
      ? currentNodeFiles
          .filter((name) => !snapshotNodeFiles.has(name))
          .map((name) => name.slice(0, -".yaml".length))
          .sort()
      : [];

    for (const entry of snapshot.files) {
      if (designOnly && entry.file.startsWith("nodes/")) {
        copyOrMergeDesignNode(rootDir, id, snapshotDir, stage, graphDir, entry);
      } else {
        copySnapshotEntry(rootDir, id, snapshotDir, stage, entry);
      }
    }
    // 软删除归档不是当前真相源，不进入 manifest；交换目录时显式复制，避免回滚丢审计历史。
    copyArchivedFiles(graphDir, stage, "nodes");
    copyArchivedFiles(graphDir, stage, "edges");

    validateSnapshotFilesAtDir(rootDir, id, stage, snapshot, { checkHashes: false });
    return { stage, removedNodes };
  } catch (err) {
    removeTemporaryDirectory(stage, graphDir, "回滚 staging");
    throw err;
  }
}

interface SwapRecord {
  component: RollbackComponent;
  current: string;
  staged: string;
  backup: string;
  originalMoved: boolean;
  stagedInstalled: boolean;
}

function assertRollbackComponent(
  graphDir: string,
  component: RollbackComponent,
  file: string,
): void {
  assertContainedPath(graphDir, file, `回滚 ${component}`);
  if (component === "graph.yaml") assertRegularFile(file, "当前 graph.yaml");
  else assertDirectory(file, `当前 ${component}`);
}

/**
 * 在图锁内做可恢复的多组件交换。目录布局无法用一次 rename 同时替换三项，
 * 因此每次 rename 都有记录；任一切换失败即反向撤销，失败恢复不了时保留 backup。
 */
function swapRollbackStage(graphDir: string, stage: string): void {
  assertContainedPath(graphDir, stage, "回滚 staging");
  const transactionBackup = fs.mkdtempSync(path.join(graphDir, ROLLBACK_BACKUP_PREFIX));
  assertContainedPath(graphDir, transactionBackup, "回滚事务备份");
  assertDirectory(transactionBackup, "回滚事务备份");

  const records: SwapRecord[] = ROLLBACK_COMPONENTS.map((component) => ({
    component,
    current: path.join(graphDir, component),
    staged: path.join(stage, component),
    backup: path.join(transactionBackup, component),
    originalMoved: false,
    stagedInstalled: false,
  }));

  try {
    for (const record of records) {
      assertContainedPath(graphDir, record.current, `回滚 ${record.component}`);
      assertContainedPath(stage, record.staged, `回滚 ${record.component} staging`);
      assertContainedPath(transactionBackup, record.backup, `回滚 ${record.component} 备份`);
      assertRollbackComponent(stage, record.component, record.staged);
      if (pathExists(record.current)) {
        assertRollbackComponent(graphDir, record.component, record.current);
        fs.renameSync(record.current, record.backup);
        record.originalMoved = true;
      }
      fs.renameSync(record.staged, record.current);
      record.stagedInstalled = true;
    }
    removeTemporaryDirectory(stage, graphDir, "回滚 staging");
    removeTemporaryDirectory(transactionBackup, graphDir, "回滚事务备份");
  } catch (err: any) {
    let recoveryError: unknown;
    for (const record of [...records].reverse()) {
      try {
        if (record.stagedInstalled && pathExists(record.current)) {
          const stat = fs.lstatSync(record.current);
          if (stat.isSymbolicLink()) fs.unlinkSync(record.current);
          else fs.rmSync(record.current, { recursive: stat.isDirectory(), force: true });
        }
        if (record.originalMoved && pathExists(record.backup)) {
          fs.renameSync(record.backup, record.current);
        }
      } catch (restoreErr) {
        recoveryError = restoreErr;
        break;
      }
    }

    if (recoveryError !== undefined) {
      throw new Error(
        `回滚原子切换失败，原工作区备份已保留于 ${transactionBackup}，staging=${stage}；原错误: ${err?.message ?? String(err)}；恢复错误: ${String(recoveryError)}`,
      );
    }
    removeTemporaryDirectory(stage, graphDir, "回滚 staging");
    removeTemporaryDirectory(transactionBackup, graphDir, "回滚事务备份");
    throw err;
  }
}

function rollbackToSnapshotUnlocked(
  rootDir: string,
  id: string,
  opts: { designOnly?: boolean; actor?: string } = {},
): { restored: SnapshotManifest; backup: SnapshotManifest } {
  const snap = loadSnapshot(rootDir, id);
  const graphDir = graphDirOf(rootDir);
  const prepared = prepareRollbackStage(rootDir, id, snap, !!opts.designOnly);

  let backup: SnapshotManifest;
  try {
    // 备份在 staging 完整校验之后、原子交换之前创建；失败不会触碰工作区。
    backup = createSnapshotUnlocked(
      graphDir,
      `pre-rollback-to-${id}`,
      { actor: opts.actor },
    );
  } catch (err) {
    removeTemporaryDirectory(prepared.stage, graphDir, "回滚 staging");
    throw err;
  }

  try {
    swapRollbackStage(graphDir, prepared.stage);
  } catch (err) {
    // swapRollbackStage 在恢复成功时已清理；若恢复失败则错误中保留了恢复路径。
    removeTemporaryDirectory(prepared.stage, graphDir, "回滚 staging");
    throw err;
  }

  appendEvent(rootDir, {
    actor: opts.actor ?? "unknown",
    kind: "rollback",
    detail:
      `restored=${id} backup=${backup.id}` +
      (opts.designOnly
        ? ` design_only=true${prepared.removedNodes.length > 0 ? ` removed=[${prepared.removedNodes.join(",")}]` : ""}`
        : ""),
  });
  return { restored: snap, backup };
}
