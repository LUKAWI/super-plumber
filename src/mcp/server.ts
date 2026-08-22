#!/usr/bin/env node
// src/mcp/server.ts
// Super Plumber MCP Server（stdio）— 18 个 graph_* 工具。
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
  updateNodeStatus,
  updateCheckpoint,
  updateExecutionReport,
  updateNodeContent,
  buildNodeUpdates,
  checkReadyGate,
  getGoverningAdrs,
  reclaimNode,
  listNodes,
} from "../core/node.js";
import { createEdge as createEdgeOp, listEdges } from "../core/edge.js";
import { deleteNode, deleteEdge, updateGraph, rebuildGraphRefs } from "../core/parser.js";
import {
  buildGraphIndex,
  computeNextActions,
} from "../core/graph.js";
import { allowedTransitionsFor, aggregateCheckpointStatus } from "../core/state-machine.js";
import {
  createSnapshot,
  diffSnapshot,
  rollbackToSnapshot,
  listSnapshots,
} from "../core/snapshot.js";
import { NodeType, NodeStatus, EdgeType, isKnowledgeType } from "../core/types.js";
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

/** 从 start 向上查找最近的 .graph/graph.yaml 所在目录；找不到返回 null */
function findGraphRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".graph", "graph.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const ROOTS_TTL_MS = 5_000;
let rootsCache: { at: number; root: string | null } | null = null;

const server = new McpServer({
  name: "super-plumber",
  version: VERSION,
});

