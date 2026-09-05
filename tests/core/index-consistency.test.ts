// tests/core/index-consistency.test.ts — 0.9.6 index 代际/原子发布回归
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";
import { buildGraphIndex, persistGraphIndex, resetIndexCache } from "../../src/core/index-service.js";
import { createNode } from "../../src/core/node.js";
import { readNode, writeGraph, writeNode } from "../../src/core/parser.js";
import { NodeStatus, NodeType, type NodeSchema } from "../../src/core/types.js";

let tmpDir: string;
const CLI = path.resolve("dist/cli/index.js");
const INDEX_SERVICE = path.resolve("dist/core/index-service.js");
const PERF_NODE_COUNT = 5_000;
const PERF_COLD_MAX_MS = 30_000;
const PERF_HOT_MAX_MS = 1_000;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-index-consistency-"));
  resetIndexCache();
  writeGraph(tmpDir, {
    id: "g1",
    version: "0.2.0",
    label: "index consistency",
    entry: { description: "entry", defined_by: "human", level: 0 },
    exit: { description: "exit", acceptance_criteria: [], defined_by: "human", level: 0 },
    nodes: [],
    edges: [],
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetIndexCache();
});

describe("0.9.6 index generation", () => {
  it("persists a generation and graph/node/edge source stamps", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });

    const index = buildGraphIndex(tmpDir, { useCache: true });
    const cache = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".graph/index/graph.json"), "utf-8"),
    ) as { index_version: number; generation: string; sources: { path: string }[] };

    expect(index.generation).toBe(cache.generation);
    expect(cache.index_version).toBe(2);
    expect(cache.sources.map((source) => source.path)).toEqual(
      expect.arrayContaining(["graph.yaml", "nodes/a.yaml", "nodes", "edges"]),
    );
  });

  it("外部写入即使回拨 mtime 也不会命中旧内存缓存", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "OLD" });
    const first = buildGraphIndex(tmpDir, { useCache: true });
    const nodePath = path.join(tmpDir, ".graph/nodes/a.yaml");
    const original = fs.statSync(nodePath);

    const node = readNode(tmpDir, "a");
    node.label = "NEW";
    // 模拟未调用 invalidateIndex 的外部进程；mtime 恢复到旧值，ctime/文件身份
    // 仍使源代际发生变化，避免把“mtime 不前进”误判为缓存命中。
    fs.writeFileSync(nodePath, yaml.dump(node, { indent: 2, lineWidth: 120 }), "utf-8");
    fs.utimesSync(nodePath, original.atime, original.mtime);

    const current = buildGraphIndex(tmpDir, { useCache: true });
    expect(current).not.toBe(first);
    expect(current.nodes.find((candidate) => candidate.id === "a")?.label).toBe("NEW");
    expect(current.generation).not.toBe(first.generation);
  });

  it("旧代际提交在新代际缓存之后被拒绝且不覆盖新结果", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "OLD" });
    const stale = buildGraphIndex(tmpDir, { useCache: false });
    expect(persistGraphIndex(tmpDir, stale)).toBe(true);

    const currentNode = readNode(tmpDir, "a");
    currentNode.label = "NEW";
    writeNode(tmpDir, currentNode);
    const current = buildGraphIndex(tmpDir, { useCache: false });
    expect(persistGraphIndex(tmpDir, current)).toBe(true);

    // 模拟较慢的旧 rebuild 在较新的 rebuild 之后尝试发布。
    expect(persistGraphIndex(tmpDir, stale)).toBe(false);
    const cachePath = path.join(tmpDir, ".graph/index/graph.json");
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
      generation: string;
      nodes: { id: string; label: string }[];
    };
    expect(cache.generation).toBe(current.generation);
    expect(cache.nodes.find((node) => node.id === "a")?.label).toBe("NEW");
    expect(
      fs.readdirSync(path.dirname(cachePath)).filter((file) => file.includes("graph.json.") && file.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("记录中等规模图的冷/热缓存基线", () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 64; i++) {
      const node: NodeSchema = {
        id: `n${i}`,
        type: NodeType.Task,
        label: `N${i}`,
        level: 1,
        status: NodeStatus.Pending,
        attempts: 0,
        max_attempts: 3,
        created_at: now,
        updated_at: now,
      };
      writeNode(tmpDir, node);
    }

    const coldStart = performance.now();
    const cold = buildGraphIndex(tmpDir, { useCache: true });
    const coldMs = performance.now() - coldStart;
    const hotStart = performance.now();
    const hot = buildGraphIndex(tmpDir, { useCache: true });
    const hotMs = performance.now() - hotStart;
    console.log(`[v096] index cache baseline: cold=${coldMs.toFixed(1)}ms hot=${hotMs.toFixed(1)}ms nodes=${cold.nodes.length}`);

    expect(cold.nodes).toHaveLength(64);
    expect(hot).toBe(cold);
    expect(hotMs).toBeLessThan(1_000);
  });

  it("5k 节点冷/热读基线有界且缓存命中不倒退", () => {
    const nodeDir = path.join(tmpDir, ".graph", "nodes");
    const now = new Date().toISOString();
    // 固定 5,000 个节点、一个临时图、无边：夹具资源有界，不递归生成失控文件数。
    for (let i = 0; i < PERF_NODE_COUNT; i++) {
      const node: NodeSchema = {
        id: `perf-${i}`,
        type: NodeType.Task,
        label: `Perf ${i}`,
        level: 1,
        status: NodeStatus.Pending,
        attempts: 0,
        max_attempts: 3,
        created_at: now,
        updated_at: now,
      };
      fs.writeFileSync(
        path.join(nodeDir, `${node.id}.yaml`),
        yaml.dump(node, { indent: 2, lineWidth: 120 }),
        "utf-8",
      );
    }
    resetIndexCache();

    const coldStart = performance.now();
    const cold = buildGraphIndex(tmpDir, { useCache: true });
    const coldMs = performance.now() - coldStart;
    const hotStart = performance.now();
    const hot = buildGraphIndex(tmpDir, { useCache: true });
    const hotMs = performance.now() - hotStart;
    console.log(
      `[v096] 5k index cache baseline: cold=${coldMs.toFixed(1)}ms hot=${hotMs.toFixed(1)}ms ` +
        `nodes=${cold.nodes.length} guard=cold<${PERF_COLD_MAX_MS}ms,hot<${PERF_HOT_MAX_MS}ms`,
    );

    expect(cold.nodes).toHaveLength(PERF_NODE_COUNT);
    expect(hot).toBe(cold);
    // 固定夹具上的 SLO 是不倒退判据：源冷读须在 30s 内、同进程热读须在 1s 内。
    expect(coldMs).toBeLessThan(PERF_COLD_MAX_MS);
    expect(hotMs).toBeLessThan(PERF_HOT_MAX_MS);
  }, 60_000);

  it("CLI rebuild 发布带代际的完整 JSON，且不留下临时文件", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    const result = spawnSync(process.execPath, [CLI, "rebuild"], {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);

    const indexDir = path.join(tmpDir, ".graph", "index");
    const cachePath = path.join(indexDir, "graph.json");
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
      index_version: number;
      generation: string;
      nodes: { id: string }[];
    };
    expect(cache.index_version).toBe(2);
    expect(cache.generation).toMatch(/^index-v2:/);
    expect(cache.nodes.map((node) => node.id)).toContain("a");
    expect(fs.existsSync(path.join(indexDir, "topology.dot"))).toBe(true);
    expect(fs.existsSync(path.join(indexDir, "meta.json"))).toBe(true);
    expect(fs.readdirSync(indexDir).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("多个外部进程并发构建时最终缓存仍是完整同代 JSON", async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 96; i++) {
      const node: NodeSchema = {
        id: `n${i}`,
        type: NodeType.Task,
        label: `N${i}`,
        level: 1,
        status: NodeStatus.Pending,
        attempts: 0,
        max_attempts: 3,
        created_at: now,
        updated_at: now,
      };
      writeNode(tmpDir, node);
    }

    const workerSource = [
      `import { buildGraphIndex } from ${JSON.stringify(pathToFileURL(INDEX_SERVICE).href)};`,
      "const index = buildGraphIndex(process.argv[1], { useCache: true });",
      "process.stdout.write(index.generation);",
    ].join("\n");
    const runWorker = () =>
      new Promise<{ code: number; output: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", workerSource, tmpDir], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? -1, output: output.trim() }));
      });

    const results = await Promise.all(Array.from({ length: 4 }, runWorker));
    expect(results.every((result) => result.code === 0)).toBe(true);
    expect(new Set(results.map((result) => result.output)).size).toBe(1);
    const cache = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".graph/index/graph.json"), "utf-8"),
    ) as { generation: string; nodes: NodeSchema[] };
    expect(cache.generation).toBe(results[0]?.output);
    expect(cache.nodes).toHaveLength(96);
  }, 30_000);
});
