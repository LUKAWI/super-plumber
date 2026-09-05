// v0.9.6 WebSocket 边界协议：Origin、连接洪峰、慢客户端与半写入恢复。
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocket } from "ws";
import { startServer, type WebServerOptions } from "../../src/web/server.js";
import { createGraph } from "../../src/core/graph-dir.js";
import { createNode } from "../../src/core/node.js";
import { NodeType } from "../../src/core/types.js";

type ServerHandle = ReturnType<typeof startServer>;

async function startBoundaryServer(options: WebServerOptions = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-ws-boundary-"));
  const graphDir = createGraph(tmpDir, "boundary", "边界测试图");
  const server = startServer(tmpDir, 0, { open: false, ...options });
  await new Promise<void>((resolve) => server.server.once("listening", resolve));
  const addr = server.server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  return { tmpDir, graphDir, server, port: addr.port };
}

async function stopBoundaryServer(handle: { tmpDir: string; server: ServerHandle }) {
  await handle.server.watcher.close();
  for (const client of handle.server.wss.clients) client.terminate();
  await new Promise<void>((resolve) => handle.server.wss.close(() => resolve()));
  await new Promise<void>((resolve) => handle.server.server.close(() => resolve()));
  fs.rmSync(handle.tmpDir, { recursive: true });
}

function rejectedUpgrade(port: number, origin: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        Origin: origin,
        "Sec-WebSocket-Key": Buffer.alloc(16, "b").toString("base64"),
        "Sec-WebSocket-Version": "13",
      },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += String(chunk)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.once("error", reject);
    req.once("upgrade", (_res, socket) => {
      socket.destroy();
      reject(new Error("unexpected WebSocket upgrade"));
    });
    req.end();
  });
}

function connectClient(port: number): Promise<{
  ws: WebSocket;
  messages: Record<string, unknown>[];
  closed: Promise<number>;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: Record<string, unknown>[] = [];
    const closed = new Promise<number>((closeResolve) => {
      ws.once("close", (code) => closeResolve(code));
    });
    ws.on("message", (data) => messages.push(JSON.parse(String(data)) as Record<string, unknown>));
    ws.once("open", () => resolve({ ws, messages, closed }));
    ws.once("error", reject);
  });
}

describe("v0.9.6 WebSocket boundary contract", () => {
  it("拒绝恶意 Origin，并返回明确的 403 Upgrade 响应", async () => {
    const handle = await startBoundaryServer();
    try {
      const response = await rejectedUpgrade(handle.port, "https://evil.example");
      expect(response.status).toBe(403);
      expect(response.body).toContain("Forbidden WebSocket Origin");
    } finally {
      await stopBoundaryServer(handle);
    }
  });

  it("连接洪峰超过上限时拒绝后续握手，已有连接不受影响", async () => {
    const handle = await startBoundaryServer({ maxWebSocketClients: 1 });
    let first: WebSocket | undefined;
    try {
      ({ ws: first } = await connectClient(handle.port));
      const response = await rejectedUpgrade(handle.port, "");
      expect(response.status).toBe(503);
      expect(response.body).toContain("WebSocket capacity reached");
      expect(first.readyState).toBe(WebSocket.OPEN);
    } finally {
      first?.terminate();
      await stopBoundaryServer(handle);
    }
  });

  it("发送队列超过字节边界时以 1013 关闭慢客户端", async () => {
    const handle = await startBoundaryServer({ maxWebSocketPendingBytes: 1 });
    try {
      const { ws, closed } = await connectClient(handle.port);
      expect(await closed).toBe(1013);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    } finally {
      await stopBoundaryServer(handle);
    }
  });

  it("半写入节点只推送可恢复错误，修复后继续推送节点更新", async () => {
    const handle = await startBoundaryServer();
    const node = createNode(handle.graphDir, {
      id: "half-written-node",
      type: NodeType.Task,
      label: "半写入节点",
    }, { syncRef: false });
    const nodeFile = path.join(handle.graphDir, "nodes", `${node.id}.yaml`);
    const original = fs.readFileSync(nodeFile, "utf-8");
    try {
      const { ws, messages } = await connectClient(handle.port);
      await new Promise((resolve) => setTimeout(resolve, 350));
      messages.length = 0;

      fs.writeFileSync(nodeFile, "id: [unclosed\n", "utf-8");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(messages.some((message) => message.type === "graph:error")).toBe(true);
      expect(messages.some((message) => message.type === "node:updated" && message.removed === true)).toBe(false);

      fs.writeFileSync(nodeFile, original, "utf-8");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(messages.some((message) => message.type === "node:updated" && message.nodeId === node.id)).toBe(true);
      ws.terminate();
    } finally {
      fs.writeFileSync(nodeFile, original, "utf-8");
      await stopBoundaryServer(handle);
    }
  }, 10_000);
});
