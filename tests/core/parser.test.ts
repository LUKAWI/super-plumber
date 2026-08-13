import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  ensureGraphDir,
  writeNode,
  readNode,
  writeEdge,
  readEdge,
  writeGraph,
  readGraph,
  deleteNode,
  deleteEdge,
} from "../../src/core/parser.js";
import {
  NodeType,
  NodeStatus,
  EdgeType,
  type NodeSchema,
  type EdgeSchema,
} from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Parser", () => {
  it("创建 .graph 目录结构", () => {
    ensureGraphDir(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, ".graph/nodes"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".graph/edges"))).toBe(true);
  });

  it("写入和读取节点文件", () => {
    const node: NodeSchema = {
      id: "task_001",
      type: NodeType.Task,
      label: "调研框架",
      level: 1,
      status: NodeStatus.Pending,
      attempts: 0,
      max_attempts: 3,
      created_at: "2026-07-28T10:00:00Z",
      updated_at: "2026-07-28T10:00:00Z",
    };
    writeNode(tmpDir, node);
    const loaded = readNode(tmpDir, "task_001");
    expect(loaded.id).toBe("task_001");
    expect(loaded.status).toBe(NodeStatus.Pending);
  });

  it("写入和读取边文件", () => {
    const edge: EdgeSchema = {
      id: "edge_001",
      source: "task_001",
      target: "task_002",
      type: EdgeType.DependsOn,
    };
    writeEdge(tmpDir, edge);
    const loaded = readEdge(tmpDir, "edge_001");
    expect(loaded.source).toBe("task_001");
    expect(loaded.type).toBe(EdgeType.DependsOn);
  });

  it("写入和读取图根文件", () => {
    writeGraph(tmpDir, {
      id: "graph_001",
      version: "0.1.1",
      label: "test",
      entry: { description: "entry", defined_by: "human", level: 0 },
      exit: {
        description: "exit",
        acceptance_criteria: [],
        defined_by: "human",
        level: 0,
      },
      nodes: [{ file: "nodes/task_001.yaml" }],
      edges: [{ file: "edges/edge_001.yaml" }],
    });
    const loaded = readGraph(tmpDir);
    expect(loaded.id).toBe("graph_001");
    expect(loaded.nodes).toHaveLength(1);
  });

  it("读不存在的节点抛错误", () => {
    expect(() => readNode(tmpDir, "nonexistent")).toThrow();
  });

  it("删除不存在的节点/边抛错误（不静默假成功）", () => {
    expect(() => deleteNode(tmpDir, "ghost")).toThrow(/not found/i);
    expect(() => deleteEdge(tmpDir, "ghost")).toThrow(/not found/i);
  });

  it("软删除后 graph.yaml 引用列表同步移除", () => {
    writeGraph(tmpDir, {
      id: "graph_001",
      version: "0.1.1",
      label: "test",
      entry: { description: "entry", defined_by: "human", level: 0 },
      exit: {
        description: "exit",
        acceptance_criteria: [],
        defined_by: "human",
        level: 0,
      },
      nodes: [{ file: "nodes/a.yaml" }, { file: "nodes/b.yaml" }],
      edges: [{ file: "edges/e1.yaml" }],
    });
    const nodeA: NodeSchema = {
      id: "a",
      type: NodeType.Task,
      label: "A",
      level: 1,
      status: NodeStatus.Pending,
      attempts: 0,
      max_attempts: 3,
      created_at: "x",
      updated_at: "x",
    };
    writeNode(tmpDir, nodeA);
    const edgeE: EdgeSchema = {
      id: "e1",
      source: "a",
      target: "b",
      type: EdgeType.DependsOn,
    };
    writeEdge(tmpDir, edgeE);
    // 有引用边时默认拒绝（防悬挂引用），--cascade 语义 = cascade:true
    expect(() => deleteNode(tmpDir, "a")).toThrow("被 1 条边引用");
    deleteNode(tmpDir, "a", { cascade: true });
    const g = readGraph(tmpDir);
    expect(g.nodes.map((n) => n.file)).toEqual(["nodes/b.yaml"]);
    expect(g.edges).toEqual([]);
  });
});
