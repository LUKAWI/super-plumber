// src/core/lock.ts
// 进程间互斥锁：<图目录>/.locks/<encodedId>.lock（v0.5.2：每图独立锁空间）
// 目的：把"读-改-写"变成临界区——并发 claim / 状态流转 / 内容更新不再互相覆盖。
// 设计：O_EXCL 原子创建 + pid/时间戳 + 陈锁回收（持有进程死亡或超时）+ 有限重试。
// 例外：__ws_migrate__ 是工作区级锁（迁移影响所有图），固定落在 .graph/.locks/。
import * as fs from "node:fs";
import * as path from "node:path";
import { toGraphDir, workspaceOf, WORKSPACE_MIGRATE_LOCK } from "./graph-dir.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;
const DEFAULT_TIMEOUT_MS = 3_000;

export class LockTimeoutError extends Error {
  constructor(public readonly lockId: string) {
    super(`Lock timeout for "${lockId}" (held by another process)`);
    this.name = "LockTimeoutError";
  }
}

function lockDir(rootDir: string, id: string): string {
  if (id === WORKSPACE_MIGRATE_LOCK) {
    // 工作区级锁：不随 active 图走（否则并发解析不同图会锁到不同文件，失去互斥）
    return path.join(workspaceOf(rootDir), ".graph", ".locks");
  }
  return path.join(toGraphDir(rootDir), ".locks");
}

function lockFile(rootDir: string, id: string): string {
  // 节点 id 理论上可含路径分隔符，编码防止逃逸出 .locks/
  return path.join(lockDir(rootDir, id), `${encodeURIComponent(id)}.lock`);
}

/** 陈锁判定：持有进程已死（ESRCH）或时间戳过旧 */
function isStale(file: string, now: number): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      pid: number;
      at: number;
    };
    if (Number.isInteger(parsed.pid) && parsed.pid > 0) {
      try {
        process.kill(parsed.pid, 0);
      } catch (err: any) {
        if (err?.code === "ESRCH") return true; // 持有进程已死
        if (err?.code === "EPERM") return false; // 进程活着（无权限探测）
      }
    }
    return now - (parsed.at ?? 0) > LOCK_STALE_MS;
  } catch {
    return true; // 内容不可读视为陈锁
  }
}

function acquire(rootDir: string, id: string): boolean {
  const file = lockFile(rootDir, id);
  try {
    const fd = fs.openSync(file, "wx"); // 原子性：仅当文件不存在时成功
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
    fs.closeSync(fd);
    return true;
  } catch (err: any) {
    if (err?.code !== "EEXIST") throw err;
    return false;
  }
}

function release(rootDir: string, id: string): void {
  try {
    fs.unlinkSync(lockFile(rootDir, id));
  } catch {
    /* 已被陈锁回收逻辑移除：忽略 */
  }
}

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

export async function withLock<T>(
  rootDir: string,
  id: string,
  fn: () => Promise<T> | T,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  fs.mkdirSync(lockDir(rootDir, id), { recursive: true });
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (acquire(rootDir, id)) {
      try {
        return await fn();
      } finally {
        release(rootDir, id);
      }
    }
    if (isStale(lockFile(rootDir, id), Date.now())) {
      release(rootDir, id); // 回收陈锁后立即重试抢锁
      continue;
    }
    if (Date.now() >= deadline) throw new LockTimeoutError(id);
    await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
  }
}

export function withLockSync<T>(
  rootDir: string,
  id: string,
  fn: () => T,
  opts: { timeoutMs?: number } = {},
): T {
  fs.mkdirSync(lockDir(rootDir, id), { recursive: true });
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (acquire(rootDir, id)) {
      try {
        return fn();
      } finally {
        release(rootDir, id);
      }
    }
    if (isStale(lockFile(rootDir, id), Date.now())) {
      release(rootDir, id);
      continue;
    }
    if (Date.now() >= deadline) throw new LockTimeoutError(id);
    sleepSync(LOCK_RETRY_MS);
  }
}
