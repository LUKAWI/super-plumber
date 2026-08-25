// tests/web/api-cache.test.ts
// f13 回归（S2-9）：/api/graph 与 WS 初始推送统一启用索引缓存。
// 缓存命中用"mtime 回拨"确定性观测（直接改文件 + utimes 回拨 → isFresh 判新鲜
// → 命中缓存的响应仍返回旧 label；若未启用缓存则会读到新 label）。
// 写后读一致性走正规写路径（createNode → invalidateIndex）。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocket } from "ws";
import { startServer } from "../../src/web/server.js";
import { createNode } from "../../src/core/node.js";
import { createEdge as createEdgeOp } from "../../src/core/edge.js";
import { rebuildGraphRefs, writeGraph } from "../../src/core/parser.js";
import { NodeType, EdgeType } from "../../src/core/types.js";

let tmpDir: string;
let server: ReturnType<typeof startServer>;
let port: number;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f13-"));
  writeGraph(tmpDir, {
    id: "g1",
    version: "0.5.3",
    label: "f13",
    entry: { description: "e", defined_by: "human", level: 0 },
    exit: { description: "x", acceptance_criteria: [], defined_by: "human", level: 0 },
    nodes: [],
    edges: [],
  });
  createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" }, { syncRef: false });
  createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" }, { syncRef: false });
  createEdgeOp(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn }, { syncRef: false });
  rebuildGraphRefs(tmpDir);
  server = startServer(tmpDir, 0, { open: false });
  await new Promise<void>((resolve) => server.server.once("listening", resolve));
  const addr = server.server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  port = addr.port;
});

afterAll(async () => {
  await server.watcher.close();
  await new Promise<void>((resolve) => server.wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function apiGraph(): Promise<{ nodes: { id: string; label?: string }[]; edges: { id: string }[] }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/graph`);
  expect(res.status).toBe(200);
  return (await res.json()) as never;
}

describe("f13 Web 缓存统一（S2-9）", () => {
  it("WC-01 连续 /api/graph 第二次命中缓存（mtime 回拨确定性观测）", async () => {
    const first = await apiGraph();
    expect(first.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);

    // 直接改文件 + mtime 回拨（模拟 NTFS mtime 滞后）：缓存命中则读到旧 label
    const aFile = path.join(tmpDir, ".graph", "nodes", "a.yaml");
    const raw = fs.readFileSync(aFile, "utf-8");
    fs.writeFileSync(aFile, raw.replace("label: A", "label: A-MUTATED"), "utf-8");
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(aFile, past, past);

    const second = await apiGraph();
    const a2 = second.nodes.find((n) => n.id === "a");
    expect(a2?.label).toBe("A"); // 命中缓存（未回源）；未启用缓存会是 A-MUTATED
  });

  it("WC-02 正规写路径后 /api/graph 数据一致（invalidateIndex 生效）", async () => {
    createNode(tmpDir, { id: "c", type: NodeType.Task, label: "C" });
    const g = await apiGraph();
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("WC-03 WS 初始推送与 REST /api/graph 数据一致", async () => {
    const wsMsg = await new Promise<{ type: string; data: unknown }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("等待 graph:full 超时"));
      }, 5_000);
      ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string; data: unknown };
        if (msg.type === "graph:full") {
          clearTimeout(timer);
          ws.close();
          resolve(msg);
        }
      });
      ws.on("error", reject);
    });

    const rest = await apiGraph();
    const wsNodes = (wsMsg.data as { nodes: { id: string; label?: string }[] }).nodes;
    const wsEdges = (wsMsg.data as { edges: { id: string }[] }).edges;
    expect(wsNodes.map((n) => n.id).sort()).toEqual(rest.nodes.map((n) => n.id).sort());
    expect(wsEdges.map((e) => e.id).sort()).toEqual(rest.edges.map((e) => e.id).sort());
    expect(wsEdges).toHaveLength(1);
  }, 10_000);
});
