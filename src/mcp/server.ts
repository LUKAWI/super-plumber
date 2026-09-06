#!/usr/bin/env node
// src/mcp/server.ts
// Super Plumber MCP Server（stdio）— 27 个 graph_* 工具。
// 设计原则（agent 原生化）：
//   1. 设计期/执行期/裁决期全流程 MCP 覆盖（建图→调度→claim→checkpoint→report→verdict→验收）
//   2. zod 参数校验（缺参/非法枚举 → 协议错误），错误消息可读可自纠
//   3. 工具描述为决策导向（when to use / what it returns / side effects）
//   4. 只读输出稳定 JSON；写操作幂等（重复 id 报错、重复 claim 幂等成功）
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getNode,
  createNode as createNodeOp,
  createAdr,
  updateNodeStatus,
  updateCheckpoint,
  updateExecutionReport,
  updateNodeContent,
  buildNodeUpdates,
  checkReadyGate,
  getGoverningAdrs,
  reclaimNode,
  listNodes,
  type CreateNodeParams,
  type NodeUpdateParams,
} from "../core/node.js";
import { createEdge as createEdgeOp, listEdges } from "../core/edge.js";
import { readGraph } from "../core/parser.js";
import { deleteNode, deleteEdge, updateGraph, rebuildGraphRefs, approveGraph, graduateFog } from "../core/parser.js";
import { withGraphAmend, planAmendNudge } from "../core/amend.js";
import {
  buildGraphIndex,
  computeNextActions,
  computeNextActionsAll,
  surveyWorkspace,
  writeSurveyReport,
} from "../core/graph.js";
// arch-c3a：认领提示包 core 单源组装（arch-c2 落位 scheduler.ts——调度/旗标装配
// 与索引缓存分家后的新家）
import { buildClaimNudgePackage } from "../core/scheduler.js";
// F06（0.9.1 渐进审批）：requires_human 派生标注（get_node 读面透出用）
import { requiresHuman } from "../core/domain.js";
import { allowedTransitionsFor, aggregateCheckpointStatus } from "../core/state-machine.js";
// arch-c3b：validate 编排单源（与 CLI validate 同一入口，渠道只做呈现）
import { validateGraphDir } from "../core/validate.js";
import { NODE_ID_RE, GRAPH_CLASSES } from "../core/schema.js";
import { readEvents } from "../core/eventlog.js";
import {
  createSnapshot,
  diffSnapshot,
  rollbackToSnapshot,
  listSnapshots,
} from "../core/snapshot.js";
import {
  NodeType,
  NodeStatus,
  AdrStatus,
  EdgeType,
  isKnowledgeType,
  type EdgeSchema,
} from "../core/types.js";
import { listGraphNames, resolveGraphDir, didYouMean } from "../core/graph-dir.js";
// arch-c2 层次归位：旧布局目录判定与图摘要的实现单源已下沉 core/graph-summary.ts
// （graphDirOf/summarize）——此前 mcp → cli（graph-ops.ts）的引用是层次倒挂，
// 现与 CLI 同层消费 core 单源。
import { graphDirOf, summarize } from "../core/graph-summary.js";
import { VERSION } from "../version.js";

// ── 图目录定位（全局配置一次、随项目自动跟随）──
// 解析优先级（每次工具调用时求值，不锁死在启动瞬间）：
//   1. --root <dir> 参数 / SUPER_PLUMBER_ROOT 环境变量（固定覆盖，测试/单图用户用）
//   2. MCP workspace roots 协议：客户端上报当前项目根，取第一个含 .graph/ 的
//   3. 服务进程 cwd 向上逐级查找 .graph/graph.yaml（子目录里启动也能找到项目根）
//   4. 兜底返回 cwd 本身
// 定位到的目录若未初始化（无 .graph/graph.yaml）→ 报可读错误指引用户 graph init，
// 绝不静默返回空图。这样用户把 MCP 配置写进 agent 全局配置一次即可，换项目无需改配置。
function resolveFixedRoot(): string | null {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--root");
  if (idx !== -1 && argv[idx + 1]) return path.resolve(argv[idx + 1]);
  if (process.env.SUPER_PLUMBER_ROOT) {
    return path.resolve(process.env.SUPER_PLUMBER_ROOT);
  }
  return null;
}

const fixedRoot = resolveFixedRoot();

/** 从 start 向上查找最近的工作区（含 .graph/ 的目录——旧布局或多图均可）；找不到返回 null */
function findGraphRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".graph"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// v0.5.2：进程内 active 图（仅本 MCP server 进程——每个 agent 独立，互不影响工作区默认）。
// graph_switch 工具写它；graph_list_graphs/无参查询读它。
let processActiveGraph: string | null = null;

export function setProcessActiveGraph(name: string | null): void {
  processActiveGraph = name;
}

export function getProcessActiveGraph(): string | null {
  return processActiveGraph;
}

const ROOTS_TTL_MS = 5_000;
let rootsCache: { at: number; root: string | null } | null = null;

const server = new McpServer({
  name: "super-plumber",
  version: VERSION,
});

// S2-11（f11）：审计 actor 透传真实 agent 身份——取 MCP initialize 握手时客户端
// 上报的 client 名（如 claude-code / cursor / test），回落 "mcp"。此前所有写操作
// 硬编码 actor: "mcp"，多 agent 并发时审计日志无法区分行为主体。
function mcpActor(claimBy?: string): string {
  if (claimBy) return claimBy; // claim 语义：认领者身份优先
  try {
    return server.server.getClientVersion()?.name ?? "mcp";
  } catch {
    return "mcp";
  }
}

// v0.5.2：返回**图上下文**（dir/name/source）。优先级链与 CLI 一致：
// SUPER_PLUMBER_GRAPH 环境变量 > 进程内 active（graph_switch 设置）> .graph/active > default。
// MCP 不接受每次调用的 --graph 参数——进程用 graph_switch 切一次，后续调用全走它。
async function resolveGraphCtx(): Promise<{ dir: string; name: string; source: string; wsRoot: string }> {
  const root = await locateRoot();
  const names = listGraphNames(root);
  if (names.length === 0 && !fs.existsSync(path.join(root, ".graph", "graph.yaml"))) {
    throw new Error(
      `图目录未初始化：定位到 ${root}，但 .graph/ 下没有任何图。` +
        `请在该项目目录运行 graph init（CLI），或用 --root <dir> / ` +
        `SUPER_PLUMBER_ROOT 环境变量显式指定图所在目录。`,
    );
  }
  const r = resolveGraphDir(root, {
    env: process.env.SUPER_PLUMBER_GRAPH,
    processActive: processActiveGraph ?? undefined,
  });
  return { dir: r.dir, name: r.name, source: r.source, wsRoot: root };
}

async function locateRoot(): Promise<string> {
  if (fixedRoot) return fixedRoot;
  // 1. MCP roots（客户端支持时，短 TTL 缓存避免每次调用都往返）
  const now = Date.now();
  if (rootsCache && now - rootsCache.at < ROOTS_TTL_MS && rootsCache.root) {
    return rootsCache.root;
  }
  try {
    const res = await server.server.listRoots();
    for (const r of res.roots) {
      if (!r.uri.startsWith("file://")) continue;
      const dir = fileURLToPath(r.uri);
      const found = findGraphRoot(dir);
      if (found) {
        rootsCache = { at: now, root: found };
        return found;
      }
    }
    const first = res.roots.find((r) => r.uri.startsWith("file://"));
    if (first) {
      const dir = fileURLToPath(first.uri);
      rootsCache = { at: now, root: dir };
      return dir;
    }
  } catch {
    /* 客户端未实现 roots 能力 → 走 cwd 回退 */
  }
  // 2/3. 进程 cwd 向上查找（客户端在项目目录里拉起 server 时命中）
  return findGraphRoot(process.cwd()) ?? process.cwd();
}

