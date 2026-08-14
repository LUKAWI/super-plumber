// tests/core/cache.test.ts — index 新鲜度缓存（buildGraphIndex useCache）
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildGraphIndex, resetIndexCache } from "../../src/core/graph.js";
import { createNode, updateNodeContent } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { NodeType, EdgeType } from "../../src/core/types.js";
import { writeGraph, readNode } from "../../src/core/parser.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-cache-"));
  resetIndexCache(); // 跨用例隔离进程内缓存
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
  resetIndexCache();
});

function writeDiskCacheJson(content: unknown) {
  const indexPath = path.join(tmpDir, ".graph/index");
  fs.mkdirSync(indexPath, { recursive: true });
  fs.writeFileSync(
    path.join(indexPath, "graph.json"),
    typeof content === "string" ? content : JSON.stringify(content),
  );
}

describe("index freshness cache", () => {
  it("无缓存时回源 YAML，结果一致", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    const fromCache = buildGraphIndex(tmpDir, { useCache: true });
    expect(fromCache.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("缓存存在且新鲜 → 命中磁盘缓存数据", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    const real = readNode(tmpDir, "a");
    // 直接写哨兵磁盘缓存（不先构建索引，避免命中进程内内存缓存）
    writeDiskCacheJson({
      nodes: [{ ...real, label: "FROM_CACHE" }],
      edges: [],
      adjacency: { a: [] },
      reverseAdj: { a: [] },
      gateReverseAdj: { a: [] },
    });
    const fromCache = buildGraphIndex(tmpDir, { useCache: true });
    expect(fromCache.nodes[0].label).toBe("FROM_CACHE");
  });

  it("同进程二次构建命中内存缓存（同一对象引用）", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    const first = buildGraphIndex(tmpDir, { useCache: true });
    const second = buildGraphIndex(tmpDir, { useCache: true });
    expect(second).toBe(first);
  });

  it("源文件变更后缓存失效 → 回源 YAML", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    writeDiskCacheJson({
      nodes: [{ id: "a", label: "FROM_CACHE" }],
      edges: [],
      adjacency: { a: [] },
      reverseAdj: { a: [] },
      gateReverseAdj: { a: [] },
    });
    // 变更节点（节点文件 mtime 更新）→ 缓存必须失效
    updateNodeContent(tmpDir, "a", { label: "UPDATED" });
    const fromCache = buildGraphIndex(tmpDir, { useCache: true });
    expect(fromCache.nodes[0].label).toBe("UPDATED");
  });

  it("缓存损坏 → 回源不崩溃", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    writeDiskCacheJson("{broken json");
    const idx = buildGraphIndex(tmpDir, { useCache: true });
    expect(idx.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("旧格式磁盘缓存（缺 gateReverseAdj）自动推导门控邻接", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    // 旧格式：无 gateReverseAdj 字段
    writeDiskCacheJson({
      nodes: [readNode(tmpDir, "a"), readNode(tmpDir, "b")],
      edges: [{ id: "e1", source: "a", target: "b", type: "depends_on" }],
      adjacency: { a: ["b"], b: [] },
      reverseAdj: { a: [], b: ["a"] },
    });
    const idx = buildGraphIndex(tmpDir, { useCache: true });
    expect(idx.gateReverseAdj.get("b")).toEqual(["a"]);
  });
});

describe("gateReverseAdj（门控反向邻接）", () => {
  it("只含 4 种门控边，排除运行时边", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    for (const id of ids) {
      createNode(tmpDir, { id, type: NodeType.Task, label: id });
    }
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    createEdge(tmpDir, { id: "e2", source: "b", target: "c", type: EdgeType.Validates });
    createEdge(tmpDir, { id: "e3", source: "c", target: "d", type: EdgeType.FanIn });
    createEdge(tmpDir, { id: "e4", source: "d", target: "e", type: EdgeType.FanOut });
    createEdge(tmpDir, { id: "e5", source: "e", target: "f", type: EdgeType.SharesContext });
    createEdge(tmpDir, { id: "e6", source: "g", target: "a", type: EdgeType.Fallback });
    createEdge(tmpDir, { id: "e7", source: "f", target: "h", type: EdgeType.Iterates });

    const idx = buildGraphIndex(tmpDir, { useCache: true });
    expect(idx.gateReverseAdj.get("b")).toEqual(["a"]);
    expect(idx.gateReverseAdj.get("c")).toEqual(["b"]);
    expect(idx.gateReverseAdj.get("d")).toEqual(["c"]);
    expect(idx.gateReverseAdj.get("e")).toEqual(["d"]);
    // shares_context / fallback / iterates 不参与门禁
    expect(idx.gateReverseAdj.get("f")).toEqual([]);
    expect(idx.gateReverseAdj.get("a")).toEqual([]);
    expect(idx.gateReverseAdj.get("h")).toEqual([]);
  });
});
