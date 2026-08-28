import { spawn } from "node:child_process";
import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { buildGraphIndex, type GraphIndex } from "../core/graph.js";
import { getNode } from "../core/node.js";
import { readGraph } from "../core/parser.js";
import { createWatcher, type FileChangeEvent } from "./watcher.js";
import {
  toGraphDir,
  listGraphNames,
  readWorkspaceDefault,
  workspaceOf,
} from "../core/graph-dir.js";
import { listSnapshots, diffSnapshot } from "../core/snapshot.js";
import { GRAPH_DIR, GRAPH_FILE } from "../core/types.js";

// 静态资源根目录：dist/web/server.js → ../../web-ui/dist
// 用 fileURLToPath 而非 import.meta.dirname，兼容 Node 20.0–20.10
const WEB_UI_DIR = fileURLToPath(new URL("../../web-ui/dist", import.meta.url));

// ── 多图工作区模型 ─────────────────────────────────────────────────────────────
// .graph/{active, schema.yaml, workspace-events.jsonl, <图名>/…, .trash/}；
// 旧布局（.graph/graph.yaml 原地）= 单图 default，图目录即 .graph/ 自身。
// ws 每条图数据消息都带 graph: "<图名>"；工作区级消息（图列表）用 graph: "*"。

export interface GraphMeta {
  name: string;
  label?: string;
  nodeCount: number;
  statuses: Record<string, number>;
  lastActivity: string | null;
}

export interface GraphsPayload {
  active: string | null;
  graphs: GraphMeta[];
}

/** 工作区级文件（不属于任何图）与旧布局已知的图内顶层名 */
const WS_LEVEL_FILES = new Set(["active", "workspace-events.jsonl", "schema.yaml"]);
const LEGACY_INSIDE_TOPS = new Set(["nodes", "edges", "snapshots", "index", "events.jsonl"]);

export interface RouteContext {
  /** 当前已知图名（listGraphNames 的结果） */
  names: string[];
  /** 旧布局：.graph/graph.yaml 原地（唯一图 default，图目录 = .graph/） */
  legacy: boolean;
}

export type GraphEventRoute =
  | { rescan: true }
  | { rescan: false; graph: string; kind: "node" | "edge" | "graph" | "other" }
  // null = 工作区级文件/忽略（active、workspace-events.jsonl、schema.yaml、.trash 等）
  | null;

/** 图目录内相对路径 → 事件种类 */
function classifyInside(p: string): "node" | "edge" | "graph" | "other" {
  if (p.startsWith("nodes/") && p.endsWith(".yaml")) return "node";
  if (p.startsWith("edges/") && p.endsWith(".yaml")) return "edge";
  if (p === "graph.yaml") return "graph";
  return "other";
}

/**
 * 把 .graph/ 下的文件事件按路径前缀分类到所属图（纯函数，可单测）。
 * - 旧布局：全部图内事件归 default；出现未知一级目录（迁移产生的 default/、新图）
 *   或根 graph.yaml unlink → rescan（图集合可能变化）。
 * - 多图布局：`.graph/<图名>/…` 路由到该图；未知一级目录、`<seg>/graph.yaml`
 *   的 add/unlink（建图/删图）→ rescan；工作区级文件与点开头目录（.trash/.locks）忽略。
 */
export function routeGraphEvent(
  // type 放宽为 string：chokidar 'all' 还会发 addDir/unlinkDir（经 watcher 透传）
  event: { type: string; file: string },
  ctx: RouteContext,
): GraphEventRoute {
  const f = event.file.replace(/\\/g, "/");
  if (!f.startsWith(GRAPH_DIR + "/")) return null;
  const rest = f.slice(GRAPH_DIR.length + 1);
  if (rest === "") return null;
  const top = rest.split("/")[0];

  if (ctx.legacy) {
    if (top.startsWith(".")) return null; // .trash/.locks/其它点文件
    if (WS_LEVEL_FILES.has(rest)) {
      // active 变化影响图列表的 active 标记；schema/事件日志忽略
      return rest === "active" ? { rescan: true } : null;
    }
    if (top === "graph.yaml") {
      return event.type === "unlink" ? { rescan: true } : { rescan: false, graph: "default", kind: "graph" };
    }
    if (!LEGACY_INSIDE_TOPS.has(top)) return { rescan: true }; // 迁移/新图目录出现
    return { rescan: false, graph: "default", kind: classifyInside(rest) };
  }

  // 多图布局
  if (!rest.includes("/")) {
    // .graph/ 顶层裸文件：active 变化 → 重扫（刷新列表 active 标记）；
    // 旧布局残留 graph.yaml 消失（迁移中）→ 重扫；其余工作区级文件忽略。
    if (rest === "active") return { rescan: true };
    if (rest === "graph.yaml" && event.type === "unlink") return { rescan: true };
    return null;
  }
  if (top.startsWith(".")) return null; // .trash/、.locks/ 等
  const inside = rest.slice(top.length + 1);
  // 建图（graph.yaml 落地）/删图（trash rename 触发 unlink）→ 图集合变化
  if (inside === "graph.yaml" && (event.type === "add" || event.type === "unlink")) {
    return { rescan: true };
  }
  if (WS_LEVEL_FILES.has(top)) return null;
  if (ctx.names.includes(top)) return { rescan: false, graph: top, kind: classifyInside(inside) };
  return { rescan: true }; // 未知一级目录：可能正在创建新图
}

