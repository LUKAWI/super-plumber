// tests/core/cache.test.ts — index 新鲜度缓存（buildGraphIndex useCache）
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildGraphIndex } from "../../src/core/graph.js";
import { createNode, updateNodeContent } from "../../src/core/node.js";
import { NodeType } from "../../src/core/types.js";
import { writeGraph } from "../../src/core/parser.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-cache-"));
  writeGraph(tmpDir, {
    id: "g1",
    version: "0.2.0",
    label: "t",
    entry: { description: "", defined_by: "human", level: 0 },
    exit: { description: "", acceptance_criteria: [], defined_by: "human", level: 0 },
    nodes: [],
    edges: [],
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeCache(overrides: Record<string, unknown> = {}) {
  const indexPath = path.join(tmpDir, ".graph/index");
  fs.mkdirSync(indexPath, { recursive: true });
  const idx = buildGraphIndex(tmpDir);
  fs.writeFileSync(
    path.join(indexPath, "graph.json"),
    JSON.stringify({
      nodes: idx.nodes,
      edges: idx.edges,
      adjacency: Object.fromEntries(idx.adjacency),
      reverseAdj: Object.fromEntries(idx.reverseAdj),
      ...overrides,
    }),
  );
  return idx;
}

describe("index freshness cache", () => {
  it("无缓存时回源 YAML，结果一致", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    const fromCache = buildGraphIndex(tmpDir, { useCache: true });
    expect(fromCache.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("缓存存在且新鲜 → 命中缓存数据", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    const real = writeCache();
    // 缓存标记一个哨兵字段以证明来自缓存
    writeCache({ nodes: [{ ...real.nodes[0], label: "FROM_CACHE" }] });
    const fromCache = buildGraphIndex(tmpDir, { useCache: true });
    expect(fromCache.nodes[0].label).toBe("FROM_CACHE");
  });

  it("源文件变更后缓存失效 → 回源 YAML", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    writeCache({ nodes: [{ id: "a", label: "FROM_CACHE" }] });
    // 变更节点（更新 nodes 目录 mtime）→ 缓存必须失效
    updateNodeContent(tmpDir, "a", { label: "UPDATED" });
    const fromCache = buildGraphIndex(tmpDir, { useCache: true });
    expect(fromCache.nodes[0].label).toBe("UPDATED");
  });

  it("缓存损坏 → 回源不崩溃", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    const indexPath = path.join(tmpDir, ".graph/index");
    fs.mkdirSync(indexPath, { recursive: true });
    fs.writeFileSync(path.join(indexPath, "graph.json"), "{broken json");
    const idx = buildGraphIndex(tmpDir, { useCache: true });
    expect(idx.nodes.map((n) => n.id)).toEqual(["a"]);
  });
});
