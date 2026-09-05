// tests/web/server.test.ts
// Web 服务测试：静态文件服务、路径穿越防护（含 URL 编码与反斜杠变体）、
// /api/graph 的 adjacency 必须序列化为普通对象（Map 直出会变成 {}）。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { startServer } from "../../src/web/server.js";
import { createNode } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { graduateFog, updateGraph, writeGraph } from "../../src/core/parser.js";
import { NodeType, EdgeType } from "../../src/core/types.js";

let tmpDir: string;
let server: ReturnType<typeof startServer>;
let port: number;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-web-test-"));
  fs.mkdirSync(path.join(tmpDir, ".graph"), { recursive: true });
  // 造两个节点 + 一条边，让 /api/graph 的 adjacency 非空（历史 bug：Map 直出变成 {}）
  createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
  createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
  createEdge(tmpDir, {
    id: "e1",
    source: "a",
    target: "b",
    type: EdgeType.DependsOn,
  });
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

/** 原生 http 请求（fetch/undici 会预先把 /../ 归一化，无法测试服务端防护） */
function rawRequest(pathname: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("web server static serving", () => {
  it("GET / 返回 index.html（SPA 兜底）", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<!doctype html>");
  });

  it("GET /api/graph 透出雾区/工作类概要（F04，web-ui 云团数据源）；毕业后消失", async () => {
    // 该测试工作区是裸 nodes 目录（无 graph.yaml）——先落骨架图
    writeGraph(tmpDir, {
      id: "g-web",
      version: "0.9.0",
      label: "web-fog",
      entry: { description: "e", defined_by: "human", level: 0 },
      exit: { description: "x", acceptance_criteria: [], defined_by: "human", level: 0 },
      nodes: [],
      edges: [],
    });
    updateGraph(tmpDir, {
      fog: { id: "ra", description: "d", graduation: "g", ignited: ["a"] },
      class: "program",
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/graph`);
    const body = (await res.json()) as Record<string, any>;
    expect(body.fog).toEqual({ id: "ra", description: "d", graduation: "g", ignited: ["a"] });
    expect(body.class).toBe("program");
    graduateFog(tmpDir, {});
    const after = await (await fetch(`http://127.0.0.1:${port}/api/graph`)).json();
    expect(after.fog).toBeUndefined();
  });

  it("GET /index.html 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/index.html`);
    expect(res.status).toBe(200);
  });

  it("GET /api/graph 返回 JSON，adjacency 是普通对象且可展开", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/graph`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(typeof body.adjacency).toBe("object");
    expect(body.adjacency).not.toBe(null);
    // 历史 bug：Map 直接 stringify → {}，键全部丢失；现在应包含 a → ["b"]（b 为空邻接）
    expect(JSON.parse(JSON.stringify(body.adjacency))).toEqual({
      a: ["b"],
      b: [],
    });
  });

  it("GET /api/graph 损坏节点 YAML 返回 500，服务进程保持可用", async () => {
    const nodeFile = path.join(tmpDir, ".graph", "nodes", "a.yaml");
    const original = fs.readFileSync(nodeFile, "utf-8");
    try {
      fs.writeFileSync(nodeFile, "id: [unclosed", "utf-8");
      const failed = await fetch(`http://127.0.0.1:${port}/api/graph`);
      expect(failed.status).toBe(500);
      const body = (await failed.json()) as { error: string };
      expect(body.error).toContain("内部错误");
      expect(body.error).not.toContain("unclosed");

      fs.writeFileSync(nodeFile, original, "utf-8");
      const recovered = await fetch(`http://127.0.0.1:${port}/api/graph`);
      expect(recovered.status).toBe(200);
    } finally {
      fs.writeFileSync(nodeFile, original, "utf-8");
    }
  });

  it("路径穿越 /../package.json 被拒绝（403）", async () => {
    const { status } = await rawRequest("/../package.json");
    expect(status).toBe(403);
  });

  it("URL 编码穿越 /%2e%2e/package.json 被拒绝（403）", async () => {
    const { status } = await rawRequest("/%2e%2e/package.json");
    expect(status).toBe(403);
  });

  it("反斜杠穿越 /..%5c..%5cpackage.json 被拒绝（403）", async () => {
    const { status } = await rawRequest("/..%5c..%5cpackage.json");
    expect(status).toBe(403);
  });

  it("深层穿越 /%2e%2e/%2e%2e/%2e%2e/Windows/win.ini 被拒绝", async () => {
    const { status } = await rawRequest("/%2e%2e/%2e%2e/%2e%2e/Windows/win.ini");
    expect(status).toBe(403);
  });

  it("非法 URL 编码（%zz）返回 400 而非崩溃", async () => {
    const { status } = await rawRequest("/%zz");
    expect(status).toBe(400);
  });
});