async function resolveGraphRoot(): Promise<string> {
  const root = await locateRoot();
  const graphFile = path.join(root, ".graph", "graph.yaml");
  if (!fs.existsSync(graphFile)) {
    throw new Error(
      `图目录未初始化：定位到 ${root}，但不存在 .graph/graph.yaml。` +
        `请在该项目目录运行 graph init（CLI），或用 --root <dir> / ` +
        `SUPER_PLUMBER_ROOT 环境变量显式指定图所在目录。`,
    );
  }
  return root;
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
const nodeStatusSchema = z.enum(Object.values(NodeStatus) as [string, ...string[]]);
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

// ════════════════════ 读取 ════════════════════

server.registerTool(
  "graph_get_node",
  {
    description:
      "读取单个节点的完整内容（解压压缩包）。Use when you need a node's plan, checkpoints, definition_of_done or execution state. " +
      "Returns the node plus allowed_transitions (legal next statuses), checkpoint_aggregate, and ready_gate (whether its predecessors have passed) — one call answers \"what can I do next with this node\". " +
      "include_neighbors=up/down 附加拓扑相邻节点紧凑列表（基于索引缓存，零额外文件扫描），需要局部拓扑时用它替代 graph_traverse.",
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
    const rootDir = await resolveGraphRoot();
    const node = getNode(rootDir, id);
    const result: Record<string, unknown> = {
      node,
      allowed_transitions: allowedTransitionsFor(node),
      checkpoint_aggregate: node.checkpoints?.length
        ? aggregateCheckpointStatus(node.checkpoints)
        : null,
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
    return jsonText(result);
  },
);

server.registerTool(
  "graph_get_graph",
  {
    description:
      "获取图拓扑（节点 + 边 + 邻接表，命中 index 缓存）。默认 summary 模式：节点为紧凑字段（id/label/status/type/level/assigned_to），" +
      "先拿全局再按需解压节点，避免大图 token 爆炸。mode=full 返回完整节点内容，用 offset/limit 分页（每页默认 200）。" +
      "Returns total + nodes + edges + adjacency.",
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
    const rootDir = await resolveGraphRoot();
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
    return jsonText({
      total: index.nodes.length,
      offset,
      limit,
      nodes,
      edges: index.edges,
      adjacency: Object.fromEntries(index.adjacency),
      reverseAdj: Object.fromEntries(index.reverseAdj),
    });
  },
);

server.registerTool(
  "graph_get_next_actions",
  {
    description:
      "调度决策工具 — 一次调用回答\"我现在该干什么\"。Use this as your primary planning loop: returns ready nodes (claimable now), ready_eligible nodes (pending/failed whose gates are satisfied — flip them to ready, including cold start), blocked nodes with their unmet predecessors, running nodes with elapsed time, and stale running nodes that may be stuck (reclaim them with graph_reclaim_node). " +
      "Each bucket is capped at limit (default 100); truncated flags tell you when more exist. Prefer this over combining graph_get_graph + graph_traverse + graph_search.",
    inputSchema: {
      stale_ms: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(30 * 60 * 1000)
        .describe("running 节点无更新阈值（毫秒），默认 30 分钟"),
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
    },
  },
  async ({ stale_ms, limit, assigned_to }) => {
    const rootDir = await resolveGraphRoot();
    const r = computeNextActions(rootDir, { staleMs: stale_ms });
    const cap = <T>(list: T[]): T[] => list.slice(0, limit);
    const running = assigned_to
      ? r.running.filter((n) => n.assigned_to === assigned_to)
      : r.running;
    const stale = assigned_to
      ? r.stale_running.filter((n) =>
          running.some((x) => x.id === n.id),
        )
      : r.stale_running;
    return jsonText({
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
      summary: r.summary,
    });
  },
);

server.registerTool(
  "graph_traverse",
  {
    description:
      "从指定节点出发遍历相邻节点（DFS，最大深度与节点数双限制）。Use when you only care about a node's neighborhood. " +
      "Returns { nodes: ordered visited ids, truncated } — truncated=true 表示达到 max_nodes 上限，缩小 max_depth 或换起点继续。",
    inputSchema: {
      node_id: z.string(),
      direction: z
        .enum(["downstream", "upstream", "both"])
        .optional()
        .default("downstream"),
      max_depth: z.number().int().min(1).max(20).optional().default(3),
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
    const rootDir = await resolveGraphRoot();
    const index = buildGraphIndex(rootDir, { useCache: true });
    // 起点不存在时明确报错（曾静默返回 [node_id] 误导 agent 以为节点存在）
    if (!index.adjacency.has(node_id)) {
      throw new Error(`Node ${node_id} not found`);
    }
    const visited = new Set<string>();
    const result: string[] = [];

    function dfs(nodeId: string, depth: number) {
      if (depth > max_depth || visited.has(nodeId)) return;
      if (result.length >= max_nodes) return;
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
    return jsonText({ nodes: result, truncated: result.length >= max_nodes });
  },
);

server.registerTool(
  "graph_search",
  {
    description:
      "按条件过滤节点（query 模糊匹配 id/label，可叠加 status/type/assigned_to/level）。Use when you need to find specific nodes, e.g. all ready tasks assigned to nobody. " +
      "Returns { total, limit, nodes } — nodes 为紧凑字段（id/label/status/type/level/assigned_to），total > limit 时缩小条件或增大 limit 继续查。",
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
    const rootDir = await resolveGraphRoot();
    const nodes = listNodes(rootDir);
    const filtered = nodes.filter((n) => {
      if (query && !n.id.includes(query) && !n.label.includes(query)) return false;
      if (status && n.status !== status) return false;
      if (type && n.type !== type) return false;
      if (assigned_to && n.assigned_to !== assigned_to) return false;
      if (level !== undefined && n.level !== level) return false;
      return true;
    });
    return jsonText({
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

// ════════════════════ 创建 ════════════════════

const checkpointSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: cpStatusSchema.optional().default("pending"),
  verifier: verifierSchema.optional().default("auto"),
});

server.registerTool(
  "graph_create_node",
  {
    description:
      "创建新节点（默认 pending）。Pass plan_description, definition_of_done and checkpoints in one call to create a complete \"压缩包\" — no follow-up edits needed. " +
      "Duplicate id returns an error (never overwrites).",
    inputSchema: {
      id: z.string().describe("节点 ID"),
      label: z.string().describe("节点标签"),
      type: nodeTypeSchema.optional().default(NodeType.Task),
      level: z.number().int().optional().default(1),
      priority: z.number().int().min(0).optional().describe("调度优先级（越小越先；缺省最低）"),
      plan_description: z.string().optional().describe("构建计划描述"),
      definition_of_done: z.array(z.string()).optional().describe("完成标准条目"),
      checkpoints: z.array(checkpointSchema).optional().describe("子步骤检查点"),
      assigned_to: z.string().optional(),
      max_attempts: z.number().int().min(0).optional().default(3).describe("最大重试次数（0=不限）"),
    },
  },
  async ({ id, label, type, level, priority, plan_description, definition_of_done, checkpoints, assigned_to, max_attempts }) => {
    const rootDir = await resolveGraphRoot();
    const node = createNodeOp(rootDir, {
      id,
      label,
      type: type as NodeType,
      level,
      priority,
      plan_description,
      definition_of_done,
      checkpoints: checkpoints as never,
      assigned_to,
      max_attempts,
    }, { actor: "mcp" });
    return jsonText(node);
  },
);

const batchNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: nodeTypeSchema.optional().default(NodeType.Task),
  level: z.number().int().optional().default(1),
  priority: z.number().int().min(0).optional(),
  plan_description: z.string().optional(),
  definition_of_done: z.array(z.string()).optional(),
  checkpoints: z.array(checkpointSchema).optional(),
  assigned_to: z.string().optional(),
  max_attempts: z.number().int().min(0).optional().default(3),
});

const batchEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: edgeTypeSchema,
});

server.registerTool(
  "graph_batch_create",
  {
    description:
      "批量创建节点与边（设计期减负：20 节点 36 边从 ~56 次调用降到 1 次）。Validates the whole batch first and reports ALL conflicts (duplicate ids, ghost references) before writing anything; re-running after a crash reports remaining conflicts. " +
      "Not transactional across files: if it errors midway, fix the reported conflicts and re-run.",
    inputSchema: {
      nodes: z.array(batchNodeSchema).optional().default([]),
      edges: z.array(batchEdgeSchema).optional().default([]),
    },
  },
  async ({ nodes, edges }) => {
    const rootDir = await resolveGraphRoot();
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
    for (const n of nodes) {
      createNodeOp(
        rootDir,
        {
          id: n.id,
          label: n.label,
          type: n.type as NodeType,
          level: n.level,
          priority: n.priority,
          plan_description: n.plan_description,
          definition_of_done: n.definition_of_done,
          checkpoints: n.checkpoints as never,
          assigned_to: n.assigned_to,
          max_attempts: n.max_attempts,
        },
        { syncRef: false, actor: "mcp" },
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
        },
        { syncRef: false, actor: "mcp" },
      );
    }
    rebuildGraphRefs(rootDir);
    return jsonText({ ok: true, nodes: nodes.length, edges: edges.length });
  },
);

server.registerTool(
  "graph_add_edge",
  {
    description:
      "添加一条类型化边（depends_on/validates 参与拓扑排序；fan_out/fan_in/shares_context/fallback/iterates 表达运行时控制流）。Both endpoints must exist. " +
      "Duplicate edge id returns an error.",
    inputSchema: {
      id: z.string(),
      source: z.string(),
      target: z.string(),
      type: edgeTypeSchema,
    },
  },
  async ({ id, source, target, type }) => {
    const rootDir = await resolveGraphRoot();
    const edge = createEdgeOp(rootDir, {
      id,
      source,
      target,
      type: type as EdgeType,
    }, { actor: "mcp" });
    return jsonText(edge);
  },
);

// ════════════════════ 更新 ════════════════════

server.registerTool(
  "graph_update_node",
  {
    description:
      "更新节点内容（plan / definition_of_done / checkpoints / assigned_to / label / max_attempts）。Use during the design phase to enrich nodes; during execution prefer graph_update_checkpoint and graph_update_execution_report. " +
      "attempts never resets implicitly — changing plan.description does NOT clear the retry counter; pass reset_attempts=true explicitly (an attempts_reset audit event is always recorded).",
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
      reset_attempts: z
        .boolean()
        .optional()
        .default(false)
        .describe("显式把 attempts 重置为 0（写审计事件；修改 plan 不再自动重置）"),
    },
  },
  async ({ id, plan_description, add_dod, clear_dod, add_checkpoints, set_assigned_to, label, max_attempts, set_priority, reset_attempts }) => {
    const rootDir = await resolveGraphRoot();
    const node = getNode(rootDir, id);
    const updates = buildNodeUpdates(node, {
      ...(plan_description !== undefined ? { plan_description } : {}),
      ...(add_dod ? { add_dod } : {}),
      ...(clear_dod ? { clear_dod } : {}),
      ...(add_checkpoints ? { add_checkpoints: add_checkpoints as never } : {}),
      ...(set_assigned_to !== undefined ? { set_assigned_to } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(max_attempts !== undefined ? { max_attempts } : {}),
      ...(set_priority !== undefined ? { set_priority } : {}),
    });
    if (Object.keys(updates).length === 0 && !reset_attempts) {
      throw new Error("没有指定任何更新项（至少传一个可选参数）");
    }
    return jsonText(
      updateNodeContent(rootDir, id, updates, {
        actor: "mcp",
        ...(reset_attempts ? { resetAttempts: true } : {}),
      }),
    );
  },
);

server.registerTool(
  "graph_update_node_status",
  {
    description:
      "更新节点状态（状态机强制校验 + ready 前置门禁 + max_attempts 拦截）。Claim semantics: pass claim_by when transitioning ready → running — records assigned_to and started_at atomically (concurrent double-claim fails for the loser). " +
      "Re-claiming by the same claim_by is idempotent. force is REJECTED on the MCP channel (agent-facing); human operators must use the CLI: graph update-status --force.",
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
    const rootDir = await resolveGraphRoot();
    // FIX-A1（评审 A 级·信任模型）：MCP 是 agent 通道，force 在协议层面拒绝。
    // 保留 zod 形参以显式报错（剥离未知键会变成静默忽略，更危险）。
    if (force) {
      throw new Error(
        "force 仅人类运维通道（CLI: graph update-status --force）可用，MCP 拒绝执行。" +
          "若你是执行 agent：请按状态机/门禁规则走合法转换，不要绕过。",
      );
    }
    const node = updateNodeStatus(rootDir, id, status as NodeStatus, claim_by, {
      actor: "mcp",
    });
    return jsonText(node);
  },
);

server.registerTool(
  "graph_reclaim_node",
  {
    description:
      "回收死认领：running → pending（清空 assigned_to，notes 附回收记录，attempts 不变）。Use when a running node is stale (graph_get_next_actions stale_running) and the claiming agent is dead or unresponsive. " +
      "The reclaimed node can be re-claimed after it becomes ready again. Only works on running nodes.",
    inputSchema: {
      id: z.string().describe("节点 ID"),
      by: z.string().optional().describe("回收操作者（写入回收记录）"),
    },
  },
  async ({ id, by }) => {
    const rootDir = await resolveGraphRoot();
    return jsonText(reclaimNode(rootDir, id, by ?? "mcp"));
  },
);

server.registerTool(
  "graph_update_checkpoint",
  {
    description:
      "上报单个 checkpoint 进度（只改 checkpoints 数组，不触发节点状态）。Checkpoint state machine enforced: pending→running/passed/failed/skipped, running→passed/failed, passed/failed→pending (reopen). " +
      "Re-reporting the same status is idempotent. Report as you go — never batch at the end.",
    inputSchema: {
      node_id: z.string(),
      checkpoint_id: z.string(),
      status: cpStatusSchema,
    },
  },
  async ({ node_id, checkpoint_id, status }) => {
    const rootDir = await resolveGraphRoot();
    return jsonText(updateCheckpoint(rootDir, node_id, checkpoint_id, status, { actor: "mcp" }));
  },
);

server.registerTool(
  "graph_update_execution_report",
  {
    description:
      "填写执行报告（交接单），供裁决方（Super Mario）抽查。artifacts 填真实文件路径 — verification 层会实际检查它们存在。 " +
      "Optional verification {verdict, note} records the adjudication result after checkpoint aggregation + output spot-check.",
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
    const rootDir = await resolveGraphRoot();
    const node = updateExecutionReport(rootDir, node_id, {
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
    }, { actor: "mcp" });
    return jsonText(node);
  },
);

server.registerTool(
  "graph_update_graph",
  {
    description:
      "编辑图级字段：label / entry.description / exit.description / exit.acceptance_criteria / root_context。Use during design to define the human-authored entry (需求) and exit (验收标准) without hand-editing graph.yaml. " +
      "acceptance_criteria are the ground truth for the final three-layer acceptance check.",
    inputSchema: {
      label: z.string().optional(),
      entry_description: z.string().optional(),
      exit_description: z.string().optional(),
      add_criteria: z.array(z.string()).optional().describe("追加验收标准"),
      clear_criteria: z.boolean().optional().describe("清空验收标准"),
      root_context: z.record(z.string(), z.unknown()).optional(),
    },
  },
  async ({ label, entry_description, exit_description, add_criteria, clear_criteria, root_context }) => {
    const rootDir = await resolveGraphRoot();
    return jsonText(
      updateGraph(rootDir, {
        ...(label !== undefined ? { label } : {}),
        ...(entry_description !== undefined ? { entry_description } : {}),
        ...(exit_description !== undefined ? { exit_description } : {}),
        ...(add_criteria ? { add_criteria } : {}),
        ...(clear_criteria ? { clear_criteria } : {}),
        ...(root_context !== undefined ? { root_context } : {}),
      }),
    );
  },
);

// ════════════════════ 删除 ════════════════════

server.registerTool(
  "graph_delete_node",
  {
    description:
      "软删除节点（保留 .deleted.yaml 历史）。Refuses (with the list of referencing edges) unless cascade=true, so you can never leave dangling edges by accident. " +
      "Soft delete: recoverable, audit-friendly.",
    inputSchema: {
      id: z.string(),
      cascade: z
        .boolean()
        .optional()
        .default(false)
        .describe("连同引用该节点的边一起软删除"),
    },
  },
  async ({ id, cascade }) => {
    const rootDir = await resolveGraphRoot();
    deleteNode(rootDir, id, { cascade, actor: "mcp" });
    return jsonText({ deleted: id, cascade });
  },
);

server.registerTool(
  "graph_delete_edge",
  {
    description:
      "软删除一条边（保留 .deleted.yaml 历史）。Use to rewire the topology during design iterations.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const rootDir = await resolveGraphRoot();
    deleteEdge(rootDir, id, { actor: "mcp" });
    return jsonText({ deleted: id });
  },
);

// ════════════════════ 版本控制 ════════════════════

server.registerTool(
  "graph_snapshot",
  {
    description:
      "创建当前拓扑的完整版本快照（.graph/snapshots/<id>/，含文件 sha256 清单）。Take a snapshot before risky rewires or before execution starts. " +
      "Returns the snapshot manifest; branch/merge itself is done with git.",
    inputSchema: {
      message: z.string().optional().describe("快照说明"),
    },
  },
  async ({ message }) => {
    const rootDir = await resolveGraphRoot();
    return jsonText(createSnapshot(rootDir, message, { actor: "mcp" }));
  },
);

server.registerTool(
  "graph_diff",
  {
    description:
      "比较拓扑差异（默认：最新快照 vs 当前工作区；也可指定任意两个快照）。Use to audit what changed since a snapshot or review a design iteration. " +
      "Returns added/removed/modified files and node status changes.",
    inputSchema: {
      from: z.string().optional().describe("基线快照 id（默认最新快照）"),
      to: z.string().optional().describe("目标快照 id（默认当前工作区）"),
    },
  },
  async ({ from, to }) => {
    const rootDir = await resolveGraphRoot();
    let fromId: string | null = from ?? null;
    if (fromId === null && to === undefined) {
      const snaps = listSnapshots(rootDir);
      fromId = snaps.length > 0 ? snaps[snaps.length - 1].id : null;
    }
    if (fromId === null && to === undefined) {
      throw new Error("没有可用快照，请先 graph_snapshot 创建基线");
    }
    return jsonText(diffSnapshot(rootDir, fromId, to ?? null));
  },
);

server.registerTool(
  "graph_rollback",
  {
    description:
      "回滚到指定快照（覆盖当前 .graph/，先自动备份当前状态为 pre-rollback 快照）。Requires confirm=true as a safety gate. " +
      "Use when a design iteration went wrong and you want the previous known-good state. " +
      "design_only=true restores design fields (plan/DoD/checkpoints/label/edges/graph.yaml) while KEEPING execution progress (status/attempts/execution_report); nodes added after the snapshot are removed.",
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
    const rootDir = await resolveGraphRoot();
    const result = rollbackToSnapshot(rootDir, snapshot_id, {
      confirm,
      ...(design_only ? { designOnly: true } : {}),
      actor: "mcp",
    });
    return jsonText({
      restored: result.restored.id,
      backup: result.backup.id,
      design_only,
    });
  },
);

// ── 传输/进程级错误处理 ──
process.on("uncaughtException", (err) => {
  console.error("[mcp] uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[mcp] unhandled rejection:", reason);
});

const transport = new StdioServerTransport();
await server.connect(transport);
