import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { buildGraphIndex } from "../core/graph.js";
import { createWatcher, type FileChangeEvent } from "./watcher.js";

const WEB_UI_DIR = path.resolve(
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  (import.meta as any).dirname ?? __dirname,
  "../../web-ui/dist"
);

export function startServer(rootDir: string, port: number = 3030) {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/graph") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(buildGraphIndex(rootDir)));
      return;
    }
    let filePath = path.join(WEB_UI_DIR, req.url === "/" ? "index.html" : req.url!);
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
    res.writeHead(200, { "Content-Type": mime[ext] ?? "application/octet-stream" });
    res.end(fs.readFileSync(filePath));
  });

  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.send(JSON.stringify({
      type: "graph:full",
      data: buildGraphIndex(rootDir),
    }));
  });

  const watcher = createWatcher(rootDir, (event: FileChangeEvent) => {
    const msg = JSON.stringify({
      type: "graph:update",
      data: { ...event, graph: buildGraphIndex(rootDir) },
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  });

  server.listen(port, () => {
    console.log(`🌐 拓扑图可视化服务: http://localhost:${port}`);
    console.log(`📁 监控目录: ${path.join(rootDir, ".graph")}`);
  });

  return { server, wss, watcher };
}
