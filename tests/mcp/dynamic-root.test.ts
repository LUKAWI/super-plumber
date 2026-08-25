// tests/mcp/dynamic-root.test.ts — MCP 动态图目录定位
// 场景：用户把 MCP 配置写进 agent 全局配置一次，换项目不改配置。
// 解析链：--root/SUPER_PLUMBER_ROOT > 客户端 roots(workspace) > cwd 向上查找 > cwd。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { writeGraph } from "../../src/core/parser.js";
import { createNode } from "../../src/core/node.js";
import { NodeType } from "../../src/core/types.js";

const SDK = "@modelcontextprotocol/sdk";

let homeDir: string; // 模拟客户端拉起 server 时的中性目录（无图）
let projA: string;
let projB: string;

function initGraph(dir: string, nodeId: string): void {
  writeGraph(dir, {
    id: `g-${nodeId}`,
    version: "0.4.1",
    label: dir,
    entry: { description: "e", defined_by: "human", level: 0 },
    exit: { description: "x", acceptance_criteria: [], defined_by: "human", level: 0 },
    nodes: [],
    edges: [],
  });
  createNode(dir, { id: nodeId, type: NodeType.Task, label: nodeId.toUpperCase() });
}

async function connect(opts: {
  cwd: string;
  args?: string[];
  roots?: string[];
}) {
  const { Client } = await import(`${SDK}/client/index.js`);
  const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);
  const serverJs = path.resolve(process.cwd(), "dist/mcp/server.js");
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverJs, ...(opts.args ?? [])],
    cwd: opts.cwd,
  });
  const client = new Client(
    { name: "root-test", version: "0.1.0" },
    opts.roots
      ? { capabilities: { roots: { listChanged: false } } }
      : undefined,
  );
  if (opts.roots) {
    const { ListRootsRequestSchema } = await import(`${SDK}/types.js`);
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: opts.roots!.map((r) => ({ uri: pathToFileURL(r).href })),
    }));
  }
  await client.connect(transport);
  return client;
}

async function firstNodeId(client: Awaited<ReturnType<typeof connect>>): Promise<string> {
  const r = await client.callTool({ name: "graph_get_graph", arguments: {} });
  expect(r.isError).toBeFalsy();
  const text = (r.content as { type: "text"; text: string }[])[0].text;
  return (JSON.parse(text).nodes as { id: string }[])[0].id;
}

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-mcp-home-"));
  projA = fs.mkdtempSync(path.join(os.tmpdir(), "topo-mcp-projA-"));
  projB = fs.mkdtempSync(path.join(os.tmpdir(), "topo-mcp-projB-"));
});

afterEach(() => {
  for (const d of [homeDir, projA, projB]) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("MCP 动态 root 解析（全局配置一次，随项目跟随）", () => {
  it("客户端 roots 上报 workspace → server 定位到该项目的图（cwd 与项目无关）", async () => {
    initGraph(projA, "node_a");
    const client = await connect({ cwd: homeDir, roots: [projA] });
    try {
      expect(await firstNodeId(client)).toBe("node_a");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("无 roots：从 server cwd 向上查找 .graph（子目录里启动也能命中项目根）", async () => {
    initGraph(projB, "node_b");
    const deep = path.join(projB, "packages", "web");
    fs.mkdirSync(deep, { recursive: true });
    const client = await connect({ cwd: deep });
    try {
      expect(await firstNodeId(client)).toBe("node_b");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("--root 显式覆盖优先级最高（cwd 里有别的图也不受影响）", async () => {
    initGraph(projA, "node_a");
    initGraph(projB, "node_b");
    const client = await connect({ cwd: projB, args: ["--root", projA] });
    try {
      expect(await firstNodeId(client)).toBe("node_a");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("定位不到任何图时行为可读：get_graph 报图未初始化而非静默空图", async () => {
    const client = await connect({ cwd: homeDir });
    try {
      const r = await client.callTool({ name: "graph_get_graph", arguments: {} });
      expect(r.isError).toBe(true);
      const text = JSON.stringify(r.content);
      expect(text).toContain("graph init");
    } finally {
      await client.close();
    }
  }, 30_000);
});
