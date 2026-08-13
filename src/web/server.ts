import { spawn } from "node:child_process";
import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { buildGraphIndex, type GraphIndex } from "../core/graph.js";
import { getNode } from "../core/node.js";
import { createWatcher, type FileChangeEvent } from "./watcher.js";

// 静态资源根目录：dist/web/server.js → ../../web-ui/dist
// 用 fileURLToPath 而非 import.meta.dirname，兼容 Node 20.0–20.10
const WEB_UI_DIR = fileURLToPath(new URL("../../web-ui/dist", import.meta.url));

/**
 * 邻接表 Map → 可 JSON 序列化的普通对象。
 * Map 直接 JSON.stringify 会变成 {}，MCP 侧用 Object.fromEntries，Web 侧保持一致。
 */
export function serializeGraphIndex(index: GraphIndex) {
  return {
    nodes: index.nodes,
    edges: index.edges,
    adjacency: Object.fromEntries(index.adjacency),
    reverseAdj: Object.fromEntries(index.reverseAdj),
  };
}

/** 自动打开默认浏览器（平台分发；spawn 失败静默，不阻塞服务） */
export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  spawnFn: typeof spawn = spawn,
) {
  const cmd =
    platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", url] } // 空引号是 Windows start 的标题占位，必需
      : platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] };
  try {
    const child = spawnFn(cmd.file, cmd.args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      /* 无浏览器/无头环境：静默 */
    });
    child.unref();
  } catch {
    /* 平台命令不可用（如无 xdg-open）：静默，服务照常 */
  }
}

/**
 * 静态文件服务：解码路径 → 归一化 → 强制约束在 WEB_UI_DIR 内。
 * 防路径穿越：/../、%2e%2e、反斜杠变体统一拒绝（403）。
 */
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const rawPath = (req.url ?? "/").split("?")[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }

  let filePath = path.normalize(path.join(WEB_UI_DIR, decoded));
  const webRoot = path.resolve(WEB_UI_DIR);
  if (filePath !== webRoot && !filePath.startsWith(webRoot + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
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
  res.writeHead(200, { "Content-Type": mime[ext] ?? "application/octet-stream" });
  res.end(fs.readFileSync(filePath));
}

export function startServer(
  rootDir: string,
  port: number = 8934,
  options: { open?: boolean } = {},
) {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/graph") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(serializeGraphIndex(buildGraphIndex(rootDir))));
      return;
    }
    serveStatic(req, res);
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
        data: serializeGraphIndex(buildGraphIndex(rootDir)),
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
      data: {
        ...event,
        graph: serializeGraphIndex(buildGraphIndex(rootDir)),
      },
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
    const addr = server.address();
    const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;
    const url = `http://localhost:${actualPort}`;
    console.log(`🌐 拓扑图可视化服务: ${url}`);
    console.log(`📁 监控目录: ${path.join(rootDir, ".graph")}`);
    if (options.open !== false) openBrowser(url);
  });

  return { server, wss, watcher };
}

/** 从文件路径解析出事件类型（node 变更 / edge 变更 / 其他）。Windows 路径用反斜杠，统一正斜杠 */
function classifyEvent(file: string): "node" | "edge" | "graph" | "other" {
  const f = file.replace(/\\/g, "/");
  if (f.startsWith(".graph/nodes/") && f.endsWith(".yaml")) return "node";
  if (f.startsWith(".graph/edges/") && f.endsWith(".yaml")) return "edge";
  if (f === ".graph/graph.yaml") return "graph";
  return "other";
}
