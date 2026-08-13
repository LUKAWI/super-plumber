// tests/core/edge.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createEdge, getEdge, listEdges } from "../../src/core/edge.js";
import { deleteEdge } from "../../src/core/parser.js";
import { createNode } from "../../src/core/node.js";
import { EdgeType, NodeType } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeNodes(ids: string[]) {
  for (const id of ids) {
    createNode(tmpDir, { id, type: NodeType.Task, label: id.toUpperCase() });
  }
}

describe("Edge operations", () => {
  it("创建边并持久化", () => {
    makeNodes(["a", "b"]);
    const edge = createEdge(tmpDir, {
      id: "e1",
      source: "a",
      target: "b",
      type: EdgeType.DependsOn,
    });
    expect(edge.type).toBe(EdgeType.DependsOn);
    expect(fs.existsSync(path.join(tmpDir, ".graph/edges/e1.yaml"))).toBe(true);
  });

  it("创建边带合约", () => {
    makeNodes(["a", "b"]);
    createEdge(tmpDir, {
      id: "e2",
      source: "a",
      target: "b",
      type: EdgeType.Validates,
      contract: { produces: "report" },
    });
    const loaded = getEdge(tmpDir, "e2");
    expect(loaded.contract?.produces).toBe("report");
  });

  it("listEdges 返回空", () => {
    expect(listEdges(tmpDir)).toEqual([]);
  });

  it("listEdges 返回所有边", () => {
    makeNodes(["a", "b", "c"]);
    createEdge(tmpDir, {
      id: "e1",
      source: "a",
      target: "b",
      type: EdgeType.DependsOn,
    });
    createEdge(tmpDir, {
      id: "e2",
      source: "b",
      target: "c",
      type: EdgeType.DependsOn,
    });
    expect(listEdges(tmpDir)).toHaveLength(2);
  });

  it("幽灵源节点 → 核心层拦截（可读错误）", () => {
    makeNodes(["b"]);
    expect(() =>
      createEdge(tmpDir, {
        id: "e1",
        source: "ghost",
        target: "b",
        type: EdgeType.DependsOn,
      }),
    ).toThrow("source node ghost not found");
  });

  it("幽灵目标节点 → 核心层拦截", () => {
    makeNodes(["a"]);
    expect(() =>
      createEdge(tmpDir, {
        id: "e1",
        source: "a",
        target: "ghost",
        type: EdgeType.DependsOn,
      }),
    ).toThrow("target node ghost not found");
  });

  it("软删除后 listEdges 不再返回该边", () => {
    makeNodes(["a", "b", "c"]);
    createEdge(tmpDir, {
      id: "e1",
      source: "a",
      target: "b",
      type: EdgeType.DependsOn,
    });
    createEdge(tmpDir, {
      id: "e2",
      source: "b",
      target: "c",
      type: EdgeType.DependsOn,
    });
    deleteEdge(tmpDir, "e1");
    const ids = listEdges(tmpDir).map((e) => e.id);
    expect(ids).toEqual(["e2"]);
  });
});