// zod 4.x 中 z.nativeEnum deprecated，用 z.enum 显式枚举
// v0.5：status 合法值 = 工作流七态 ∪ ADR 三态（按顶点类型在 core 层分表校验）
const nodeStatusSchema = z.enum([
  ...Object.values(NodeStatus),
  ...Object.values(AdrStatus),
] as [string, ...string[]]);
const nodeTypeSchema = z.enum(Object.values(NodeType) as [string, ...string[]]);
const edgeTypeSchema = z.enum(Object.values(EdgeType) as [string, ...string[]]);
const cpStatusSchema = z.enum([
  "pending",
  "running",
  "passed",
  "failed",
  "skipped",
]);
const verdictSchema = z.enum(["pending", "passed", "failed"]);
const verifierSchema = z.enum(["auto", "cross_review", "human"]);

function jsonText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/**
 * v0.5.2 兜底②：跨图智能纠错——操作当前图不存在的节点/边 id 时扫描兄弟图，
 * 命中则在错误消息追加"它存在于图 X，请先 graph_switch"。仅错误路径触发（不碰热路径），
 * 提示自动、切换绝不自动。多图命中全部列出。
 */
async function hintMissing<T>(
  gctx: { wsRoot: string; name: string },
  ids: string[],
  fn: () => T,
): Promise<T> {
  try {
    return fn();
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    if (/not found|不存在/.test(msg)) {
      const siblings = listGraphNames(gctx.wsRoot).filter((n) => n !== gctx.name);
      if (siblings.length > 0) {
        const hits: string[] = [];
        for (const n of siblings) {
          const dir = graphDirOf(gctx.wsRoot, n); // S3-2（f14）：三处手写判定合一
          try {
            for (const node of listNodes(dir)) {
              if (ids.includes(node.id)) {
                hits.push(`图 ${n}（节点 ${node.id}: ${node.label}）`);
                break;
              }
            }
          } catch {
            /* 兄弟图不可读跳过 */
          }
        }
        if (hits.length > 0) {
          err.message = msg + ` ——它存在于 ${hits.join("、")}。如需操作请先 graph_switch 到对应图（提示不代切）`;
        }
      }
    }
    throw err;
  }
}

/** v0.5.2 兜底①：全部工具响应统一附 "graph": "<名>"——agent 每次调用可自验落点 */
function jsonGraph(gctx: { name: string }, data: unknown) {
  const body =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? { graph: gctx.name, ...(data as object) }
      : { graph: gctx.name, result: data };
  return jsonText(body);
}


// ════════════════════ v0.5.2 多图：切换与列举 ════════════════════

// arch-c2：图摘要消费 core/graph-summary.ts 的 summarize（唯一实现），此处只补
// MCP 特有的 isCurrent。（原 f14 金测对照的双通道等价已因单源下沉失去对照面，
// tests/f14-dedupe.test.ts 退役。）
function graphBriefOf(wsRoot: string, name: string, current: string) {
  return { ...summarize(wsRoot, name), isCurrent: name === current };
}

// ── F18（0.9.4）单行状态（graph status --oneline）的 MCP 承载 ──
// 旗标扩展纪律：不新增工具/命令条目——挂在既有读面 graph_list_graphs 的
// oneline 参数上（每份图摘要附加 oneline 字符串 + workflow 计数两个字段）。
// workflow 计数与 CLI status 同一单源（computeNextActions 的调度 summary：
// total + 七工作流态零填充，知识顶点不参与）；oneline 字面组装是呈现层，与
// src/cli/status.ts 的 formatOneline 逐字同构——文件边界（只许改 status/
// server.ts/tests/）不允许下沉 core，也不恢复 mcp → cli 层次倒挂 import，
// 双通道逐字等价由 tests/oneline.test.ts 金测锁定（同一图上 CLI stdout 行 ===
// MCP oneline 字段），改一侧必须同步另一侧。
function formatOneline(
  name: string,
  summary: Record<string, number> & { total: number },
): string {
  const passed = summary.passed ?? 0;
  const total = summary.total ?? 0;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  const parts = [
    `${name} ${passed}/${total} passed (${pct}%)`,
    `ready ${summary.ready ?? 0}`,
    `running ${summary.running ?? 0}`,
    `failed ${summary.failed ?? 0}`,
    `blocked ${summary.blocked ?? 0}`,
  ];
  if ((summary.cancelled ?? 0) > 0) parts.push(`cancelled ${summary.cancelled}`);
  return parts.join("｜");
}

function onelineExtras(dir: string, name: string) {
  const workflow = computeNextActions(dir).summary;
  return { oneline: formatOneline(name, workflow), workflow };
}

server.registerTool(
  "graph_switch",
  {
    description:
      "进程内切换目标图（不写 .graph/active；重启回工作区默认）。带 name 返回目标摘要与原图 running 提示；" +
      "不带 name 返回当前图及命中来源；不存在时报可用图与 did-you-mean。",
    inputSchema: {
      name: z.string().optional().describe("目标图名（缺省=查询当前图）"),
    },
  },
  async ({ name }) => {
    const gctx = await resolveGraphCtx();
    if (name === undefined) {
      return jsonGraph(gctx, {
        current: { name: gctx.name, dir: gctx.dir, source: gctx.source },
        available: listGraphNames(gctx.wsRoot),
        note: "带 name 参数执行切换；本进程 active 不落盘，重启回落 .graph/active",
      });
    }
    const names = listGraphNames(gctx.wsRoot);
    if (!names.includes(name)) {
      const hint = didYouMean(name, names);
      throw new Error(
        `图 "${name}" 不存在。可用: ${names.join(", ")}` +
          (hint.length ? `（你是想切 ${hint.join(" / ")} 吗？）` : ""),
      );
    }
    // 原图在途 running 提示（认领是节点级状态，切换不影响执行）
    let runningNote: string | undefined;
    if (gctx.name !== name) {
      try {
        const running = listNodes(gctx.dir).filter((n) => n.status === NodeStatus.Running).length;
        if (running > 0) runningNote = `原图 ${gctx.name} 有 ${running} 个 running 节点在途（切换不影响它们继续执行）`;
      } catch {
        /* 原图不可读则跳过提示 */
      }
    }
    setProcessActiveGraph(name);
    const brief = graphBriefOf(gctx.wsRoot, name, name);
    // S2-2（f11）：env 压制时如实上报——SUPER_PLUMBER_GRAPH 优先级高于进程内
    // active，此时 switch 不改变实际目标图，返回值不得假装切换成功
    const envName = process.env.SUPER_PLUMBER_GRAPH;
    const notes: string[] = [];
    if (runningNote) notes.push(runningNote);
    let effective = true;
    if (envName !== undefined && envName !== name) {
      effective = false;
      notes.push(
        `⚠️ 未生效：SUPER_PLUMBER_GRAPH=${envName} 环境变量优先级高于进程内切换，` +
          `本进程实际目标图仍是 ${envName}。清除该环境变量后 switch 才能生效。`,
      );
    } else if (envName === name) {
      notes.push(`SUPER_PLUMBER_GRAPH=${envName} 已固定该图，进程内切换与之一致。`);
    }
    return jsonText({
      graph: name,
      switched: { from: gctx.name, to: name, persistent: false, effective },
      summary: brief,
      ...(notes.length > 0 ? { notes } : {}),
    });
  },
);

