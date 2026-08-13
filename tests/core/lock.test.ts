// tests/core/lock.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withLock, withLockSync, LockTimeoutError } from "../../src/core/lock.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-lock-"));
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

describe("core/lock", () => {
  it("withLockSync 正常执行并释放锁", () => {
    let ran = false;
    const out = withLockSync(tmpDir, "a", () => {
      ran = true;
      return 42;
    });
    expect(ran).toBe(true);
    expect(out).toBe(42);
    // 锁已释放：再次获取立即成功
    expect(() => withLockSync(tmpDir, "a", () => {})).not.toThrow();
  });

  it("同进程重入 → LockTimeoutError", () => {
    expect(() =>
      withLockSync(
        tmpDir,
        "a",
        () => {
          withLockSync(tmpDir, "a", () => {}, { timeoutMs: 150 });
        },
        { timeoutMs: 500 },
      ),
    ).toThrowError(LockTimeoutError);
  });

  it("陈锁（时间戳过旧）被回收后成功获取", () => {
    writeFakeLock("a", process.pid, Date.now() - 60_000);
    let ran = false;
    withLockSync(tmpDir, "a", () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("死进程锁（pid 不存在）被回收", () => {
    writeFakeLock("a", 2147483647, Date.now()); // 几乎不可能存在的 pid → ESRCH
    let ran = false;
    withLockSync(tmpDir, "a", () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("async withLock 互斥：顺序执行", async () => {
    const order: string[] = [];
    await Promise.all([
      withLock(tmpDir, "a", async () => {
        order.push("1-in");
        await new Promise((r) => setTimeout(r, 30));
        order.push("1-out");
      }),
      withLock(tmpDir, "a", async () => {
        order.push("2-in");
        order.push("2-out");
      }),
    ]);
    expect(order).toEqual(["1-in", "1-out", "2-in", "2-out"]);
  });

  it("不同 id 的锁互不影响", async () => {
    const order: string[] = [];
    await Promise.all([
      withLock(tmpDir, "a", async () => {
        order.push("a-in");
        await new Promise((r) => setTimeout(r, 20));
        order.push("a-out");
      }),
      withLock(tmpDir, "b", async () => {
        order.push("b-in");
        order.push("b-out");
      }),
    ]);
    // b 不应被 a 阻塞
    expect(order.indexOf("b-in")).toBeLessThan(order.indexOf("a-out"));
  });

  it("锁内异常仍释放锁", () => {
    expect(() =>
      withLockSync(tmpDir, "a", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(() => withLockSync(tmpDir, "a", () => {})).not.toThrow();
  });
});
