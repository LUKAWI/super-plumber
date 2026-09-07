import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { WebSocket, WebSocketServer } from "ws";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1");
const DIST = join(ROOT, "web-ui", "dist");
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const samples = Number(process.env.PERF_SAMPLES || 20);
const interactionMs = Number(process.env.PERF_INTERACTION_MS || 5000);
const inputHz = Number(process.env.PERF_INPUT_HZ || 20);
const waitTimeoutMs = Number(process.env.PERF_WAIT_TIMEOUT_MS || 30000);
const baselinePath = join(ROOT, "tests", "web", "perf-webui-baseline.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

if (!existsSync(join(DIST, "index.html"))) throw new Error("web-ui/dist 不存在；请先运行 npm run build --prefix web-ui");
if (!existsSync(CHROME)) throw new Error(`Chrome 不存在：${CHROME}`);

function fixture() {
  const now = "2026-09-06T00:00:00.000Z";
  const nodes = Array.from({ length: 1000 }, (_, i) => ({
    id: `perf-node-${String(i).padStart(4, "0")}`,
    type: "task",
    label: `性能基准节点 ${i}`,
    level: i % 6,
    priority: i,
    status: i % 17 === 0 ? "running" : i % 5 === 0 ? "ready" : "pending",
    attempts: 0,
    max_attempts: 3,
    created_at: now,
    updated_at: now,
  }));
  const edgeCount = Math.max(0, Math.min(999, Number(process.env.PERF_EDGES ?? 999)));
  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    id: `perf-edge-${String(i).padStart(4, "0")}`,
    source: nodes[i].id,
    target: nodes[i + 1].id,
    type: "depends_on",
  }));
  const adjacency = Object.fromEntries(nodes.map((n, i) => [n.id, i < edgeCount ? [nodes[i + 1].id] : []]));
  const reverseAdj = Object.fromEntries(nodes.map((n, i) => [n.id, i > 0 && i <= edgeCount ? [nodes[i - 1].id] : []]));
  return { id: "perf-1k", name: "perf-1k", label: "WebUI deterministic 1k fixture", version: "1", nodes, edges, adjacency, reverseAdj };
}

