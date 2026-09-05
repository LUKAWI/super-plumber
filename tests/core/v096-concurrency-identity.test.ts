import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { NodeStatus, NodeType, EdgeType, type NodeSchema } from "../../src/core/types.js";
import { createGraph, listGraphNames, writeWorkspaceDefault } from "../../src/core/graph-dir.js";
import { createNode, getNode } from "../../src/core/node.js";
import { createEdge, listEdges } from "../../src/core/edge.js";
import {
  readEdge,
  readGraph,
  readNode,
  writeEdge,
  writeGraph,
  writeNode,
} from "../../src/core/graph-io.js";
import { withLock, withLockSync } from "../../src/core/lock.js";
import { deleteNode } from "../../src/core/parser.js";

const WORKER = path.resolve("tests/fixtures/v096-concurrency-worker.mjs");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-v096-identity-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runWorker(mode: string, ...args: string[]): Promise<{ out: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, mode, tmpDir, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (data) => (out += data));
    child.stderr.on("data", (data) => (out += data));
    child.on("error", reject);
    child.on("close", (code) => resolve({ out: out.trim(), code: code ?? -1 }));
  });
}

async function waitForFile(file: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`worker signal timeout: ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function node(id: string, label = id): NodeSchema {
  const now = new Date().toISOString();
  return {
    id,
    type: NodeType.Task,
    label,
    level: 1,
    status: NodeStatus.Pending,
    attempts: 0,
    max_attempts: 3,
    created_at: now,
    updated_at: now,
  };
}

describe("v0.9.6 graph identity and cross-entity concurrency", () => {
  it("拒绝文件名、正文 id、graph.yaml 引用不一致，且不改写 graph.yaml", () => {
    const graphDir = createGraph(tmpDir, "identity", "身份图");
    createNode(graphDir, { id: "n1", type: NodeType.Task, label: "N1" });
    const nodeFile = path.join(graphDir, "nodes", "n1.yaml");
    const aliasFile = path.join(graphDir, "nodes", "alias.yaml");
    fs.renameSync(nodeFile, aliasFile);

    expect(() => readNode(graphDir, "alias")).toThrow(/身份不一致/);
    const beforeRaw = fs.readFileSync(aliasFile, "utf-8");
    expect(() => writeNode(graphDir, node("alias", "不应覆盖"))).toThrow(/身份不一致/);
    expect(fs.readFileSync(aliasFile, "utf-8")).toBe(beforeRaw);
    const before = readGraph(graphDir);
    expect(() =>
      writeGraph(graphDir, { ...before, nodes: [{ file: "nodes/alias.yaml" }] }),
    ).toThrow(/身份不一致/);
    expect(readGraph(graphDir).nodes).toEqual(before.nodes);
  });

  it("边文件也绑定内部 id，拒绝错名实体被 graph.yaml 接纳", () => {
    const graphDir = createGraph(tmpDir, "edge-identity", "边身份图");
    createNode(graphDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(graphDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(graphDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    fs.renameSync(
      path.join(graphDir, "edges", "e1.yaml"),
      path.join(graphDir, "edges", "alias.yaml"),
    );

    expect(() => readEdge(graphDir, "alias")).toThrow(/身份不一致/);
    const beforeRaw = fs.readFileSync(path.join(graphDir, "edges", "alias.yaml"), "utf-8");
    expect(() =>
      writeEdge(graphDir, { id: "alias", source: "a", target: "b", type: EdgeType.DependsOn }),
    ).toThrow(/身份不一致/);
    expect(fs.readFileSync(path.join(graphDir, "edges", "alias.yaml"), "utf-8")).toBe(beforeRaw);
    const before = readGraph(graphDir);
    expect(() =>
      writeGraph(graphDir, { ...before, edges: [{ file: "edges/alias.yaml" }] }),
    ).toThrow(/身份不一致/);
    expect(readGraph(graphDir).edges).toEqual(before.edges);
  });

  it("同名图跨 Windows 子进程至多原子创建一个，失败方不留下 staging", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => runWorker("graph", "same-name", "同名图")),
    );
    expect(results.filter((r) => r.out.startsWith("OK"))).toHaveLength(1);
    expect(results.filter((r) => r.out.startsWith("ERR"))).toHaveLength(5);
    expect(results.every((r) => r.code === 0)).toBe(true);
    expect(listGraphNames(tmpDir)).toEqual(["same-name"]);
    expect(
      fs.readdirSync(path.join(tmpDir, ".graph")).some((name) => name.includes(".creating-")),
    ).toBe(false);
    expect(readGraph(path.join(tmpDir, ".graph", "same-name")).nodes).toEqual([]);
  }, 30_000);

  it("锁目标固定后 active 切换不会把同一临界区的写入送到另一张图", () => {
    const graphA = createGraph(tmpDir, "graph-a", "A");
    const graphB = createGraph(tmpDir, "graph-b", "B");
    writeWorkspaceDefault(tmpDir, "graph-a");

    withLockSync(tmpDir, "identity-switch", () => {
      writeWorkspaceDefault(tmpDir, "graph-b");
      createNode(tmpDir, { id: "fixed-target", type: NodeType.Task, label: "写入 A" });
    });

    expect(getNode(graphA, "fixed-target").label).toBe("写入 A");
    expect(() => getNode(graphB, "fixed-target")).toThrow(/not found/);
  });

  it("异步锁跨 await 仍固定图目标，切换 active 后继续写入原图", async () => {
    const graphA = createGraph(tmpDir, "async-a", "异步 A");
    const graphB = createGraph(tmpDir, "async-b", "异步 B");
    writeWorkspaceDefault(tmpDir, "async-a");

    await withLock(tmpDir, "async-switch", async () => {
      writeWorkspaceDefault(tmpDir, "async-b");
      await new Promise((resolve) => setTimeout(resolve, 5));
      createNode(tmpDir, { id: "async-fixed", type: NodeType.Task, label: "仍写入 A" });
    });

    expect(getNode(graphA, "async-fixed").label).toBe("仍写入 A");
    expect(() => getNode(graphB, "async-fixed")).toThrow(/not found/);
  });

  it("节点级锁与端点锁协调删除/建边，删除后不遗留幽灵边", async () => {
    const graphDir = createGraph(tmpDir, "race", "竞态图");
    writeWorkspaceDefault(tmpDir, "race");
    createNode(graphDir, { id: "race-a", type: NodeType.Task, label: "A" });
    createNode(graphDir, { id: "race-b", type: NodeType.Task, label: "B" });
    const signal = path.join(tmpDir, "edge-race.started");
    const worker = runWorker("edge-race", "race-a", "race-b", signal, "24");
    await waitForFile(signal);

    // 无论删除方断言/锁等待如何结束，都先收口 worker；否则失败路径会
    // 让子进程继续持有 .locks 下的文件，Windows 的 afterEach rmSync 会
    // 被 ENOTEMPTY/EPERM 覆盖掉真正的并发失败。
    let result: { out: string; code: number };
    try {
      deleteNode(tmpDir, "race-a", { cascade: true });
    } finally {
      result = await worker;
    }
    expect(result.out).toMatch(/^OK edges=\d+$/);
    expect(fs.existsSync(path.join(graphDir, "nodes", "race-a.yaml"))).toBe(false);
    expect(listEdges(graphDir)).toEqual([]);
    expect(readGraph(graphDir).edges).toEqual([]);
  }, 30_000);

  it("旧 owner 释放时不删除 token 已被替换的 successor 锁", async () => {
    const graphDir = createGraph(tmpDir, "stale", "陈锁图");
    const signal = path.join(tmpDir, "lock-held");
    const worker = runWorker("hold-lock", "successor-check", signal, "700");
    await waitForFile(signal);
    const lockFile = fs.readFileSync(signal, "utf-8");
    const successor = JSON.stringify({ pid: process.pid, at: Date.now(), token: "successor-token" });
    fs.writeFileSync(lockFile, successor, "utf-8");

    const result = await worker;
    expect(result.out).toBe("OK lock");
    expect(fs.readFileSync(lockFile, "utf-8")).toBe(successor);
    fs.rmSync(lockFile, { force: true });
    expect(graphDir).toContain(path.join(".graph", "stale"));
  }, 30_000);
});