server.registerTool(
  "graph_list_graphs",
  {
    description:
      "列出工作区图或详情：name/label/节点数/running/passed/最近活动/is_current；oneline=true 追加单行健康摘要与七态计数。" +
      "建图、删图、文档导出刻意不设 MCP 通道，工作区级破坏性操作走 CLI。",
    inputSchema: {
      name: z.string().optional().describe("图名（缺省列全部）"),
      oneline: z
        .boolean()
        .optional()
        .describe("附加单行状态摘要（F18 graph status --oneline 同款：oneline + workflow 字段）"),
    },
  },
  async ({ name, oneline }) => {
    const gctx = await resolveGraphCtx();
    const names = listGraphNames(gctx.wsRoot);
    if (names.length === 0) {
      throw new Error(`工作区 ${gctx.wsRoot} 没有任何图，请先 graph init <内容名>`);
    }
    if (name !== undefined) {
      if (!names.includes(name)) {
        const hint = didYouMean(name, names);
        throw new Error(
          `图 "${name}" 不存在。可用: ${names.join(", ")}` +
            (hint.length ? `（你是想查 ${hint.join(" / ")} 吗？）` : ""),
        );
      }
      return jsonGraph(gctx, {
        ...graphBriefOf(gctx.wsRoot, name, gctx.name),
        ...(oneline ? onelineExtras(graphDirOf(gctx.wsRoot, name), name) : {}),
      });
    }
    return jsonGraph(gctx, {
      current: gctx.name,
      graphs: names.map((n) => ({
        ...graphBriefOf(gctx.wsRoot, n, gctx.name),
        ...(oneline ? onelineExtras(graphDirOf(gctx.wsRoot, n), n) : {}),
      })),
    });
  },
);

// ════════════════════ 读取 ════════════════════

server.registerTool(
  "graph_get_node",
  {
    description:
      "读取节点完整内容及 allowed_transitions、checkpoint_aggregate、requires_human、ready_gate、governing_adrs；" +
      "include_neighbors=up/down 追加索引缓存中的邻居紧凑列表，替代局部 graph_traverse。",
    inputSchema: {
      id: z.string().describe("节点 ID"),
      include_neighbors: z
        .enum(["up", "down", "none"])
        .optional()
        .default("none")
        .describe("附加返回拓扑上游(up)/下游(down)相邻节点（紧凑字段）"),
    },
  },
  async ({ id, include_neighbors }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    const node = await hintMissing(gctx, [id], () => getNode(rootDir, id));
    const result: Record<string, unknown> = {
      node,
      allowed_transitions: allowedTransitionsFor(node),
      checkpoint_aggregate: node.checkpoints?.length
        ? aggregateCheckpointStatus(node.checkpoints)
        : null,
      // F06（0.9.1 渐进审批）：requires_human 派生标注（core/domain.ts 单源；
      // 仅真值出现，条件缺省同 adr_flags/review_flag）
      ...(requiresHuman(node.checkpoints) ? { requires_human: true } : {}),
      ready_gate: isKnowledgeType(node.type)
        ? { ok: true, unmet: [] }
        : checkReadyGate(rootDir, node.id),
      // v0.5：管辖 ADR 指针（知识顶点不适用）
      ...(isKnowledgeType(node.type)
        ? {}
        : (() => {
            const g = getGoverningAdrs(rootDir, id);
            return g.current.length > 0 || g.superseded.length > 0
              ? { governing_adrs: g }
              : {};
          })()),
    };
    if (include_neighbors !== "none") {
      const index = buildGraphIndex(rootDir, { useCache: true });
      const statusOf = new Map(index.nodes.map((n) => [n.id, n.status]));
      const compact = (ids: string[]) =>
        ids.map((nid) => ({
          id: nid,
          status: statusOf.get(nid) ?? "missing",
        }));
      if (include_neighbors === "up") {
        result.neighbors_up = compact(index.reverseAdj.get(id) ?? []);
      } else if (include_neighbors === "down") {
        result.neighbors_down = compact(index.adjacency.get(id) ?? []);
      }
    }
    return jsonGraph(gctx, result);
  },
);

server.registerTool(
  "graph_get_graph",
  {
    description:
      "读取节点、边与邻接表；默认 summary 仅返回紧凑节点/边字段，mode=full 返回完整节点。" +
      "offset/limit 分页（默认 200，共用节点/边窗口），返回 total、edge_total、nodes、edges、adjacency。",
    inputSchema: {
      mode: z
        .enum(["summary", "full"])
        .optional()
        .default("summary")
        .describe("summary=紧凑节点列表（默认）；full=完整节点内容"),
      offset: z.number().int().min(0).optional().default(0).describe("分页偏移（full 模式）"),
      limit: z.number().int().min(1).max(500).optional().default(200).describe("每页节点数"),
    },
  },
  async ({ mode, offset, limit }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    const index = buildGraphIndex(rootDir, { useCache: true });
    const page = index.nodes.slice(offset, offset + limit);
    const nodes =
      mode === "full"
        ? page
        : page.map((n) => ({
            id: n.id,
            label: n.label,
            status: n.status,
            type: n.type,
            level: n.level,
            assigned_to: n.assigned_to,
          }));
    // S3-14（f12）：edges 不再始终全量——同窗口分页（offset/limit 同时作用于
    // 节点与边），summary 模式紧凑化（id/source/target/type/rel_kind，剔除 contract）
    const edgePage = index.edges.slice(offset, offset + limit);
    const edges =
      mode === "full"
        ? edgePage
        : edgePage.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: e.type,
            ...(e.rel_kind !== undefined ? { rel_kind: e.rel_kind } : {}),
          }));
    return jsonGraph(gctx, {
      total: index.nodes.length,
      edge_total: index.edges.length,
      offset,
      limit,
      // F04（adr_0007）：雾区/工作类概要随图拓扑透出（图无则缺省；零门禁）
      ...(() => {
        try {
          const g = readGraph(rootDir);
          return {
            ...(g.fog !== undefined ? { fog: g.fog } : {}),
            ...(g.class !== undefined ? { class: g.class } : {}),
          };
        } catch {
          return {};
        }
      })(),
      nodes,
      edges,
      adjacency: Object.fromEntries(index.adjacency),
      reverseAdj: Object.fromEntries(index.reverseAdj),
    });
  },
);

