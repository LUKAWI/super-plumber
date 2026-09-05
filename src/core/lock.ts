// 进程间互斥锁：<图目录>/.locks/<encodedId>.lock（v0.5.2：每图独立锁空间）
// 目的：把“读-改-写”变成临界区——并发 claim / 状态流转 / 内容更新不再互相覆盖。
// 例外：工作区级锁固定落在 .graph/.locks/，不随 active 图变化。
//
// 重要边界：rootDir 可能是工作区根，而 active 文件可能在等待锁期间被另一个
// 进程切换。一次锁操作必须先解析并固定目标图，抢锁、释放锁和临界区内的路径
// 解析都使用同一个目标，否则会出现“锁在 A、写在 B”以及旧锁无法释放的分裂。
import * as fs from "node:fs";
import * as path from "node:path";
import {
  toGraphDir,
  workspaceOf,
  withGraphDirTarget,
  WORKSPACE_MIGRATE_LOCK,
  WORKSPACE_EVENTS_LOCK,
} from "./graph-dir.js";

const LOCK_STALE_MS = 30_000;
// 等待方用较短轮询窗口，避免一个持续写入的进程在 Windows 上连续
// 重新抢到刚释放的锁，把已经等待的删除/引用事务饿死到默认超时。
const LOCK_RETRY_MS = 10;
// 显式 opts.timeoutMs 仍可为确需更长临界区的调用方调整等待上限。
const DEFAULT_TIMEOUT_MS = 3_000;

/** 图级锁 id，供 graph-io 与图生命周期操作共享同一锁命名。 */
export const GRAPH_LOCK = "__graph__";

function isWorkspaceLock(id: string): boolean {
  // 延迟读取这些 graph-dir 导出的常量，避免 graph-dir ↔ lock 的 ESM
  // 循环依赖在模块初始化阶段触发 TDZ。
  return id === WORKSPACE_MIGRATE_LOCK || id === WORKSPACE_EVENTS_LOCK;
}

export class LockTimeoutError extends Error {
  constructor(public readonly lockId: string) {
    super(`Lock timeout for "${lockId}" (held by another process)`);
    this.name = "LockTimeoutError";
  }
}

interface LockTarget {
  graphDir: string;
  file: string;
  reclaimFile: string;
  waiterFile: string;
}

interface LockLease {
  raw: string;
  token: string;
}

interface LockObservation {
  raw: string;
  stale: boolean;
}

let tempCounter = 0;
let tokenCounter = 0;

function lockTarget(rootDir: string, id: string): LockTarget {
  // 目标图只在这里解析一次。workspace lock 的文件位置固定在工作区根，
  // 但仍记录当时的 graphDir，供临界区路径解析保持一致。
  const graphDir = path.resolve(toGraphDir(rootDir));
  const lockDir = isWorkspaceLock(id)
    ? path.join(path.resolve(workspaceOf(rootDir)), ".graph", ".locks")
    : path.join(graphDir, ".locks");
  const file = path.join(lockDir, `${encodeURIComponent(id)}.lock`);
  return {
    graphDir,
    file,
    reclaimFile: `${file}.reclaim`,
    waiterFile: `${file}.wait`,
  };
}

function nextToken(prefix: string): string {
  tokenCounter++;
  return `${prefix}-${process.pid}-${Date.now()}-${tokenCounter}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function recordRaw(token: string): string {
  return JSON.stringify({ pid: process.pid, at: Date.now(), token });
}

/**
 * 以临时文件 + hard-link 发布完整锁记录。
 *
 * open("wx") 后再写正文会暴露一个“空锁文件”窗口，stale 扫描可能把正在
 * 初始化的锁当成损坏锁删掉。先完整写临时文件，再用同卷 link 的原子存在性
 * 竞争，令锁路径从一开始就是完整记录；NTFS 与常见 Unix 文件系统都支持该
 * 同目录 hard-link 操作。
 */
function createExclusiveRecord(file: string, tokenPrefix: string): LockLease | null {
  const token = nextToken(tokenPrefix);
  const raw = recordRaw(token);
  const dir = path.dirname(file);
  const temp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${++tempCounter}.tmp`,
  );
  try {
    fs.writeFileSync(temp, raw, "utf-8");
    try {
      fs.linkSync(temp, file);
    } catch (err: any) {
      if (err?.code === "EEXIST") return null;
      throw err;
    }
    return { raw, token };
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {
      /* link 成功后临时硬链接的清理失败不影响锁本身 */
    }
  }
}

