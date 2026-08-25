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
import { listNodeFileNames, listEdgeFileNames } from "./schema.js";
import { appendEvent } from "./eventlog.js";
import { rebuildGraphRefsLocked, withGraphLock } from "./parser.js";
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

function snapshotsDir(rootDir: string): string {
  return path.join(toGraphDir(rootDir), SNAPSHOTS_DIR);
}

function snapPath(rootDir: string, id: string): string {
  return path.join(snapshotsDir(rootDir), id);
}

function readManifest(rootDir: string, id: string): SnapshotManifest | null {
  const dir = snapPath(rootDir, id);
  // S3-10（f16）：优先 manifest.json；不存在再回落旧名 manifest.yaml（内容同为 JSON）
  for (const name of [MANIFEST, LEGACY_MANIFEST]) {
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) continue;
    try {
      return JSON.parse(fs.readFileSync(f, "utf-8")) as SnapshotManifest;
    } catch {
      return null;
    }
  }
  return null;
}

export function listSnapshots(rootDir: string): SnapshotManifest[] {
  const dir = snapshotsDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => readManifest(rootDir, e.name))
    .filter((m): m is SnapshotManifest => m !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function hashFile(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** 收集当前 .graph/ 下全部真相源文件（相对 .graph/ 的路径） */
function collectSourceFiles(rootDir: string): string[] {
  const files: string[] = ["graph.yaml"];
  for (const f of listNodeFileNames(rootDir)) files.push(`nodes/${f}`);
  for (const f of listEdgeFileNames(rootDir)) files.push(`edges/${f}`);
  return files;
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
  opts: { actor?: string } = {},
): SnapshotManifest {
  return withGraphLock(rootDir, () =>
    createSnapshotUnlocked(rootDir, message, opts),
  );
}

function createSnapshotUnlocked(
  rootDir: string,
  message?: string,
  opts: { actor?: string } = {},
): SnapshotManifest {
  const now = new Date();
  const id = `${now.toISOString().replace(/[:.]/g, "-")}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const target = snapPath(rootDir, id);
  fs.mkdirSync(target, { recursive: true });
  const files: SnapshotFileEntry[] = [];
  for (const rel of collectSourceFiles(rootDir)) {
    const src = path.join(toGraphDir(rootDir), rel);
    const dest = path.join(target, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    files.push({ file: rel.replace(/\\/g, "/"), sha256: hashFile(src) });
  }
  const manifest: SnapshotManifest = {
    id,
    created_at: now.toISOString(),
    ...(message ? { message } : {}),
    files,
  };
  fs.writeFileSync(
    path.join(target, MANIFEST),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
  // v0.5.1：快照即设计定稿点——创建快照时自动导出领域文档视图（纯工具行为，无 LLM 决策）：
  // CONTEXT-MAP.md + docs/contexts/*.md + docs/adr/*.md 随快照点落盘，git 一并提交即冻结。
  // 非致命：导出失败不回滚快照（图仍是真相源），失败原因记入事件。
  let docsDetail = "";
  try {
    const docs = runDocsExport(rootDir);
    docsDetail = ` docs_exported=${docs.written.length}`;
  } catch (err: any) {
    docsDetail = ` docs_export_failed=${err?.message ?? "unknown"}`;
  }
  appendEvent(rootDir, {
    actor: opts.actor ?? "unknown",
    kind: "snapshot_created",
    detail: `snapshot=${id}${message ? ` message="${message}"` : ""}${docsDetail}`,
  });
  return manifest;
}

/** 读取某侧（working 或快照）的节点 status：rel 形如 nodes/x.yaml */
function nodeStatusOf(
  rootDir: string,
  fromId: string | null,
  rel: string,
): string | null {
  let file: string;
  if (fromId === null) {
    file = path.join(toGraphDir(rootDir), rel);
  } else {
    file = path.join(snapPath(rootDir, fromId), rel);
  }
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
  if (id !== null) {
    const snap = readManifest(rootDir, id);
    if (!snap) throw new Error(`Snapshot ${id} not found`);
    return snap.files.map((f) => f.file);
  }
  return collectSourceFiles(rootDir);
}

function shaOf(rootDir: string, id: string | null, rel: string): string {
  const file =
    id === null
      ? path.join(toGraphDir(rootDir), rel)
      : path.join(snapPath(rootDir, id), rel);
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

function rollbackToSnapshotUnlocked(
  rootDir: string,
  id: string,
  opts: { designOnly?: boolean; actor?: string } = {},
): { restored: SnapshotManifest; backup: SnapshotManifest } {
  const snap = readManifest(rootDir, id);
  if (!snap) throw new Error(`Snapshot ${id} not found`);

  // 1. 自动备份当前状态（pre-rollback 快照，可再回滚）
  const backup = createSnapshotUnlocked(
    rootDir,
    `pre-rollback-to-${id}`,
    { actor: opts.actor },
  );

  const nodesDir = path.join(toGraphDir(rootDir), "nodes");
  const edgesDir = path.join(toGraphDir(rootDir), "edges");
  const removedByDesignRollback: string[] = [];

  if (!opts.designOnly) {
    // 2. 全量回滚：删除当前源文件（保留 .deleted 历史）
    if (fs.existsSync(nodesDir)) {
      for (const f of listNodeFileNames(rootDir)) {
        fs.rmSync(path.join(nodesDir, f), { force: true });
      }
    }
    if (fs.existsSync(edgesDir)) {
      for (const f of listEdgeFileNames(rootDir)) {
        fs.rmSync(path.join(edgesDir, f), { force: true });
      }
    }

    // 3. 从快照恢复
    for (const entry of snap.files) {
      const src = path.join(snapPath(rootDir, id), entry.file);
      const dest = path.join(toGraphDir(rootDir), entry.file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  } else {
    const snapNodeFiles = new Set(
      snap.files.filter((f) => f.file.startsWith("nodes/")).map((f) => f.file),
    );
    const snapEdgeFiles = new Set(
      snap.files.filter((f) => f.file.startsWith("edges/")).map((f) => f.file),
    );

    // 2a. 快照后新增的节点/边 → 删除（撤销快照之后的设计新增）
    if (fs.existsSync(nodesDir)) {
      for (const f of listNodeFileNames(rootDir)) {
        if (!snapNodeFiles.has(`nodes/${f}`)) {
          fs.rmSync(path.join(nodesDir, f), { force: true });
          removedByDesignRollback.push(f.replace(/\.yaml$/, ""));
        }
      }
    }
    if (fs.existsSync(edgesDir)) {
      for (const f of listEdgeFileNames(rootDir)) {
        if (!snapEdgeFiles.has(`edges/${f}`)) {
          fs.rmSync(path.join(edgesDir, f), { force: true });
        }
      }
    }

    // 2b. graph.yaml 与边文件全量恢复；节点文件字段级合并（保留执行态）
    for (const entry of snap.files) {
      const src = path.join(snapPath(rootDir, id), entry.file);
      const dest = path.join(toGraphDir(rootDir), entry.file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!entry.file.startsWith("nodes/")) {
        fs.copyFileSync(src, dest);
        continue;
      }
      let currentData: unknown = null;
      try {
        currentData = yaml.load(fs.readFileSync(dest, "utf-8"));
      } catch {
        currentData = null; // 当前文件不可读/不存在 → 全量恢复快照版本
      }
      if (currentData === null || currentData === undefined) {
        fs.copyFileSync(src, dest);
        continue;
      }
      const snapData = yaml.load(fs.readFileSync(src, "utf-8"));
      const merged = designOnlyMergeNode(currentData, snapData);
      fs.writeFileSync(
        dest,
        yaml.dump(merged, { indent: 2, lineWidth: 120 }),
        "utf-8",
      );
    }

    // 2c. 节点集合已变（删除新增/无恢复缺失时引用列表可能过期）→ 从目录重建
    //（Locked 变体：rollback 已持图锁，公共入口会重入死锁）
    rebuildGraphRefsLocked(rootDir);
  }

  appendEvent(rootDir, {
    actor: opts.actor ?? "unknown",
    kind: "rollback",
    detail:
      `restored=${id} backup=${backup.id}` +
      (opts.designOnly
        ? ` design_only=true${removedByDesignRollback.length > 0 ? ` removed=[${removedByDesignRollback.join(",")}]` : ""}`
        : ""),
  });
  return { restored: snap, backup };
}