server.registerTool(
  "graph_get_next_actions",
  {
    description:
      "调度前沿：ready、ready_eligible、blocked、running、stale_running；含 ADR 过时标记、human checkpoint/waiting_human、" +
      "死节点 attempts_exhausted/fallback_routes。支持 all_graphs 跨图只读聚合；各桶按 limit（默认 100）截断并标 truncated。",
    inputSchema: {
      stale_ms: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "running 节点无更新阈值（毫秒）；缺省基线 30 分钟，requires_human 节点默认放大 8 倍 = 4 小时（F07）；显式传值对全部节点生效",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .default(100)
        .describe("每个桶的最大条数"),
      assigned_to: z
        .string()
        .optional()
        .describe("仅返回该执行者的 running/stale 节点"),
      all_graphs: z
        .boolean()
        .optional()
        .default(false)
        .describe("跨图聚合只读前沿；不切换当前图"),
    },
  },
  async ({ stale_ms, limit, assigned_to, all_graphs }) => {
    const gctx = await resolveGraphCtx();
    if (all_graphs) {
      const graphs = computeNextActionsAll(gctx.wsRoot, {
        ...(stale_ms !== undefined ? { staleMs: stale_ms } : {}),
      }).map((r) => {
        const cap = <T>(list: T[]): T[] => list.slice(0, limit);
        const running = assigned_to
          ? r.running.filter((n) => n.assigned_to === assigned_to)
          : r.running;
        const stale = assigned_to
          ? r.stale_running.filter((n) => running.some((x) => x.id === n.id))
          : r.stale_running;
        return {
          graph: r.graph,
          label: r.label,
          ready: cap(r.ready),
          ready_eligible: cap(r.ready_eligible),
          blocked: cap(r.blocked),
          running: cap(running),
          stale_running: cap(stale),
          truncated: {
            ready: r.ready.length > limit,
            ready_eligible: r.ready_eligible.length > limit,
            blocked: r.blocked.length > limit,
            running: running.length > limit,
            stale_running: stale.length > limit,
          },
          ...(r.fog !== undefined ? { fog: r.fog } : {}),
          ...(r.class_nudge !== undefined ? { class_nudge: r.class_nudge } : {}),
          ...(r.fog_graduation_nudge !== undefined
            ? { fog_graduation_nudge: r.fog_graduation_nudge }
            : {}),
          summary: r.summary,
        };
      });
      return jsonText({ current: gctx.name, graphs });
    }

    const rootDir = gctx.dir;
    // F07：stale_ms 未显式给出时不透传（undefined）——core 缺省基线生效，
    // requires_human 节点享有人类节奏的放大阈值；显式传值则对全部节点生效
    const r = computeNextActions(rootDir, {
      ...(stale_ms !== undefined ? { staleMs: stale_ms } : {}),
    });
    const cap = <T>(list: T[]): T[] => list.slice(0, limit);
    const running = assigned_to
      ? r.running.filter((n) => n.assigned_to === assigned_to)
      : r.running;
    const stale = assigned_to
      ? r.stale_running.filter((n) =>
          running.some((x) => x.id === n.id),
        )
      : r.stale_running;
    return jsonGraph(gctx, {
      ready: cap(r.ready),
      ready_eligible: cap(r.ready_eligible),
      blocked: cap(r.blocked),
      running: cap(running),
      stale_running: cap(stale),
      truncated: {
        ready: r.ready.length > limit,
        ready_eligible: r.ready_eligible.length > limit,
        blocked: r.blocked.length > limit,
        running: running.length > limit,
        stale_running: stale.length > limit,
      },
      // F04（adr_0007）：雾区概要随调度结果透出（图无雾缺省；零门禁）
      ...(r.fog !== undefined ? { fog: r.fog } : {}),
      // v091（adr_0016）：雾/档矛盾 nudge 随调度结果透出（core 单源派生，透传不改写）
      ...(r.class_nudge !== undefined ? { class_nudge: r.class_nudge } : {}),
      // IL-025：雾可毕业 nudge 随调度结果透出（core 单源派生，透传不改写）
      ...(r.fog_graduation_nudge !== undefined
        ? { fog_graduation_nudge: r.fog_graduation_nudge }
        : {}),
      summary: r.summary,
    });
  },
);

server.registerTool(
  "graph_survey",
  {
    description:
      "多图工作区只读体检：逐图报告 blocked、stale running 与需要重审的 ADR 管辖冲突。结果写入系统临时目录，不改图、不切换 active；用于发现长期卡点并挑选后续 entry。",
    inputSchema: {
      stale_ms: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("running 节点无更新阈值（毫秒；缺省沿用 next 基线）"),
    },
  },
  async ({ stale_ms }) => {
    const gctx = await resolveGraphCtx();
    const report = surveyWorkspace(gctx.wsRoot, {
      ...(stale_ms !== undefined ? { staleMs: stale_ms } : {}),
    });
    const report_path = writeSurveyReport(report);
    return jsonText({ current: gctx.name, report_path, ...report });
  },
);

server.registerTool(
  "graph_traverse",
  {
    description:
      "从节点 DFS 遍历邻居，受 max_depth/max_nodes 双限；返回有序 nodes 与 truncated、truncated_by_depth、truncated_by_nodes。",
    inputSchema: {
      node_id: z.string(),
      direction: z
        .enum(["downstream", "upstream", "both"])
        .optional()
        .default("downstream"),
      max_depth: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(3)
        .describe("最大深度（默认3，上限50；深链图一次到末端请传足深度）"),
      max_nodes: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .default(200)
        .describe("返回节点数上限（防大图误爆上下文）"),
    },
  },
  async ({ node_id, direction, max_depth, max_nodes }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    const index = buildGraphIndex(rootDir, { useCache: true });
    // 起点不存在时明确报错（曾静默返回 [node_id] 误导 agent 以为节点存在）
    if (!index.adjacency.has(node_id)) {
      throw new Error(`Node ${node_id} not found`);
    }
    const visited = new Set<string>();
    const result: string[] = [];
    // IL-003：深度截断与节点数截断分开记账——此前深度截断被静默吞掉，
    // truncated 只看节点数上限，深链图丢失整段下游还虚报 truncated:false
    let truncatedByDepth = false;
    let truncatedByNodes = false;

    function dfs(nodeId: string, depth: number) {
      if (visited.has(nodeId)) return;
      if (depth > max_depth) {
        truncatedByDepth = true;
        return;
      }
      if (result.length >= max_nodes) {
        truncatedByNodes = true;
        return;
      }
      visited.add(nodeId);
      result.push(nodeId);
      if (direction === "downstream" || direction === "both") {
        for (const neighbor of index.adjacency.get(nodeId) ?? []) {
          dfs(neighbor, depth + 1);
        }
      }
      if (direction === "upstream" || direction === "both") {
        for (const neighbor of index.reverseAdj.get(nodeId) ?? []) {
          dfs(neighbor, depth + 1);
        }
      }
    }
    dfs(node_id, 0);
    return jsonGraph(gctx, {
      nodes: result,
      truncated: truncatedByDepth || truncatedByNodes,
      truncated_by_depth: truncatedByDepth,
      truncated_by_nodes: truncatedByNodes,
    });
  },
);

server.registerTool(
  "graph_search",
  {
    description:
      "按 query/status/type/assigned_to/level 过滤节点，命中索引缓存；返回紧凑 nodes、total、limit。",
    inputSchema: {
      query: z.string().optional(),
      status: nodeStatusSchema.optional(),
      type: nodeTypeSchema.optional(),
      assigned_to: z.string().optional(),
      level: z.number().int().optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(50)
        .describe("返回条数上限（默认 50，最大 200）"),
    },
  },
  async ({ query, status, type, assigned_to, level, limit }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    // S2-8（f12）：与 graph_get_graph 同一 I/O 模型——命中索引缓存，
    // 重复查询不再全量读盘（此前 listNodes 逐文件读 + schema 校验）
    const nodes = buildGraphIndex(rootDir, { useCache: true }).nodes;
    const filtered = nodes.filter((n) => {
      if (query && !n.id.includes(query) && !n.label.includes(query)) return false;
      if (status && n.status !== status) return false;
      if (type && n.type !== type) return false;
      if (assigned_to && n.assigned_to !== assigned_to) return false;
      if (level !== undefined && n.level !== level) return false;
      return true;
    });
    return jsonGraph(gctx, {
      total: filtered.length,
      limit,
      nodes: filtered.slice(0, limit).map((n) => ({
        id: n.id,
        label: n.label,
        status: n.status,
        type: n.type,
        level: n.level,
        assigned_to: n.assigned_to,
      })),
    });
  },
);

// S0-3：实体 ID zod 收紧——LLM 供给的 ID 在协议层即拒（防路径穿越 confused-deputy）
const entityIdSchema = (what: string) =>
  z
    .string()
    .regex(NODE_ID_RE, `${what} ID 规则: ^[a-z0-9][a-z0-9._-]{0,63}$（小写字母/数字开头，禁路径分隔符/冒号/大写）`);

server.registerTool(
  "graph_validate",
  {
    description:
      "校验 schema、幽灵边、循环/隐藏 fan 环、六条领域规则、文案 lint 与 graph.yaml 双向漂移；适合批量/手编后自检。" +
      "返回 ok、errors、warnings、node_count、edge_count；warning 不改变退出语义。",
    inputSchema: {},
  },
  async () => {
    const gctx = await resolveGraphCtx();
    // arch-c3b：编排与文案正文全部在 core/validate.ts 单源（与 CLI validate 同一入口），
    // 本工具只做呈现——五字段 JSON，ok 语义不变（= errors 为空，结构问题才置 false）
    const r = validateGraphDir(gctx.dir);
    return jsonGraph(gctx, {
      ok: r.ok,
      errors: r.errors,
      warnings: r.warnings,
      node_count: r.node_count,
      edge_count: r.edge_count,
    });
  },
);