function readRaw(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

/** 只在文件正文仍等于观测值时删除，避免旧 owner 释放掉 successor 的锁。 */
function removeIfCurrent(file: string, expectedRaw: string): boolean {
  try {
    if (fs.readFileSync(file, "utf-8") !== expectedRaw) return false;
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * 陈锁判定：持有进程已死（ESRCH）或时间戳过旧。
 * 无效 JSON/缺少 pid/at 也视为可回收，但实际删除必须再次做正文比对。
 */
function inspect(file: string, now: number): LockObservation | null {
  const raw = readRaw(file);
  if (raw === null) return null;
  let parsed: { pid?: unknown; at?: unknown };
  try {
    parsed = JSON.parse(raw) as { pid?: unknown; at?: unknown };
  } catch {
    return { raw, stale: true };
  }
  const pid = parsed.pid;
  const at = parsed.at;
  if (
    !Number.isInteger(pid) ||
    (pid as number) <= 0 ||
    typeof at !== "number" ||
    !Number.isFinite(at)
  ) {
    return { raw, stale: true };
  }

  try {
    process.kill(pid as number, 0);
  } catch (err: any) {
    if (err?.code === "ESRCH") return { raw, stale: true };
    // EPERM means the process exists; other platform errors fall through to
    // the timestamp fallback rather than making a destructive guess.
    if (err?.code !== "EPERM") {
      return { raw, stale: now - (at as number) > LOCK_STALE_MS };
    }
  }
  return { raw, stale: now - (at as number) > LOCK_STALE_MS };
}

function acquireReclaimGate(target: LockTarget): LockLease | null {
  clearStaleReclaimGate(target);
  return createExclusiveRecord(target.reclaimFile, "gate");
}

function releaseReclaimGate(target: LockTarget, gate: LockLease): void {
  removeIfCurrent(target.reclaimFile, gate.raw);
}

/**
 * Register one waiting owner as the next lock holder.
 *
 * A plain retry loop is not fair on Windows: a hot writer can release and
 * recreate the owner file before a blocked deleter wakes up, repeatedly.  The
 * waiter file is a single-slot handoff reservation.  Its pid/timestamp use the
 * same stale-recovery rules as the owner, and the reservation is removed by
 * the winner or by the waiting call's finally block.
 */
function registerWaiter(target: LockTarget): LockLease | null {
  const current = inspect(target.waiterFile, Date.now());
  if (current !== null) {
    if (current.stale) {
      removeIfCurrent(target.waiterFile, current.raw);
    } else {
      return null;
    }
  }
  return createExclusiveRecord(target.waiterFile, "waiter");
}

function releaseWaiter(target: LockTarget, waiter: LockLease | null): void {
  if (waiter !== null) removeIfCurrent(target.waiterFile, waiter.raw);
}

function hasOtherWaiter(target: LockTarget, waiter: LockLease | null): boolean {
  const current = inspect(target.waiterFile, Date.now());
  if (current === null) return false;
  if (current.stale) {
    removeIfCurrent(target.waiterFile, current.raw);
    return false;
  }
  return waiter === null || current.raw !== waiter.raw;
}

function releaseFile(target: LockTarget, lease: LockLease): void {
  // 正文比对本身不是跨平台 CAS；释放也要先取得同一个 reclaimer 闸门，
  // 令“旧 owner 读到旧正文 → reclaimer 换 owner → 旧 owner unlink”这条
  // TOCTOU 链不能发生。拿不到闸门时宁可留下可回收锁，也绝不越权删除。
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  for (;;) {
    const gate = acquireReclaimGate(target);
    if (gate !== null) {
      try {
        removeIfCurrent(target.file, lease.raw);
      } finally {
        releaseReclaimGate(target, gate);
      }
      return;
    }
    if (Date.now() >= deadline) return;
    sleepSync(LOCK_RETRY_MS);
  }
}

function clearStaleReclaimGate(target: LockTarget): void {
  const gate = inspect(target.reclaimFile, Date.now());
  if (gate?.stale) removeIfCurrent(target.reclaimFile, gate.raw);
}

/** 回收时先占一个闸门；新 owner 看到闸门会等待，避免回收与抢锁互相踩踏。 */
function reclaimStale(target: LockTarget, observation: LockObservation): boolean {
  const gate = acquireReclaimGate(target);
  if (gate === null) return false;
  try {
    // 闸门建立后重新读取并比对；若期间已有 successor，绝不删除它。
    const current = readRaw(target.file);
    if (current !== observation.raw) return false;
    return removeIfCurrent(target.file, observation.raw);
  } finally {
    releaseReclaimGate(target, gate);
  }
}

function acquire(target: LockTarget, waiter: LockLease | null): LockLease | null {
  // 上一个 reclaimer 进程若中断，遗留闸门也必须可按同一 stale 规则自愈。
  if (readRaw(target.reclaimFile) !== null) {
    clearStaleReclaimGate(target);
    if (readRaw(target.reclaimFile) !== null) return null;
  }
  // 若另一个进程已登记下一位，当前进程不能在 owner 消失的窗口里插队。
  if (hasOtherWaiter(target, waiter)) return null;
  const lease = createExclusiveRecord(target.file, "owner");
  if (lease === null) return null;
  // 闸门可能在 link 成功后才建立。发现闸门时不进入临界区，释放自己的
  // lease 并重试；即便 reclaimer 已删掉该路径，release 也因正文不匹配而安全。
  if (readRaw(target.reclaimFile) !== null) {
    releaseFile(target, lease);
    return null;
  }
  if (waiter !== null) removeIfCurrent(target.waiterFile, waiter.raw);
  return lease;
}

export async function withLock<T>(
  rootDir: string,
  id: string,
  fn: () => Promise<T> | T,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const target = lockTarget(rootDir, id);
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let waiter: LockLease | null = null;
  try {
    for (;;) {
      const lease = acquire(target, waiter);
      if (lease !== null) {
        try {
          return await withGraphDirTarget(rootDir, target.graphDir, fn);
        } finally {
          releaseFile(target, lease);
        }
      }
      if (Date.now() >= deadline) throw new LockTimeoutError(id);
      const observation = inspect(target.file, Date.now());
      if (observation?.stale) {
        reclaimStale(target, observation);
        continue;
      }
      if (waiter === null) waiter = registerWaiter(target);
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  } finally {
    releaseWaiter(target, waiter);
  }
}

export function withLockSync<T>(
  rootDir: string,
  id: string,
  fn: () => T,
  opts: { timeoutMs?: number } = {},
): T {
  const target = lockTarget(rootDir, id);
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let waiter: LockLease | null = null;
  try {
    for (;;) {
      const lease = acquire(target, waiter);
      if (lease !== null) {
        try {
          return withGraphDirTarget(rootDir, target.graphDir, fn);
        } finally {
          releaseFile(target, lease);
        }
      }
      if (Date.now() >= deadline) throw new LockTimeoutError(id);
      const observation = inspect(target.file, Date.now());
      if (observation?.stale) {
        reclaimStale(target, observation);
        continue;
      }
      if (waiter === null) waiter = registerWaiter(target);
      sleepSync(LOCK_RETRY_MS);
    }
  } finally {
    releaseWaiter(target, waiter);
  }
}

/**
 * 按稳定排序取得多把同图实体锁。所有调用方使用同一顺序，避免跨实体
 * 操作形成锁环；空集合不改变调用语义。
 */
export function withLocksSync<T>(
  rootDir: string,
  ids: string[],
  fn: () => T,
  opts: { timeoutMs?: number } = {},
): T {
  const unique = [...new Set(ids)].sort();
  const enter = (index: number): T => {
    if (index >= unique.length) return fn();
    return withLockSync(rootDir, unique[index], () => enter(index + 1), opts);
  };
  return enter(0);
}

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}
