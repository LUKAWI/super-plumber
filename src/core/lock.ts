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

// S3-16（f16）：陈锁判定的两类已知风险窗口（本实现不消除，明确标注 + 防误判策略）：
//
// 窗口一（pid 复用误判活）：持锁进程死亡后，其 pid 被 OS 复用给无关进程 →
//   process.kill(pid, 0) 探测成功 → isStale 误判"持有者还活着"，陈锁不被立即回收，
//   死锁恢复被拖到时间戳兜底（LOCK_STALE_MS = 30s）才完成。
//   缓解：kill 探测成功时本实现不直接 return false，而是继续走时间戳兜底——
//   死锁最多卡 30s，不会永久化。
//
// 窗口二（临界区 > 30s 被强收）：持锁进程活着但临界区耗时超过 LOCK_STALE_MS →
//   时间戳兜底判旧 → 等待方回收并重抢锁 → 两个进程同时进入临界区，互斥被打破。
//   缓解：调用方保证临界区远小于 30s（常规图复制/写入均为毫秒级；大图快照撞上
//   写方 3s 默认超时会先收到可读的 LockTimeoutError，见 snapshot.ts FIX-E1 注释）。
//   若确有超长临界区需求，应通过 opts.timeoutMs 与本常量联动调大，而非依赖现状。
//
// 根治方案（未实现，跨平台成本高，此处留方案说明）：锁文件除 pid 外记录持有进程
// 的"出生时间戳"，探测时校验 pid 存活 && 该 pid 的出生时间与锁内记录一致
// （不一致 = pid 已被复用 → 大胆判死，窗口一消失；判活不再依赖纯时间戳，
// 窗口二同步收敛）。Node 无可移植的进程出生时间 API（无 process.hrtimebirth）：
// Linux 读 /proc/<pid>/stat 字段 22、Windows 走 WMI/性能计数器、macOS 走
// sysctl proc_pidinfo——三平台三套实现，收益（30s 级最坏延迟的消除）暂不抵复杂度。
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