const graph = fixture();
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/api/graph")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(graph));
    return;
  }
  if (req.url?.startsWith("/api/graphs")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ active: "perf-1k", graphs: [{ name: "perf-1k", label: graph.label, nodeCount: 1000 }] }));
    return;
  }
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let path = join(DIST, safe);
  if (!existsSync(path)) path = join(DIST, "index.html");
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
const wss = new WebSocketServer({ server });
wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "graphs:list", graph: "*", data: { active: "perf-1k", graphs: [{ name: "perf-1k", label: graph.label, nodeCount: 1000 }] } }));
  socket.send(JSON.stringify({ type: "graph:full", graph: "perf-1k", data: graph }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const profile = await mkdtemp(join(tmpdir(), "sp-webui-perf-"));
if (process.env.PERF_DEBUG) console.error("perf: server ready", port);
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore", windowsHide: true });

async function waitForFile(path, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (existsSync(path)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`等待文件超时：${path}`);
}
const activePort = join(profile, "DevToolsActivePort");
await waitForFile(activePort);
if (process.env.PERF_DEBUG) console.error("perf: chrome ready");
const [debugPort] = (await readFile(activePort, "utf8")).split(/\r?\n/);

async function openCdp() {
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  let nextId = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, send };
}

const { ws, send } = await openCdp();
if (process.env.PERF_DEBUG) console.error("perf: cdp connected");
await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 768, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  window.__perf = { readyAt: 0 };
  new MutationObserver(() => {
    if (!window.__perf.readyAt && document.querySelectorAll('.nodes > g.node').length === 1000) {
      window.__perf.readyAt = performance.now();
    }
  }).observe(document, { childList: true, subtree: true });
` });

async function evaluate(expression, awaitPromise = false) {
  const out = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.text || "Runtime.evaluate failed");
  return out.result.value;
}
async function waitFor(expression, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(expression)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`浏览器条件超时：${expression}`);
}
async function configure(cpuRate, reducedMotion) {
  await send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }] });
}
async function loadSample(i) {
  await send("Network.clearBrowserCache");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/?sample=${i}` });
  try {
    await waitFor("window.__perf && window.__perf.readyAt > 0", waitTimeoutMs);
  } catch (error) {
    const state = await evaluate(`({
      href: location.href,
      title: document.title,
      body: document.body?.innerText?.slice(0, 500),
      nodes: document.querySelectorAll('.nodes > g.node').length,
      svgs: document.querySelectorAll('svg').length,
      perf: window.__perf,
    })`);
    throw new Error(`${error.message}; page=${JSON.stringify(state)}`);
  }
  return evaluate(`({ readyMs: window.__perf.readyAt, nodes: document.querySelectorAll('.nodes > g.node').length })`);
}
async function interaction() {
  const before = await evaluate(`(() => {
    const svg = document.querySelector('svg.graph-canvas');
    const rect = svg?.getBoundingClientRect();
    const nodes = [...document.querySelectorAll('.nodes > g.node')];
    const point = nodes.map((node) => {
      const matrix = node.getScreenCTM?.();
      return matrix ? { x: matrix.e, y: matrix.f } : null;
    }).find((value) => value && rect && value.x >= rect.left && value.x <= rect.right && value.y >= rect.top && value.y <= rect.bottom);
    return { zoom: document.querySelector('.zoom-group')?.getAttribute('transform') ?? '', point, rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null };
  })()`);

  const measurement = evaluate(`new Promise((resolve) => {
    const frameTimes = [];
    const started = performance.now();
    function frame(now) {
      frameTimes.push(now);
      if (now - started < ${interactionMs}) requestAnimationFrame(frame);
      else {
        const elapsed = now - started;
        const deltas = frameTimes.slice(1).map((time, index) => time - frameTimes[index]);
        resolve({
          elapsedMs: elapsed,
          frames: frameTimes.length,
          fps: frameTimes.length * 1000 / elapsed,
          longFrames: deltas.filter((d) => d > 50).length,
          longFrameRatio: deltas.length ? deltas.filter((d) => d > 50).length / deltas.length : 0,
          maxFrameMs: deltas.length ? Math.max(...deltas) : 0,
          mediaReduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
          nodeCount: document.querySelectorAll('.nodes > g.node').length,
          edgeCount: document.querySelectorAll('.edges > g.edge-group').length,
        });
      }
    }
    requestAnimationFrame(frame);
  })`, true);

  let direction = 1;
  let inputEvents = 0;
  let inputError = null;
  const inputTimer = setInterval(() => {
    direction *= -1;
    inputEvents += 1;
    void send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 680,
      y: 380,
      deltaX: 0,
      deltaY: direction * 28,
    }).catch((error) => { inputError ??= error; });
  }, 1000 / inputHz);
  try {
    const result = await measurement;
    if (inputError) throw inputError;
    const afterWheel = await evaluate(`document.querySelector('.zoom-group')?.getAttribute('transform') ?? ''`);
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: before.rect.left + before.rect.width / 2,
      y: before.rect.top + before.rect.height / 2,
      deltaX: 0,
      deltaY: -36,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterExplicitWheel = await evaluate(`document.querySelector('.zoom-group')?.getAttribute('transform') ?? ''`);

    const centerX = before.rect.left + before.rect.width / 2;
    const centerY = before.rect.top + before.rect.height / 2;
    const beforePan = afterExplicitWheel;
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: centerX, y: centerY, button: "middle", buttons: 4, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: centerX + 24, y: centerY + 12, button: "none", buttons: 4 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: centerX + 24, y: centerY + 12, button: "middle", clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterPan = await evaluate(`document.querySelector('.zoom-group')?.getAttribute('transform') ?? ''`);
    const syntheticPan = await evaluate(`(() => {
      const svg = document.querySelector('svg.graph-canvas');
      if (!svg) return { changed: false };
      const before = document.querySelector('.zoom-group')?.getAttribute('transform') ?? '';
      const event = (type, x, y, buttons) => svg.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, button: 1, buttons, clientX: x, clientY: y,
        pointerId: 97, pointerType: 'mouse', isPrimary: true,
      }));
      event('pointerdown', ${centerX}, ${centerY}, 4);
      event('pointermove', ${centerX + 16}, ${centerY + 9}, 4);
      event('pointerup', ${centerX + 16}, ${centerY + 9}, 0);
      return { changed: before !== (document.querySelector('.zoom-group')?.getAttribute('transform') ?? '') };
    })()`);

    const nodeSelected = await evaluate(`(() => {
      const node = document.querySelector('.nodes > g.node');
      if (!node) return false;
      node.focus();
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const drawerOpened = nodeSelected && await evaluate(`Boolean(document.querySelector('.drawer.visible .entity-title'))`);
    const nodeInteractionLayerPresent = await evaluate(`Boolean(document.querySelector('.large-node-hit-layer'))`);
    return {
      ...result,
      inputHz,
      inputEvents,
      interactionContract: {
        zoomChanged: before.zoom !== afterWheel || afterWheel !== afterExplicitWheel,
        middlePanChanged: beforePan !== afterPan || syntheticPan.changed,
        nodeInteractionLayerPresent,
        nodeSelected: drawerOpened,
      },
    };
  } finally {
    clearInterval(inputTimer);
  }
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

const allModes = [
  { name: "benchmark-normal", cpuRate: 1, reducedMotion: false },
  { name: "low-end-normal", cpuRate: 4, reducedMotion: false },
  { name: "benchmark-reduced-motion", cpuRate: 1, reducedMotion: true },
];
const modes = process.env.PERF_MODE
  ? allModes.filter((mode) => mode.name === process.env.PERF_MODE)
  : allModes;
if (modes.length === 0) throw new Error(`未知 PERF_MODE：${process.env.PERF_MODE}`);
const results = [];
try {
  for (const mode of modes) {
    if (process.env.PERF_DEBUG) console.error("perf: mode", mode.name);
    await configure(mode.cpuRate, mode.reducedMotion);
    const firstScreen = [];
    for (let i = 0; i < samples; i++) {
      if (process.env.PERF_DEBUG) console.error("perf: sample", i);
      firstScreen.push(await loadSample(`${mode.name}-${i}`));
    }
    if (process.env.PERF_DEBUG) console.error("perf: interaction");
    const motion = await interaction();
    const timings = firstScreen.map((x) => x.readyMs);
    results.push({
      ...mode,
      firstScreen: { samples, p50Ms: percentile(timings, 0.5), p95Ms: percentile(timings, 0.95), minMs: Math.min(...timings), maxMs: Math.max(...timings) },
      interaction: motion,
      baseline: baseline[mode.name] ?? null,
      regression: baseline[mode.name]
        ? {
            fpsPercent: ((baseline[mode.name].fps - motion.fps) / baseline[mode.name].fps) * 100,
            firstScreenP95Percent: ((percentile(timings, 0.95) - baseline[mode.name].firstScreenP95Ms) / baseline[mode.name].firstScreenP95Ms) * 100,
          }
        : null,
    });
  }
  const regressionFailures = results.filter((row) => !row.reducedMotion && row.regression && row.regression.fpsPercent > 20);
  const absoluteFailures = results.filter((row) => {
    if (row.reducedMotion) return false;
    const fpsFloor = row.name === "low-end-normal" ? 40 : 50;
    return row.firstScreen.p95Ms > 1500 || row.interaction.fps < fpsFloor;
  });
  const interactionFailures = results.filter((row) => {
    const contract = row.interaction.interactionContract ?? {};
    if (row.name !== "benchmark-normal") return false;
    return !contract.zoomChanged || !contract.middlePanChanged || !contract.nodeInteractionLayerPresent || !contract.nodeSelected;
  });
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(),
    browser: "Google Chrome 152.0.7977.76 headless=new",
    device: { width: 1365, height: 768, deviceScaleFactor: 1 },
    fixture: { name: graph.name, nodes: graph.nodes.length, edges: graph.edges.length, deterministic: true },
    method: { firstScreen: "navigation start -> 1000th SVG node enters DOM", interaction: `CDP mouseWheel at fixed ${inputHz}Hz; rAF records timestamps only for ${interactionMs}ms`, longFrame: ">50ms", samples },
    thresholds: { firstScreenP95Ms: 1500, benchmarkFps: 50, lowEndFps: 40, regressionBudgetPercent: 20 },
    baseline,
    results,
    checks: {
      regressionBudgetPercent: 20,
      regressionFailures: regressionFailures.map((row) => row.name),
      absoluteFailures: absoluteFailures.map((row) => row.name),
      interactionFailures: interactionFailures.map((row) => row.name),
      ok: regressionFailures.length === 0 && absoluteFailures.length === 0 && interactionFailures.length === 0,
    },
  }, null, 2));
  if (regressionFailures.length > 0 || absoluteFailures.length > 0 || interactionFailures.length > 0) process.exitCode = 1;
} finally {
  ws.close();
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
  wss.close();
  server.close();
  try {
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    if (process.env.PERF_DEBUG) console.error("perf: temp profile cleanup skipped", error.code);
  }
}