server.registerTool(
  "graph_events",
  {
    description:
      "读取 events.jsonl 审计日志，支持 node/kind/last 过滤；返回 total、count、events。",
    inputSchema: {
      node: entityIdSchema("节点").optional().describe("按节点 id 过滤"),
      kind: z.string().optional().describe("按事件类型过滤（如 force_override / attempts_reset / node_status）"),
      last: z.number().int().min(1).max(1000).optional().describe("只取最近 N 条"),
    },
  },
  async ({ node, kind, last }) => {
    const gctx = await resolveGraphCtx();
    const events = readEvents(gctx.dir, {
      ...(node !== undefined ? { node } : {}),
      ...(kind !== undefined ? { kind } : {}),
    });
    const sliced = last !== undefined ? events.slice(-last) : events;
    return jsonGraph(gctx, {
      total: events.length,
      count: sliced.length,
      events: sliced,
    });
  },
);

// ════════════════════ 创建 ════════════════════

// S2-1（f10）：MCP 通道补 graph_validate / graph_events——批量创建指引"崩溃后重跑"
// 但 agent 此前无任何自检手段；审计日志（force_override/attempts_reset 等）只能 CLI 看。
// arch-c3b：validate 编排已下沉 core/validate.ts 单源，CLI 与 MCP 双渠道消费同一入口，
// 不再双写编排与文案（曾经的"同构"双实现已发生文案漂移，归一后渠道只加前缀不改写）。

const checkpointSchema = z.object({
  // S3-12：与 CLI 对齐——空 id/label 使 checkpoint 无法被 update_checkpoint
  // 寻址（id）或读报告（label），协议层即拒
  id: z.string().min(1),
  label: z.string().min(1),
  status: cpStatusSchema.optional().default("pending"),
  verifier: verifierSchema.optional().default("auto"),
});

// C6：单节点与批量创建共用同一份节点输入声明，避免字段链路漂移。
const nodeInputSchema = z.object({
  id: entityIdSchema("节点").describe("节点 ID"),
  label: z.string().describe("节点标签"),
  type: nodeTypeSchema.optional().default(NodeType.Task),
  level: z.number().int().optional().default(1),
  priority: z.number().int().min(0).optional().describe("调度优先级（越小越先；缺省最低）"),
  context: z.string().optional().describe("v0.5：归属的 context 顶点 id（工作流节点用）"),
  plan_description: z.string().optional().describe("构建计划描述"),
  definition_of_done: z.array(z.string()).optional().describe("完成标准条目"),
  checkpoints: z.array(checkpointSchema).optional().describe("子步骤检查点"),
  assigned_to: z.string().optional(),
  max_attempts: z.number().int().min(0).optional().default(3).describe("最大重试次数（0=不限）"),
});

server.registerTool(
  "graph_create_node",
  {
    description:
      "创建 pending 节点；可一次提交 plan、DoD、checkpoints、context 等完整压缩包。" +
      "context 是领域文档，adr 建议用 graph_create_adr；重复 id 拒绝覆盖。",
    inputSchema: nodeInputSchema.shape,
  },
  async ({ id, label, type, level, priority, context, plan_description, definition_of_done, checkpoints, assigned_to, max_attempts }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    const node = createNodeOp(rootDir, {
      id,
      label,
      type: type as NodeType,
      level,
      priority,
      ...(context !== undefined ? { context } : {}),
      plan_description,
      definition_of_done,
      checkpoints: checkpoints as CreateNodeParams["checkpoints"],
      assigned_to,
      max_attempts,
    }, { actor: mcpActor() });
    return jsonGraph(gctx, node);
  },
);

server.registerTool(
  "graph_create_adr",
  {
    description:
      "创建自动编号 adr_NNNN 的 proposed ADR；用 graph_add_edge 添加 decides 管辖边。" +
      "accept/supersede 由裁决方/人类处理；适合记录难逆转且有真实权衡的决策。",
    inputSchema: {
      title: z.string().describe("决策标题（落 label）"),
      decision: z.string().describe("决策内容（我们决定了什么）"),
      background: z.string().optional().describe("背景（决策时的上下文）"),
      considered_options: z.string().optional().describe("考虑过的备选项与取舍"),
      why: z.string().optional().describe("为什么选这个"),
      consequences: z.string().optional().describe("后果与代价"),
    },
  },
  async ({ title, decision, background, considered_options, why, consequences }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    const adr = createAdr(
      rootDir,
      {
        title,
        decision,
        ...(background !== undefined ? { background } : {}),
        ...(considered_options !== undefined ? { considered_options } : {}),
        ...(why !== undefined ? { why } : {}),
        ...(consequences !== undefined ? { consequences } : {}),
      },
      { actor: mcpActor() },
    );
    return jsonGraph(gctx, adr);
  },
);

const batchEdgeSchema = z.object({
  id: entityIdSchema("边"),
  source: entityIdSchema("边 source"),
  target: entityIdSchema("边 target"),
  // IL-011：type 可省略，缺省 depends_on（与 CLI add-edge 既有默认对齐，双通道一致化）
  type: edgeTypeSchema
    .default("depends_on")
    .describe("边类型；缺省 depends_on——特殊边（decides/relates/shares_context）语义真有时才显式写"),
  rel_kind: z.string().optional(),
  contract: z.record(z.string(), z.unknown()).optional(),
});

server.registerTool(
  "graph_batch_create",
  {
    description:
      "批量创建节点/边，先整体校验并一次报告重复 id、幽灵引用；边 type 缺省 depends_on。" +
      "非跨文件事务，失败后按冲突修复并重跑。",
    inputSchema: {
      nodes: z.array(nodeInputSchema).optional().default([]),
      edges: z.array(batchEdgeSchema).optional().default([]),
    },
  },
  async ({ nodes, edges }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    // 1. 全量预校验：报出全部冲突，不写盘
    const existingNodeIds = new Set(listNodes(rootDir).map((n) => n.id));
    const existingEdgeIds = new Set(listEdges(rootDir).map((e) => e.id));
    const conflicts: string[] = [];
    const newIds = new Set<string>();
    for (const n of nodes) {
      if (newIds.has(n.id) || existingNodeIds.has(n.id)) {
        conflicts.push(`Node ${n.id} already exists`);
      }
      newIds.add(n.id);
    }
    const edgeIds = new Set<string>();
    for (const e of edges) {
      if (edgeIds.has(e.id) || existingEdgeIds.has(e.id)) {
        conflicts.push(`Edge ${e.id} already exists`);
      }
      edgeIds.add(e.id);
      if (!newIds.has(e.source) && !existingNodeIds.has(e.source)) {
        conflicts.push(`Edge ${e.id}: source node ${e.source} not found`);
      }
      if (!newIds.has(e.target) && !existingNodeIds.has(e.target)) {
        conflicts.push(`Edge ${e.id}: target node ${e.target} not found`);
      }
    }
    if (conflicts.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: false, conflicts }, null, 2),
          },
        ],
        isError: true,
      };
    }

    // 2. 写盘（跳过逐次引用同步，最后一次性重建 graph.yaml 引用列表：O(n²) → O(n)）
    // F21 (a)(b)（DEC-7 / adr_0006；0.9.2 C5 组合器收拢布线）：batch_create 是一次
    // 结构修订——withGraphAmend 整批统一守卫一次（落盘前自动快照 + 成功后
    // graph_amended 事件/review 回置），fn 内逐节点/边调用同图嵌套自动免守卫，
    // 防一次批量操作产生 N+M 份快照。预校验失败路径（上方 conflicts 早退）不守卫
    // ——未落图的修订不留凭据。
    withGraphAmend(
      rootDir,
      {
        action: "batch-create",
        detail: `nodes=${nodes.length}, edges=${edges.length}`,
        actor: mcpActor(),
      },
      () => {
        for (const n of nodes) {
          createNodeOp(
            rootDir,
            {
              id: n.id,
              label: n.label,
              type: n.type as NodeType,
              level: n.level,
              priority: n.priority,
              ...(n.context !== undefined ? { context: n.context } : {}),
              plan_description: n.plan_description,
              definition_of_done: n.definition_of_done,
              checkpoints: n.checkpoints as CreateNodeParams["checkpoints"],
              assigned_to: n.assigned_to,
              max_attempts: n.max_attempts,
            },
            { syncRef: false, actor: mcpActor() },
          );
        }
        for (const e of edges) {
          createEdgeOp(
            rootDir,
            {
              id: e.id,
              source: e.source,
              target: e.target,
              type: e.type as EdgeType,
              ...(e.rel_kind !== undefined ? { rel_kind: e.rel_kind } : {}),
              ...(e.contract !== undefined ? { contract: e.contract as EdgeSchema["contract"] } : {}),
            },
            { syncRef: false, actor: mcpActor() },
          );
        }
        rebuildGraphRefs(rootDir);
      },
    );
    return jsonGraph(gctx, { ok: true, nodes: nodes.length, edges: edges.length });
  },
);