/**
 * 邻接表 Map → 可 JSON 序列化的普通对象。
 * Map 直接 JSON.stringify 会变成 {}，MCP 侧用 Object.fromEntries，Web 侧保持一致。
 * 传入 rootDir（图目录）时附带图元信息（name/label/id/version，UI 展示用；读取失败静默降级）。
 */
export function serializeGraphIndex(index: GraphIndex, rootDir?: string, name?: string) {
  let meta: { name?: string; id?: string; label?: string; version?: string } = {};
  if (rootDir) {
    try {
      const g = readGraph(rootDir);
      meta = { id: g.id, label: g.label, version: g.version };
    } catch {
      /* graph.yaml 不可读：元信息留空 */
    }
  }
  return {
    name,
    ...meta,
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

    // S3-7：exists/stat/read 之间的删除/权限竞态不再抛进 http handler（曾可击穿整个 serve 进程）
    try {
      const st = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      let fallbackToIndex = false;
      if (!st || st.isDirectory()) {
        filePath = path.join(WEB_UI_DIR, "index.html");
        fallbackToIndex = true;
      }

      const ext = path.extname(filePath);
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
      };
      // 先读后写头：读取失败时 headers 尚未发出，catch 才能安全回 500
      // （writeHead 在读取之前的话，竞态抛错后再 writeHead(500) 会 ERR_HTTP_HEADERS_SENT）
      const data = fs.readFileSync(filePath);
      // 缓存加固（2026-08-28 边不可见排查）：此前无任何缓存头，长开标签页在
      // web-ui 重新构建后仍执行旧 bundle（SPA 不重载永不换 JS）。Vite 产物
      // 文件名带 content hash → 可 immutable 长缓存；index.html 等入口必须
      // no-cache（无 ETag/Last-Modified，revalidate 即全量重取）。
      // 404 fallback 到 index.html 时按入口对待（不能让 /assets/404 缓死 immutable）。
      const isHashedAsset =
        !fallbackToIndex &&
        /(^|\/)assets\/[^/]+-[0-9A-Za-z_-]{8,}\.(?:js|css)$/.test(decoded.replace(/\\/g, "/"));
      res.writeHead(200, {
        "Content-Type": mime[ext] ?? "application/octet-stream",
        "Cache-Control": isHashedAsset
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      res.end(data);
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
    } else {
      res.end(); // 头已发出：直接结束响应，不再重复写头
    }
  }
}

export function startServer(
  rootDir: string,
  port: number = 8934,
  options: { open?: boolean } = {},
) {
  // rootDir 兼容两种传法：工作区根（CLI serve 的 process.cwd()）或图目录
  // （workspaceOf 归一化到工作区根——多图服务必须以工作区为监听单位）
  const wsRoot = workspaceOf(rootDir);
  const graphsRoot = path.join(wsRoot, GRAPH_DIR);

  // 图名 → 图目录（旧布局 default 的目录 = .graph/ 原地）
  let graphEntries = new Map<string, string>();
  let legacyMode = false;

  function refreshGraphs(): void {
    legacyMode = fs.existsSync(path.join(graphsRoot, GRAPH_FILE));
    const names = listGraphNames(wsRoot);
    graphEntries = new Map(
      names.map((n) => [
        n,
        n === "default" && legacyMode ? graphsRoot : path.join(graphsRoot, n),
      ]),
    );
  }
  refreshGraphs();

  function buildGraphMeta(name: string): GraphMeta {
    const dir = graphEntries.get(name)!;
    let label: string | undefined;
    try {
      label = readGraph(dir).label;
    } catch {
      /* graph.yaml 不可读：label 留空 */
    }
    let nodes: ReturnType<typeof buildGraphIndex>["nodes"] = [];
    try {
      nodes = buildGraphIndex(dir, { useCache: true }).nodes;
    } catch {
      /* 图半删除/不可读（refreshGraphs 与 trash 并发）：空计数，下一轮列表自愈 */
    }
    const statuses: Record<string, number> = {};
    let lastActivity: string | null = null;
    for (const n of nodes) {
      statuses[String(n.status)] = (statuses[String(n.status)] ?? 0) + 1;
      if (n.updated_at && (!lastActivity || n.updated_at > lastActivity)) {
        lastActivity = n.updated_at;
      }
    }
    return { name, label, nodeCount: nodes.length, statuses, lastActivity };
  }

  function graphsPayload(): GraphsPayload {
    const active = readWorkspaceDefault(wsRoot);
    return { active, graphs: [...graphEntries.keys()].map(buildGraphMeta) };
  }

  /**
   * HTTP 查询目标图：?graph=<名> 指定；缺省 = toGraphDir 解析（active/唯一图/旧布局）。
   * apiRoot 是传给 core 函数（buildGraphIndex/readGraph/listSnapshots…）的实参：
   * 指定图时 = 图目录（真图目录含 graph.yaml，toGraphDir 原样通过）；
   * 缺省时 = 工作区根（core 内部自会降入图目录——未初始化工作区传 .graph/
   * 会被 toGraphDir 误拼成 .graph/.graph）。
   */
  function resolveGraphTarget(url: URL): { name: string; dir: string; apiRoot: string } | null {
    const q = url.searchParams.get("graph");
    if (q === null || q === "") {
      const dir = toGraphDir(wsRoot);
      for (const [name, d] of graphEntries) {
        if (path.resolve(d) === path.resolve(dir)) return { name, dir: d, apiRoot: wsRoot };
      }
      return { name: "default", dir, apiRoot: wsRoot };
    }
    const dir = graphEntries.get(q);
    return dir ? { name: q, dir, apiRoot: dir } : null;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const respondJson = (data: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const respondError = (status: number, message: string) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    };

    // 全部图的元信息（图选择器数据源）
    if (url.pathname === "/api/graphs") {
      refreshGraphs();
      respondJson(graphsPayload());
      return;
    }
    if (url.pathname === "/api/graph") {
      const target = resolveGraphTarget(url);
      if (!target) {
        respondError(404, `图 "${url.searchParams.get("graph")}" 不存在`);
        return;
      }
      // S2-9（f13）：启用索引缓存——与 watcher 推送路径同一 I/O 模型，
      // 连续 /api/graph 轮询不再全量扫盘；跨进程写由 isFresh 的 mtime 检查兜底
      respondJson(serializeGraphIndex(buildGraphIndex(target.apiRoot, { useCache: true }), target.apiRoot, target.name));
      return;
    }
    // 快照列表（UI diff 视图数据源；?graph=<名> 缺省 = active 图）
    if (url.pathname === "/api/snapshots") {
      try {
        const target = resolveGraphTarget(url);
        if (!target) {
          respondError(404, `图 "${url.searchParams.get("graph")}" 不存在`);
          return;
        }
        respondJson(listSnapshots(target.apiRoot));
      } catch (err: any) {
        // S0-5：内部错误脱敏——细节只进本机终端，不向客户端回显
        console.error("[serve] /api/snapshots failed:", err?.message);
        respondError(500, "内部错误（详见 serve 终端输出）");
      }
      return;
    }
    // 拓扑差异：?against=<snapshot-id>（缺省 = 最新快照 vs 当前工作区）
    if (url.pathname === "/api/diff") {
      try {
        const target = resolveGraphTarget(url);
        if (!target) {
          respondError(404, `图 "${url.searchParams.get("graph")}" 不存在`);
          return;
        }
        const against = url.searchParams.get("against") ?? undefined;
        let fromId: string | null = against ?? null;
        if (fromId === null) {
          const snaps = listSnapshots(target.apiRoot);
          fromId = snaps.length > 0 ? snaps[snaps.length - 1].id : null;
        }
        if (fromId === null) {
          respondJson({ error: "no snapshots" });
        } else {
          respondJson(diffSnapshot(target.apiRoot, fromId, null));
        }
      } catch (err: any) {
        // S0-5：内部错误脱敏——细节只进本机终端，不向客户端回显
        console.error("[serve] /api/diff failed:", err?.message);
        respondError(500, "内部错误（详见 serve 终端输出）");
      }
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
    // 连接建立：先推图列表（前端据此渲染选图器并选中 active），
    // 再推初始图（active，无 active 时第一张）的 full 快照；
    // 其余图由前端切换到时经 /api/graph?graph=<名> 懒加载。
    const payload = graphsPayload();
    ws.send(JSON.stringify({ type: "graphs:list", graph: "*", data: payload }));
    const initial =
      payload.active !== null && graphEntries.has(payload.active)
        ? payload.active
        : ([...graphEntries.keys()][0] ?? null);
    if (initial !== null) {
      const dir = graphEntries.get(initial)!;
      try {
        ws.send(
          JSON.stringify({
            type: "graph:full",
            graph: initial,
            // S2-9（f13）：初始推送同样走索引缓存（此前只有 watcher 推送用）
            data: serializeGraphIndex(buildGraphIndex(dir, { useCache: true }), dir, initial),
          }),
        );
      } catch {
        /* 图半初始化（graph.yaml 不可读）：跳过 full，等 watcher 推送 */
      }
    }
  });

  // 边/图/其他变更 → 按图 trailing debounce 合并突发（批操作/多次写只推一次全量），
  // 且全量重建走索引缓存（buildGraphIndex useCache），大图下不再每事件全量读盘。
  const FULL_BROADCAST_DEBOUNCE_MS = 250;
  const fullTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function scheduleFullBroadcast(graphName: string) {
    const prev = fullTimers.get(graphName);
    if (prev !== undefined) clearTimeout(prev);
    fullTimers.set(
      graphName,
      setTimeout(() => {
        fullTimers.delete(graphName);
        const dir = graphEntries.get(graphName);
        if (!dir || !fs.existsSync(path.join(dir, GRAPH_FILE))) return; // 图已删除：graphs:list 已接管
        broadcast({
          type: "graph:update",
          graph: graphName,
          data: serializeGraphIndex(buildGraphIndex(dir, { useCache: true }), dir, graphName),
        });
      }, FULL_BROADCAST_DEBOUNCE_MS),
    );
  }

  // 图集合变化（建图/删图/迁移/active 切换）→ 去抖重扫 + 广播图列表
  const RESCAN_DEBOUNCE_MS = 300;
  let rescanTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleGraphsRefresh() {
    if (rescanTimer !== null) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      refreshGraphs();
      broadcast({ type: "graphs:list", graph: "*", data: graphsPayload() });
    }, RESCAN_DEBOUNCE_MS);
  }

  const watcher = createWatcher(wsRoot, (event: FileChangeEvent) => {
    const route = routeGraphEvent(event, { names: [...graphEntries.keys()], legacy: legacyMode });

    if (route === null) return;
    if (route.rescan) {
      scheduleGraphsRefresh();
      return;
    }

    // 节点文件变更 → 增量推送该节点（带图名，前端路由到对应桶）
    if (route.kind === "node") {
      const dir = graphEntries.get(route.graph);
      if (!dir) return;
      const f = event.file.replace(/\\/g, "/");
      const nodeId = f
        .split("/")
        .pop()!
        .replace(/\.yaml$/, "")
        .replace(/\.deleted.*$/, "");
      // 软删除或 unlink 时节点可能不存在
      let node: ReturnType<typeof getNode> | null = null;
      try {
        node = getNode(dir, nodeId);
      } catch {
        /* 节点已删除 */
      }
      broadcast({
        type: "node:updated",
        graph: route.graph,
        nodeId,
        node,
        removed: node === null,
      });
      return;
    }

    // 边 / 图 / 其他变更 → 该图去抖后全量推送（低频事件，全量可接受）
    scheduleFullBroadcast(route.graph);
  });

  // 端口占用/监听错误必须友好处理（曾 unhandled 'error' event 裸崩溃）
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`❌ 端口 ${port} 已被占用，请用 -p 指定其他端口`);
      process.exit(1);
    }
    throw err;
  });

  // S0-5：本地开发工具显式绑定回环地址，不再默认暴露到局域网（0.0.0.0/::）
  server.listen(port, "127.0.0.1", () => {
    const addr = server.address();
    const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;
    const url = `http://localhost:${actualPort}`;
    const names = [...graphEntries.keys()];
    console.log(`🌐 拓扑图可视化服务: ${url}`);
    console.log(`📁 监控工作区: ${wsRoot}${names.length > 0 ? `（图: ${names.join(", ")}）` : "（无图）"}`);
    if (options.open !== false) openBrowser(url);
  });

  return { server, wss, watcher };
}
