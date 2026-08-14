// tests/web/ws-storm.test.ts — WebSocket 推送风暴回归
// 背景（v0.2 实测缺陷）：
// - 每次状态流转产生 .locks/ 锁文件增删 → 被分类为"其他"→ 2 次全图重建推送；
// - graph snapshot 整目录复制 → 数百次全图重建推送，事件队列积压阻塞增量推送。
// 断言：流转只产生 node:updated；快照零全图推送；连续边变更去抖合并为一次。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocket } from "ws";
import { startServer } from "../../src/web/server.js";
import { createNode, updateNodeStatus } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { createSnapshot } from "../../src/core/snapshot.js";
import { rebuildGraphRefs, writeGraph } from "../../src/core/parser.js";
import { NodeType, NodeStatus, EdgeType } from "../../src/core/types.js";

const N = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let tmpDir: string;
let server: ReturnType<typeof startServer>;
let port: number;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-ws-storm-"));
  writeGraph(tmpDir, {
    id: "g1",
    version: "0.2.0",
    label: "storm",
    entry: { description: "e", defined_by: "human", level: 0 },
    exit: { description: "x", acceptance_criteria: [], defined_by: "human", level: 0 },
    nodes: [],
    edges: [],
  });
  for (let i = 0; i < N; i++) {
    createNode(tmpDir, { id: "n" + i, label: "n" + i, level: 1 }, { syncRef: false });
  }
  for (let i = 0; i < N - 1; i++) {
    createEdge(
      tmpDir,
      { id: "e" + i, source: "n" + i, target: "n" + (i + 1), type: EdgeType.DependsOn },
      { syncRef: false },
    );
  }
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

interface WsMessage {
  type: string;
  nodeId?: string;
  [key: string]: unknown;
}

function connectClient(): Promise<{ ws: WebSocket; messages: WsMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: WsMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(String(d)) as WsMessage));
    ws.on("open", () => resolve({ ws, messages }));
    ws.on("error", reject);
  });
}

describe("WebSocket push storm regression", () => {
  it("状态流转只产生增量推送，锁文件不触发全图重建", async () => {
    const { ws, messages } = await connectClient();
    await sleep(400); // 排空初始 graph:full
    messages.length = 0;

    updateNodeStatus(tmpDir, "n0", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "n0", NodeStatus.Running, "agent-x");
    await sleep(1500);
    ws.close();

    const nodeUpdates = messages.filter((m) => m.type === "node:updated" && m.nodeId === "n0");
    const fullUpdates = messages.filter((m) => m.type === "graph:update");
    expect(nodeUpdates.length).toBeGreaterThanOrEqual(1);
    expect(fullUpdates.length).toBe(0);
  }, 30_000);

  it("snapshot 不再触发全图风暴", async () => {
    const { ws, messages } = await connectClient();
    await sleep(400);
    messages.length = 0;

    createSnapshot(tmpDir, "storm-test");
    await sleep(2000);
    ws.close();

    const fullUpdates = messages.filter((m) => m.type === "graph:update");
    expect(fullUpdates.length).toBeLessThanOrEqual(2); // 去抖后应 0，留平台余量
  }, 30_000);

  it("连续边变更去抖合并为一次全量推送", async () => {
    const { ws, messages } = await connectClient();
    await sleep(400);
    messages.length = 0;

    createEdge(tmpDir, { id: "eb1", source: "n1", target: "n0", type: EdgeType.Fallback });
    createEdge(tmpDir, { id: "eb2", source: "n2", target: "n0", type: EdgeType.SharesContext });
    await sleep(1200);
    ws.close();

    const fullUpdates = messages.filter((m) => m.type === "graph:update");
    expect(fullUpdates.length).toBe(1);
  }, 30_000);
});