server.registerTool(
  "graph_add_edge",
  {
    description:
      "添加类型化边，type 缺省 depends_on。depends_on/validates 参与拓扑与门禁，fan_* 仅门禁；" +
      "shares_context 不门禁，fallback 已有最小读语义但不排序（死节点可提供 fallback_routes），" +
      "iterates 仍为**文档性标注**；decides/relates 为知识边。跨 context 边须 contract 或默认契约，" +
      "缺失时 graph validate 警告；两端点须存在，重复 id 报错。",
    inputSchema: {
      id: entityIdSchema("边"),
      source: entityIdSchema("边 source"),
      target: entityIdSchema("边 target"),
      // IL-011：type 可省略，缺省 depends_on（与 CLI add-edge 既有默认对齐，双通道一致化）
      type: edgeTypeSchema
        .default("depends_on")
        .describe("边类型；缺省 depends_on——特殊边（decides/relates/shares_context）语义真有时才显式写"),
      rel_kind: z.string().optional().describe("v0.5：relates 边的领域关系标注（自由文本）"),
      contract: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('契约（跨 context 工作流边必填）：{"produces":"...","consumed_by":[...],"validation":{...}}'),
    },
  },
  async ({ id, source, target, type, rel_kind, contract }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    const edge = await hintMissing(gctx, [source, target], () =>
      createEdgeOp(rootDir, {
        id,
        source,
        target,
        type: type as EdgeType,
        ...(rel_kind !== undefined ? { rel_kind } : {}),
        ...(contract !== undefined ? { contract: contract as EdgeSchema["contract"] } : {}),
      }, { actor: mcpActor() }),
    );
    return jsonGraph(gctx, edge);
  },
);

// ════════════════════ 更新 ════════════════════

