// tests/web/ws-storm.test.ts — WebSocket 推送风暴回归
// 背景（v0.2 实测缺陷）：
// - 每次状态流转产生 .locks/ 锁文件增删 → 被分类为"其他"→ 2 次全图重建推送；
// - graph snapshot 整目录复制 → 数百次全图重建推送，事件队列积压阻塞增量推送。
// 断言：流转只产生 node:updated；快照零全图推送；连续边变更去抖合并为一次。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { WebSocket } from "ws";
import { startServer } from "../../src/web/server.js";
import { updateNodeStatus } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { createSnapshot } from "../../src/core/snapshot.js";
import { writeGraph } from "../../src/core/parser.js";
import {
  NodeType,
  NodeStatus,
  EdgeType,
  type EdgeSchema,
  type NodeSchema,
} from "../../src/core/types.js";

// 保留 300 节点的大图压力，但不要用逐项 createNode/createEdge 初始化。
// 这些 API 的结构修订守卫会为每一项生成自动快照，规模增大时快照文件呈 O(N²)
// 增长（上一轮约 125,000 个临时文件）。一次性写入只留下 1 + 300 + 299 个源文件。
const N = 300;
const EDGE_COUNT = N - 1;
const MAX_INITIAL_SOURCE_FILES = 1 + N + EDGE_COUNT;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let tmpDir: string;
let server: ReturnType<typeof startServer>;
let port: number;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-ws-storm-"));

  const graphDir = path.join(tmpDir, ".graph");
  const nodeDir = path.join(graphDir, "nodes");
  const edgeDir = path.join(graphDir, "edges");
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.mkdirSync(edgeDir, { recursive: true });

  const now = new Date().toISOString();
  const nodes: NodeSchema[] = [];
  const edges: EdgeSchema[] = [];
  for (let i = 0; i < N; i++) {
    nodes.push({
      id: "n" + i,
      type: NodeType.Task,
      label: "n" + i,
      level: 1,
      status: NodeStatus.Pending,
      attempts: 0,
      max_attempts: 3,
      created_at: now,
      updated_at: now,
    });
  }
  for (let i = 0; i < EDGE_COUNT; i++) {
    edges.push({
      id: "e" + i,
      source: "n" + i,
      target: "n" + (i + 1),
      type: EdgeType.DependsOn,
    });
  }

  // 夹具直接落有效实体文件，再一次性写 graph.yaml 引用；服务仍从真实图文件读取，
  // 后续状态流转/快照/边写入继续走生产 API，故不会削弱 Web 边界覆盖。
  for (const node of nodes) {
    fs.writeFileSync(
      path.join(nodeDir, `${node.id}.yaml`),
      yaml.dump(node, { indent: 2, lineWidth: 120 }),
      "utf-8",
    );
  }
  for (const edge of edges) {
    fs.writeFileSync(
      path.join(edgeDir, `${edge.id}.yaml`),
      yaml.dump(edge, { indent: 2, lineWidth: 120 }),
      "utf-8",
    );
  }

  writeGraph(tmpDir, {
    id: "g1",
    version: "0.2.0",
    label: "storm",
    entry: { description: "e", defined_by: "human", level: 0 },
    exit: { description: "x", acceptance_criteria: [], defined_by: "human", level: 0 },
    nodes: nodes.map((node) => ({ file: `nodes/${node.id}.yaml` })),
    edges: edges.map((edge) => ({ file: `edges/${edge.id}.yaml` })),
  });

  const sourceFileCount =
    1 +
    fs.readdirSync(nodeDir).filter((file) => file.endsWith(".yaml")).length +
    fs.readdirSync(edgeDir).filter((file) => file.endsWith(".yaml")).length;
  console.log(
    `[v0.9.6] ws-storm fixture: nodes=${N} edges=${EDGE_COUNT} ` +
      `sourceFiles=${sourceFileCount} max=${MAX_INITIAL_SOURCE_FILES} ` +
      "initialAmendSnapshots=0",
  );
  expect(sourceFileCount).toBe(MAX_INITIAL_SOURCE_FILES);

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
