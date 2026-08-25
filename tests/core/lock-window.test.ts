// tests/core/lock-window.test.ts — S3-16（f16）：陈锁回收在持锁者死亡时正确工作
// 与 lock.test.ts 的差异：不用"几乎不可能存在的 2147483647 pid"，而是真实
// spawn 一个短命子进程、等它退出、用它的真实 pid 写锁——这是"持有者死亡"的
// 忠实模拟（走 ESRCH 通道而非 30s 时间戳兜底，即 pid 探测真正起作用的路径）。
// 同时对照断言：活着的持有者 + 新鲜时间戳不会被回收（互斥保持，见 lock.ts
// S3-16 注释的两类风险窗口）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  withLockSync,
  LockTimeoutError,
} from "../../src/core/lock.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-lockwin-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFakeLock(id: string, pid: number, at: number) {
  const dir = path.join(tmpDir, ".graph", ".locks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${encodeURIComponent(id)}.lock`),
    JSON.stringify({ pid, at }),
  );
}

describe("S3-16 陈锁回收：持有者死亡 vs 持有者存活", () => {
  it("真实死亡进程（已退出的子进程 pid）+ 新鲜时间戳 → ESRCH 通道立即回收", () => {
    // spawnSync 返回时子进程必已退出 → 其 pid 是"曾经的持有者"，现已死亡
    const child = spawnSync(process.execPath, ["-e", "0"]);
    expect(child.status).toBe(0);
    expect(child.pid).toBeTruthy();
    // 时间戳取当前：证明回收走的是 pid 探测（ESRCH），而非 30s 时间戳兜底
    writeFakeLock("dead-holder", child.pid!, Date.now());

    let ran = false;
    withLockSync(tmpDir, "dead-holder", () => {
      ran = true;
    });
    expect(ran).toBe(true); // 无需等 30s，也无 LockTimeoutError
  });

  it("活着的持有者 + 新鲜时间戳 → 不被回收，等待方超时报错（互斥保持）", () => {
    // 持有者 = 本进程（确定存活），时间戳新鲜 → 任何通道都不应判陈
    writeFakeLock("live-holder", process.pid, Date.now());
    expect(() =>
      withLockSync(tmpDir, "live-holder", () => {}, { timeoutMs: 200 }),
    ).toThrowError(LockTimeoutError);
  });
});