server.registerTool(
  "graph_update_node",
  {
    description:
      "更新 plan/DoD/checkpoints/assigned_to/label/max_attempts/context 等；执行期优先用 checkpoint/report。" +
      "attempts 不会因改 plan 自动清零，需显式 reset_attempts；支持 context boundary、glossary、contracts。",
    inputSchema: {
      id: z.string(),
      plan_description: z.string().optional(),
      add_dod: z.array(z.string()).optional().describe("追加完成标准条目"),
      clear_dod: z.boolean().optional().describe("清空完成标准"),
      add_checkpoints: z.array(checkpointSchema).optional().describe("追加检查点"),
      set_assigned_to: z.string().optional(),
      label: z.string().optional(),
      max_attempts: z.number().int().min(0).optional(),
      set_priority: z.number().int().min(0).optional().describe("调度优先级（越小越先）"),
      set_context: z.string().optional().describe('v0.5：归属 context 顶点 id（空串 "" 清除归属）'),
      boundary: z.string().optional().describe("v0.5（context 顶点）：上下文边界描述"),
      glossary_add: z
        .array(z.object({ term: z.string(), definition: z.string() }))
        .optional()
        .describe("v0.5（context 顶点）：追加术语 [{term, definition}]"),
      contract_add: z
        .array(
          z.object({
            to: z.string().describe("目标 context id（跨 context 边 target 所在 context）"),
            contract: z
              .record(z.string(), z.unknown())
              .describe('默认契约（形状同边 contract）：{"produces":"...","consumed_by":[...],"validation":{...}}'),
          }),
        )
        .optional()
        .describe(
          "IL-012（context 顶点）：追加对其他 context 的默认契约声明 [{to, contract}]——跨 context 工作流边自动继承，单边 contract 仍可覆写",
        ),
      superseded_by: z
        .string()
        .optional()
        .describe("v0.5（adr 顶点）：接替 ADR id——MCP supersede 两步法第一步（先设此字段，再 graph_update_node_status 置 superseded）"),
      reset_attempts: z
        .boolean()
        .optional()
        .default(false)
        .describe("显式把 attempts 重置为 0（写审计事件；修改 plan 不再自动重置）"),
    },
  },
  async ({ id, plan_description, add_dod, clear_dod, add_checkpoints, set_assigned_to, label, max_attempts, set_priority, set_context, boundary, glossary_add, contract_add, superseded_by, reset_attempts }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    const node = await hintMissing(gctx, [id], () => getNode(rootDir, id));
    const updates = buildNodeUpdates(node, {
      ...(plan_description !== undefined ? { plan_description } : {}),
      ...(add_dod ? { add_dod } : {}),
      ...(clear_dod ? { clear_dod } : {}),
      ...(add_checkpoints ? { add_checkpoints: add_checkpoints as NodeUpdateParams["add_checkpoints"] } : {}),
      ...(set_assigned_to !== undefined ? { set_assigned_to } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(max_attempts !== undefined ? { max_attempts } : {}),
      ...(set_priority !== undefined ? { set_priority } : {}),
      ...(set_context !== undefined ? { set_context } : {}),
      ...(boundary !== undefined ? { boundary } : {}),
      ...(glossary_add !== undefined ? { glossary_add } : {}),
      ...(contract_add !== undefined ? { contract_add: contract_add as NodeUpdateParams["contract_add"] } : {}),
      ...(superseded_by !== undefined ? { superseded_by } : {}),
    });
    if (Object.keys(updates).length === 0 && !reset_attempts) {
      throw new Error("没有指定任何更新项（至少传一个可选参数）");
    }
    // F21 (c)（DEC-7 / adr_0006）：改 passed/blocked 节点 plan 的响应 nudge——
    // 纯提示不改状态、不拦截写操作；与 CLI update-node 共用同一实现（双通道一致）。
    // node 为更新前快照：nudge 判据 = 更新前状态 + 本次请求是否涉及 plan。
    const nudge = planAmendNudge(node, { planChanged: plan_description !== undefined });
    const updated = updateNodeContent(rootDir, id, updates, {
      actor: mcpActor(),
      ...(reset_attempts ? { resetAttempts: true } : {}),
    });
    return jsonGraph(gctx, nudge ? { ...updated, plan_amend_nudge: nudge } : updated);
  },
);

server.registerTool(
  "graph_update_node_status",
  {
    description:
      "更新状态并强制 ready 前置门禁/max_attempts；ready→running 传 claim_by 记录 owner/时间，重复 claim 幂等。" +
      "MCP 禁 force，人工用 CLI --force；ADR 为 proposed→accepted→superseded，context 不可变更。",
    inputSchema: {
      id: z.string(),
      status: nodeStatusSchema,
      claim_by: z
        .string()
        .optional()
        .describe("认领者（执行 agent 名），status=running 时传"),
      force: z
        .boolean()
        .optional()
        .default(false)
        .describe("已废弃：MCP 通道一律拒绝 force（仅 CLI 人类运维通道可用）"),
    },
  },
  async ({ id, status, claim_by, force }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    // FIX-A1（评审 A 级·信任模型）：MCP 是 agent 通道，force 在协议层面拒绝。
    // 保留 zod 形参以显式报错（剥离未知键会变成静默忽略，更危险）。
    if (force) {
      throw new Error(
        "force 仅人类运维通道（CLI: graph update-status --force）可用，MCP 拒绝执行。" +
          "若你是执行 agent：请按状态机/门禁规则走合法转换，不要绕过。",
      );
    }
    const node = await hintMissing(gctx, [id], () =>
      updateNodeStatus(rootDir, id, status as NodeStatus, claim_by, {
        actor: mcpActor(claim_by), // S2-11：claim 审计 actor = 认领者身份
      }),
    );
    // v0.5：claim（→running）响应附管辖 ADR 指针——agent 此刻最需要知道"依据哪些决策干活"
    // arch-c3a：提示包改由 core 单源组装（buildClaimNudgePackage：governing_adrs /
    // adr_flags / review_flag / requires_human），渠道只渲染、不改写。
    // 响应透出 governing_adrs / review_flag / requires_human（F06 接线：含未完成
    // human checkpoint 的票在 claim 响应提示认领者；adr_flags 随调度面各桶透出）。
    // DEC-1：图有 review 凭据时 review_flag 不出现。仅提示、零门禁——claim 不因此被拒绝。
    if (node.status === NodeStatus.Running && !isKnowledgeType(node.type)) {
      const pkg = buildClaimNudgePackage(rootDir, id);
      const extra: Record<string, unknown> = {};
      if (pkg.governing_adrs !== undefined) extra.governing_adrs = pkg.governing_adrs;
      if (pkg.review_flag !== undefined) extra.review_flag = pkg.review_flag;
      if (pkg.requires_human !== undefined) extra.requires_human = pkg.requires_human;
      if (Object.keys(extra).length > 0) {
        return jsonGraph(gctx, { node, ...extra });
      }
    }
    return jsonGraph(gctx, node);
  },
);

server.registerTool(
  "graph_reclaim_node",
  {
    description:
      "回收死认领 running→pending，清空 owner，保留 attempts 并写回收审计；仅 stale running 可回收，之后可重新认领。",
    inputSchema: {
      id: z.string().describe("节点 ID"),
      by: z.string().optional().describe("回收操作者（写入回收记录）"),
    },
  },
  async ({ id, by }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    return jsonGraph(gctx, await hintMissing(gctx, [id], () => reclaimNode(rootDir, id, by ?? "mcp")));
  },
);

server.registerTool(
  "graph_update_checkpoint",
  {
    description:
      "上报 checkpoint（不改节点状态）；按 pending→running/passed/failed/skipped、running→passed/failed、passed/failed→pending 校验。" +
      "重复同状态幂等，边做边报。",
    inputSchema: {
      node_id: z.string(),
      checkpoint_id: z.string(),
      status: cpStatusSchema,
    },
  },
  async ({ node_id, checkpoint_id, status }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    return jsonGraph(gctx, await hintMissing(gctx, [node_id], () =>
      updateCheckpoint(rootDir, node_id, checkpoint_id, status, { actor: mcpActor() }),
    ));
  },
);

server.registerTool(
  "graph_update_execution_report",
  {
    description:
      "填写执行报告供裁决抽查；artifacts 逐路径返回 artifacts_check: [{path, exists}]（只核存在，不代表内容正确）。" +
      "checkpoint 聚合与产物抽查后可写 verification {verdict,note}。",
    inputSchema: {
      node_id: z.string(),
      summary: z.string(),
      artifacts: z.array(z.string()).optional(),
      blockers: z.array(z.string()).optional(),
      notes: z.string().optional(),
      verification: z
        .object({ verdict: verdictSchema, note: z.string().optional() })
        .optional(),
    },
  },
  async ({ node_id, summary, artifacts, blockers, notes, verification }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    const node = await hintMissing(gctx, [node_id], () =>
      updateExecutionReport(rootDir, node_id, {
        summary,
        artifacts,
        blockers,
        notes,
        ...(verification
          ? {
              verification: {
                verdict: verification.verdict,
                checked_at: new Date().toISOString(),
                ...(verification.note ? { note: verification.note } : {}),
              },
            }
          : {}),
      }, { actor: mcpActor() }),
    );
    // S0-4：artifacts 存在性如实核验并写入响应（相对路径按工作区根解析）。
    // 只核存在性不代验内容——裁决方据此决定是否抽查。
    const artifactsCheck = (artifacts ?? []).map((p) => {
      const abs = path.isAbsolute(p) ? p : path.resolve(gctx.wsRoot, p);
      return { path: p, exists: fs.existsSync(abs) };
    });
    return jsonGraph(gctx, {
      ...node,
      ...(artifactsCheck.length > 0 ? { artifacts_check: artifactsCheck } : {}),
    });
  },
);

server.registerTool(
  "graph_update_graph",
  {
    description:
      "编辑 label/entry/exit/acceptance_criteria/root_context/fog/class；用于填写人类入口与验收标准，不要手改 graph.yaml。" +
      "acceptance_criteria 是最终三层验收真相；fog 用 graph_graduate_fog 毕业。",
    inputSchema: {
      label: z.string().optional(),
      entry_description: z.string().optional(),
      exit_description: z.string().optional(),
      add_criteria: z.array(z.string()).optional().describe("追加验收标准"),
      clear_criteria: z.boolean().optional().describe("清空验收标准"),
      root_context: z.record(z.string(), z.unknown()).optional(),
      fog: z
        .object({
          id: z.string().min(1).describe("雾区标识（非节点 id，如 release-automation）"),
          description: z.string().min(1).describe("哪里模糊、为什么暂时不展开"),
          graduation: z.string().min(1).describe("毕业条件：怎样算想清楚了"),
          ignited: z.array(z.string()).optional().describe("已点火的 research 票节点 id（字段承载，不建边）"),
        })
        .optional()
        .describe("登记/更新雾区（整体 upsert；F04 adr_0007）"),
      class: z
        .enum(GRAPH_CLASSES) // arch-c4a：枚举单源消费（core/schema.ts），不再重写字面量
        .optional()
        .describe("工作类标注（DEC-2；F08 渐进审批仅对 program 生效）"),
      by: z
        .string()
        .optional()
        .describe('class 变更的操作者凭据（缺省 "agent"）；用户直发凭据（/plumber-class 或对话批准）时传 "user"——血统落 class_changed 事件，雾/档矛盾提示据此静默'),
    },
  },
  async ({ label, entry_description, exit_description, add_criteria, clear_criteria, root_context, fog, class: graphClass, by }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    return jsonGraph(gctx,
      updateGraph(rootDir, {
        ...(label !== undefined ? { label } : {}),
        ...(entry_description !== undefined ? { entry_description } : {}),
        ...(exit_description !== undefined ? { exit_description } : {}),
        ...(add_criteria ? { add_criteria } : {}),
        ...(clear_criteria ? { clear_criteria } : {}),
        ...(root_context !== undefined ? { root_context } : {}),
        ...(fog !== undefined ? { fog } : {}),
        ...(graphClass !== undefined ? { class: graphClass } : {}),
        ...(by !== undefined ? { by } : {}),
      }),
    );
  },
);

// F05（adr_0007，0.9.0）：雾区毕业（MCP 通道）。与 CLI graduate-fog 共用核心原语
// graduateFog——清除 fog 字段 + fog_graduated 专用事件 + DEC-7 amend 守卫
// （自动快照 + graph_amended + review 回置）。无雾时报错（毕业是事实陈述）。
server.registerTool(
  "graph_graduate_fog",
  {
    description:
      "毕业图级 fog：清除 fog 并写 fog_graduated 审计事件，带 produced/reason；无 fog 报错。" +
      "与 CLI graph graduate-fog 双通道同源。",
    inputSchema: {
      produced: z
        .array(z.string())
        .optional()
        .describe("毕业产物节点 id 列表（雾想清楚后落成的票/决议，进事件 payload 可追溯）"),
      reason: z.string().optional().describe("毕业理由/结论摘要（审计凭据，缺省不写）"),
    },
  },
  async ({ produced, reason }) => {
    const gctx = await resolveGraphCtx();
    const { fog, graph } = graduateFog(
      gctx.dir,
      {
        ...(produced !== undefined && produced.length > 0 ? { produced } : {}),
        ...(reason !== undefined ? { reason } : {}),
      },
      { actor: mcpActor() },
    );
    return jsonGraph(gctx, {
      graduated: fog.id,
      ...(produced !== undefined && produced.length > 0 ? { produced } : {}),
      ...(reason !== undefined ? { reason } : {}),
      review_status: graph.review?.status,
    });
  },
);

// DEC-1（g080-approve-core）：设计审核凭据写入（MCP 通道）。
// 与 CLI graph approve 共用核心原语 approveGraph——双通道一致。
// F08（0.9.2 渐进审批）：level 分层批准——program 类图审一层批一层；零新增拒绝
// 规则：任何 class 的图带 level 照写记录（档位路由是 skill 口径，工具不强制）。
server.registerTool(
  "graph_approve",
  {
    description:
      "写入 review 与 design_approved 审计；status=approved（人工）或 self（quick 自签），可追加 F08 层级批准。" +
      "幂等覆盖最新凭据；只记录、不改变状态机，缺 review 仅在调度面提示。",
    inputSchema: {
      by: z.string().min(1).describe("审核人（写入 review.by 与事件 payload；quick 自签时为 quick 操作者名）"),
      status: z
        .enum(["approved", "self"])
        .optional()
        .default("approved")
        .describe("审核状态（默认 approved=人工审核；self=quick 自签）"),
      level: z
        .string()
        .min(1)
        .optional()
        .describe("F08 分层批准层标（如 L1/L2/...）：追加 review.layers 记录，审一层批一层；缺省=整图凭据"),
    },
  },
  async ({ by, status, level }) => {
    const gctx = await resolveGraphCtx();
    // 不传 opts.actor：与 claim 的 mcpActor(claimBy) 语义一致——审核事件的行为
    // 主体是审核人（by），客户端名只作兜底（approveGraph 内 opts.actor ?? by）
    const graph = approveGraph(gctx.dir, { by, status, level });
    return jsonGraph(gctx, { review: graph.review });
  },
);

// ════════════════════ 删除 ════════════════════

server.registerTool(
  "graph_delete_node",
  {
    description:
      "软删除节点并保留 .deleted.yaml；有引用边时需 cascade=true，否则列出引用并拒绝悬空。" +
      "可传 reason 写历史与 node_deleted 审计；reason 可选。",
    inputSchema: {
      id: z.string(),
      cascade: z
        .boolean()
        .optional()
        .default(false)
        .describe("连同引用该节点的边一起软删除"),
      reason: z
        .string()
        .optional()
        .describe(
          "删除理由（审计凭据：写入 .deleted.yaml 归档与 node_deleted 事件；缺省行为不变）",
        ),
    },
  },
  async ({ id, cascade, reason }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    deleteNode(rootDir, id, { cascade, actor: mcpActor(), reason });
    return jsonGraph(gctx, {
      deleted: id,
      cascade,
      ...(reason ? { reason } : {}),
    });
  },
);

server.registerTool(
  "graph_delete_edge",
  {
    description:
      "软删除边并保留 .deleted.yaml；用于设计迭代重接拓扑。",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    deleteEdge(rootDir, id, { actor: mcpActor() });
    return jsonGraph(gctx, { deleted: id });
  },
);

// ════════════════════ 版本控制 ════════════════════

server.registerTool(
  "graph_snapshot",
  {
    description:
      "创建完整拓扑快照（.graph/snapshots/<id>/，含 sha256 清单）；适合高风险重接或执行前。" +
      "返回 manifest，分支/合并走 git。",
    inputSchema: {
      message: z.string().optional().describe("快照说明"),
    },
  },
  async ({ message }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    return jsonGraph(gctx, createSnapshot(rootDir, message, { actor: mcpActor() }));
  },
);

server.registerTool(
  "graph_diff",
  {
    description:
      "比较快照差异（默认最新快照→当前工作区，也可指定 from/to）；返回新增、删除、修改文件与节点状态变化。",
    inputSchema: {
      from: z.string().optional().describe("基线快照 id（默认最新快照；无快照时为 working）"),
      to: z.string().optional().describe("目标快照 id（默认当前工作区）"),
    },
  },
  async ({ from, to }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    let fromId: string | null = from ?? null;
    // S2-3（f11）：from 缺省一律回填最新快照——与描述一致。此前仅当 to 也缺省时
    // 才回填，`graph_diff {to: snapX}` 实际执行 working→snapX 而描述承诺 latest→snapX
    if (fromId === null) {
      const snaps = listSnapshots(rootDir);
      if (snaps.length > 0) fromId = snaps[snaps.length - 1].id;
    }
    if (fromId === null && to === undefined) {
      throw new Error("没有可用快照，请先 graph_snapshot 创建基线");
    }
    return jsonGraph(gctx, diffSnapshot(rootDir, fromId, to ?? null));
  },
);

server.registerTool(
  "graph_rollback",
  {
    description:
      "回滚到快照前自动备份当前状态为 pre-rollback，覆盖当前 .graph，需 confirm=true；" +
      "design_only 仅恢复设计字段并保留执行进度，快照后的节点会删除。",
    inputSchema: {
      snapshot_id: z.string(),
      confirm: z.boolean().optional().default(false).describe("必须显式 true 才会执行"),
      design_only: z
        .boolean()
        .optional()
        .default(false)
        .describe("只回滚设计态、保留执行进度（快照后新增节点会被删除）"),
    },
  },
  async ({ snapshot_id, confirm, design_only }) => {
    const gctx = await resolveGraphCtx();
    const rootDir = gctx.dir;
    const result = rollbackToSnapshot(rootDir, snapshot_id, {
      confirm,
      ...(design_only ? { designOnly: true } : {}),
      actor: mcpActor(),
    });
    return jsonGraph(gctx, {
      restored: result.restored.id,
      backup: result.backup.id,
      design_only,
    });
  },
);

// ── 传输/进程级错误处理 ──
// S3-15（f12）：未捕获异常意味着进程处于未定义状态——记录后 fail-fast 退出
// （非 0），由宿主（agent 客户端）按需重启。继续服务等于在未知状态下响应请求。
// unhandledRejection 记录但继续：工具调用均被 SDK 包裹路由为 isError 响应，
// 泄漏的拒绝多来自后台任务；uncaughtException 同帧再触发时直接退出防递归。
let exiting = false;
process.on("uncaughtException", (err) => {
  console.error("[mcp] uncaught exception:", err);
  if (exiting) return;
  exiting = true;
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[mcp] unhandled rejection:", reason);
});

const transport = new StdioServerTransport();
await server.connect(transport);
