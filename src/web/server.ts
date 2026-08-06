import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { buildGraphIndex } from "../core/graph.js";
import { getNode } from "../core/node.js";
import { createWatcher, type FileChangeEvent } from "./watcher.js";

const WEB_UI_DIR = path.resolve(
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  (import.meta as any).dirname ?? __dirname,
  "../../web-ui/dist",
);

/** 从文件路径解析出事件类型（node 变更 / edge 变更 / 其他）。Windows 路径用反斜杠，统一正斜杠 */
function classifyEvent(file: string): "node" | "edge" | "graph" | "other" {
  const f = file.replace(/\\/g, "/");
  if (f.startsWith(".graph/nodes/") && f.endsWith(".yaml")) return "node";
  if (f.startsWith(".graph/edges/") && f.endsWith(".yaml")) return "edge";
  if (f === ".graph/graph.yaml") return "graph";
  return "other";
}

export function startServer(rootDir: string, port: number = 8934) {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/graph") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(buildGraphIndex(rootDir)));
      return;
    }
    let filePath = path.join(
      WEB_UI_DIR,
      req.url === "/" ? "index.html" : req.url!,
    );
    if (!fs.existsSync(filePath)) {
      filePath = path.join(WEB_UI_DIR, "index.html");
    }
    const ext = path.extname(filePath);
    const mime: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, {
      "Content-Type": mime[ext] ?? "application/octet-stream",
    });
    res.end(fs.readFileSync(filePath));
  });

  const wss = new WebSocketServer({ server });
  // ws 库会把 http server 的 'error' 事件转发到 wss 实例（this.emit.bind），
  // wss 无监听器时 emit('error') 直接 throw 并中断后续监听器——必须给 wss 也注册
  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`❌ 端口 ${port} 已被占用，请用 -p 指定其他端口`);
      process.exit(1);
    }
    throw err;
  });
  const clients = new Set<WebSocket>();

  function broadcast(msg: unknown) {
    const json = JSON.stringify(msg);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.send(
      JSON.stringify({
        type: "graph:full",
        data: buildGraphIndex(rootDir),
      }),
    );
  });

  const watcher = createWatcher(rootDir, (event: FileChangeEvent) => {
    const kind = classifyEvent(event.file);

    // 节点文件变更 → 增量推送该节点
    if (kind === "node") {
      const f = event.file.replace(/\\/g, "/");
      const nodeId = f
        .split("/")
        .pop()!
        .replace(/\.yaml$/, "")
        .replace(/\.deleted.*$/, "");
      // 软删除或 unlink 时节点可能不存在
      let node: ReturnType<typeof getNode> | null = null;
      try {
        node = getNode(rootDir, nodeId);
      } catch {
        /* 节点已删除 */
      }
      broadcast({
        type: "node:updated",
        nodeId,
        node,
        removed: node === null,
      });
      return;
    }

    // 边 / 图 / 其他变更 → 全量推送（低频事件，全量可接受）
    broadcast({
      type: "graph:update",
      data: { ...event, graph: buildGraphIndex(rootDir) },
    });
  });

  // 端口占用/监听错误必须友好处理（曾 unhandled 'error' event 裸崩溃）
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`❌ 端口 ${port} 已被占用，请用 -p 指定其他端口`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(`🌐 拓扑图可视化服务: http://localhost:${port}`);
    console.log(`📁 监控目录: ${path.join(rootDir, ".graph")}`);
  });

  return { server, wss, watcher };
}
