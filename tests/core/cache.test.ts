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

    const disk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".graph/index/graph.json"), "utf-8"),
    ) as { index_version: number; generation: string; sources: { path: string }[] };
    expect(disk.index_version).toBe(2);
    expect(disk.generation).toBe(fromCache.generation);
    expect(disk.sources.map((source) => source.path)).toEqual(
      expect.arrayContaining(["graph.yaml", "nodes/a.yaml", "nodes", "edges"]),
    );
  });

  it("代际完整的缓存存在且新鲜 → 命中磁盘缓存数据", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    const real = readNode(tmpDir, "a");
    // 先生成真实 v2 代际，再替换节点载荷为哨兵；重置内存缓存后只验证磁盘命中。
    buildGraphIndex(tmpDir, { useCache: true });
    const cacheFile = path.join(tmpDir, ".graph/index/graph.json");
    const payload = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as {
      nodes: Array<typeof real>;
    };
    payload.nodes = [{ ...real, label: "FROM_CACHE" }];
    resetIndexCache();
    fs.writeFileSync(cacheFile, JSON.stringify(payload), "utf-8");

    const fromCache = buildGraphIndex(tmpDir, { useCache: true });
    expect(fromCache.nodes[0].label).toBe("FROM_CACHE");
  });

  it("缺代际元数据的旧索引不会在 mtime 回拨后复活更新节点", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "OLD" });
    const nodePath = path.join(tmpDir, ".graph/nodes/a.yaml");
    const original = fs.statSync(nodePath);
    const real = readNode(tmpDir, "a");

    // 旧版 graph.json 没有源快照；它不能仅凭 cache mtime 声称自己新鲜。
    writeDiskCacheJson({
      nodes: [{ ...real, label: "STALE" }],
      edges: [],
      adjacency: { a: [] },
      reverseAdj: { a: [] },
      gateReverseAdj: { a: [] },
    });
    const raw = fs.readFileSync(nodePath, "utf-8");
    fs.writeFileSync(nodePath, raw.replace("label: OLD", "label: UPDATED"), "utf-8");
    fs.utimesSync(nodePath, original.atime, original.mtime);

    const current = buildGraphIndex(tmpDir, { useCache: true });
    expect(current.nodes[0].label).toBe("UPDATED");
    const rebuilt = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".graph/index/graph.json"), "utf-8"),
    ) as { index_version: number };
    expect(rebuilt.index_version).toBe(2);
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

  it("代际完整但缺 gateReverseAdj 的缓存自动推导门控邻接", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    // 早期 v2 缓存可能没有 gateReverseAdj，但必须带真实 generation/source stamps。
    buildGraphIndex(tmpDir, { useCache: true });
    const cacheFile = path.join(tmpDir, ".graph/index/graph.json");
    const payload = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as Record<string, unknown>;
    delete payload.gateReverseAdj;
    resetIndexCache();
    fs.writeFileSync(cacheFile, JSON.stringify(payload), "utf-8");

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
