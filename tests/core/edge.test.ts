// tests/core/edge.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createEdge, getEdge, listEdges } from "../../src/core/edge.js";
import { deleteEdge } from "../../src/core/parser.js";
import { EdgeType } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Edge operations", () => {
  it("创建边并持久化", () => {
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

  it("软删除后 listEdges 不再返回该边", () => {
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
