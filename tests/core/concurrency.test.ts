// tests/core/concurrency.test.ts
// 原子认领回归：N 个进程并发 claim 同一 ready 节点 → 恰好一个成功。
// 依赖 dist 构建产物（tests/fixtures/claim-worker.mjs），CI 先 npm run build。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  createNode,
  updateNodeStatus,
  getNode,
} from "../../src/core/node.js";
import { NodeType, NodeStatus } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-conc-"));
  createNode(tmpDir, { id: "n1", type: NodeType.Task, label: "N1" });
  // 前置条件：节点就绪
  updateNodeStatus(tmpDir, "n1", NodeStatus.Ready);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runWorker(claimBy: string): Promise<{ out: string; code: number }> {
  const worker = path.resolve("tests/fixtures/claim-worker.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [worker, tmpDir, "n1", claimBy],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ out: out.trim(), code: code ?? -1 }));
  });
}

describe("concurrent claim (atomicity)", () => {
  it("5 个进程并发 claim 同一 ready 节点 → 恰好一个成功", async () => {
    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => runWorker(`agent-${i}`)),
    );
    const oks = results.filter((r) => r.out.startsWith("OK"));
    expect(oks).toHaveLength(1);

    const winner = oks[0].out.split(" ")[1];
    expect(winner).toMatch(/^agent-\d$/);

    // 失败方必须收到可读的"已被认领"错误（而非静默覆盖）
    for (const r of results.filter((x) => x.out.startsWith("ERR"))) {
      expect(r.out).toContain("already claimed");
    }

    // 最终落盘状态与唯一赢家一致
    const final = getNode(tmpDir, "n1");
    expect(final.status).toBe("running");
    expect(final.assigned_to).toBe(winner);
  }, 30_000);

  it("同一认领者重复 claim 幂等成功", async () => {
    const first = await runWorker("agent-solo");
    expect(first.out.startsWith("OK")).toBe(true);
    const second = await runWorker("agent-solo");
    expect(second.out.startsWith("OK")).toBe(true);
  }, 30_000);
});
