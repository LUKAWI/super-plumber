// tests/mcp/service-layer.test.ts
// f12 回归（S3-1/S2-7/S2-8/S3-14/S3-15）：MCP 服务层完善与类型加固。
// as never 逃逸清零（静态断言）、根入口/核心桶补齐多图 API、graph_search 走
// 索引缓存、graph_get_graph 边同窗口分页、异常处理器 fail-fast 策略。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
// S2-7：根入口消费（此前只有 types）——多图 API 从根入口可用
import { createGraph, listGraphNames, readEvents } from "../../src/index.js";
import { buildGraphIndex } from "../../src/core/index.js";

const SDK = "@modelcontextprotocol/sdk";

async function connectServer(cwd: string) {
  const { Client } = await import(`${SDK}/client/index.js`);
  const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);
  const serverJs = path.resolve(process.cwd(), "dist/mcp/server.js");
  const transport = new StdioClientTransport({ command: "node", args: [serverJs], cwd });
  const client = new Client({ name: "test", version: "0.1.1" });
  await client.connect(transport);
  return client;
}

function parseBody(r: { content?: { text?: string }[] }): Record<string, any> {
  return JSON.parse(r.content![0].text!);
}

describe("f12 MCP 服务层完善", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f12-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id a --label Alpha`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id b --label Beta`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id c --label Gamma`, { cwd: tmpDir });
    execSync(`node "${cli}" add-edge --id ab --source a --target b`, { cwd: tmpDir });
    execSync(`node "${cli}" add-edge --id bc --source b --target c`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("SL-01 S3-1 src/mcp/server.ts 的 as never 归零（静态断言）", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/mcp/server.ts"),
      "utf-8",
    );
    expect(src).not.toContain("as never");
  });

  it("SL-02 S2-7 根入口可用多图 API（createGraph/listGraphNames）与审计读取", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f12-root-"));
    try {
      createGraph(ws, "demo", "Demo");
      createGraph(ws, "demo2", "Demo2");
      expect(listGraphNames(ws).sort()).toEqual(["demo", "demo2"]);
      // 审计读取 API 也从根入口可用（eventlog 桶补齐）
      expect(Array.isArray(readEvents(ws))).toBe(true);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("SL-03 S2-7 核心桶 buildGraphIndex 等价可用（./core 子路径消费面）", () => {
    const idx = buildGraphIndex(path.join(tmpDir, ".graph", "t"), { useCache: true });
    expect(idx.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
    expect(idx.edges).toHaveLength(2);
  });

  it("SL-04 S2-8 graph_search 行为等价（走索引缓存后过滤语义不变）", async () => {
    const r = parseBody(
      await client.callTool({
        name: "graph_search",
        arguments: { query: "Alpha" },
      }),
    );
    expect(r.total).toBe(1);
    expect(r.nodes[0].id).toBe("a");
    const none = parseBody(
      await client.callTool({ name: "graph_search", arguments: { query: "zzz" } }),
    );
    expect(none.total).toBe(0);
  });

  it("SL-05 S3-14 graph_get_graph 边同窗口分页 + edge_total", async () => {
    const p1 = parseBody(
      await client.callTool({ name: "graph_get_graph", arguments: { limit: 1 } }),
    );
    expect(p1.nodes).toHaveLength(1);
    expect(p1.edges).toHaveLength(1); // 同窗口：第 1 条边
    expect(p1.edge_total).toBe(2);
    expect(p1.edges[0]).not.toHaveProperty("contract"); // summary 紧凑化
    expect(Object.keys(p1.edges[0]).sort()).toEqual(["id", "source", "target", "type"]);

    const p2 = parseBody(
      await client.callTool({
        name: "graph_get_graph",
        arguments: { limit: 1, offset: 1 },
      }),
    );
    expect(p2.edges[0].id).toBe("bc");

    const full = parseBody(
      await client.callTool({
        name: "graph_get_graph",
        arguments: { mode: "full", limit: 10 },
      }),
    );
    expect(full.edges).toHaveLength(2);
  });

  it("SL-06 S3-15 异常处理器 fail-fast 策略在源码中生效（静态断言）", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/mcp/server.ts"),
      "utf-8",
    );
    const handler = src.slice(src.indexOf("uncaughtException"));
    expect(handler).toMatch(/process\.exit\(1\)/);
  });
});
