#!/usr/bin/env node
// src/mcp/server.ts
// 使用 SDK 推荐的 McpServer 高级 API（取代 deprecated 的 Server）
// 每个工具用 zod schema 声明参数，SDK 自动校验并生成 JSON schema 给 LLM
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getNode,
  createNode as createNodeOp,
  updateNodeStatus,
  updateCheckpoint,
  updateExecutionReport,
  listNodes,
} from "../core/node.js";
import { deleteNode } from "../core/parser.js";
import { buildGraphIndex } from "../core/graph.js";
import { NodeType, NodeStatus } from "../core/types.js";

const rootDir = process.cwd();

const server = new McpServer({
  name: "super-plumber",
  version: "0.1.0",
});

// zod 4.x 中 z.nativeEnum deprecated，用 z.enum 显式枚举
const nodeStatusSchema = z.enum(
  Object.values(NodeStatus) as [string, ...string[]],
);
const nodeTypeSchema = z.enum(Object.values(NodeType) as [string, ...string[]]);
const cpStatusSchema = z.enum([
  "pending",
  "running",
  "passed",
  "failed",
  "skipped",
]);

// ── 工具注册（zod schema 驱动参数校验，SDK 自动处理非法参数）──

server.registerTool(
  "graph_get_node",
  {
    description: "读取单个节点的全部内容（解压压缩包）",
    inputSchema: { id: z.string().describe("节点 ID") },
  },
  async ({ id }) => {
    const node = getNode(rootDir, id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(node, null, 2) }],
    };
  },
);

server.registerTool(
  "graph_create_node",
  {
    description: "创建新节点",
    inputSchema: {
      id: z.string(),
      label: z.string(),
      type: nodeTypeSchema.optional().default(NodeType.Task),
      level: z.number().int().optional().default(1),
      assigned_to: z.string().optional(),
    },
  },
  async ({ id, label, type, level, assigned_to }) => {
    const node = createNodeOp(rootDir, {
      id,
      label,
      type: type as NodeType,
      level,
      assigned_to,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(node, null, 2) }],
    };
  },
);

server.registerTool(
  "graph_update_node_status",
  {
    description:
      "更新节点状态（状态机校验）。claim语义：status=running时传claim_by记录执行者",
    inputSchema: {
      id: z.string(),
      status: nodeStatusSchema,
      claim_by: z
        .string()
        .optional()
        .describe("认领者（执行agent名），status=running时传"),
    },
  },
  async ({ id, status, claim_by }) => {
    const node = updateNodeStatus(rootDir, id, status as NodeStatus, claim_by);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(node, null, 2) }],
    };
  },
);

server.registerTool(
  "graph_update_checkpoint",
  {
    description:
      "执行agent上报checkpoint进度（只改checkpoints数组，不触节点状态）",
    inputSchema: {
      node_id: z.string(),
      checkpoint_id: z.string(),
      status: cpStatusSchema,
    },
  },
  async ({ node_id, checkpoint_id, status }) => {
    const node = updateCheckpoint(rootDir, node_id, checkpoint_id, status);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(node, null, 2) }],
    };
  },
);

server.registerTool(
  "graph_update_execution_report",
  {
    description: "执行agent填写执行报告（交接单），供Super Mario抽查",
    inputSchema: {
      node_id: z.string(),
      summary: z.string(),
      artifacts: z.array(z.string()).optional(),
      blockers: z.array(z.string()).optional(),
      notes: z.string().optional(),
    },
  },
  async ({ node_id, summary, artifacts, blockers, notes }) => {
    const node = updateExecutionReport(rootDir, node_id, {
      summary,
      artifacts,
      blockers,
      notes,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(node, null, 2) }],
    };
  },
);

server.registerTool(
  "graph_delete_node",
  {
    description: "软删除一个节点（标记为废弃，保留历史）",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    deleteNode(rootDir, id);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ deleted: id }, null, 2),
        },
      ],
    };
  },
);

server.registerTool(
  "graph_get_graph",
  {
    description: "获取完整图拓扑（节点+边+邻接表）",
    inputSchema: {},
  },
  async () => {
    const index = buildGraphIndex(rootDir);
    const serializable = {
      nodes: index.nodes,
      edges: index.edges,
      adjacency: Object.fromEntries(index.adjacency),
      reverseAdj: Object.fromEntries(index.reverseAdj),
    };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(serializable, null, 2) },
      ],
    };
  },
);

server.registerTool(
  "graph_traverse",
  {
    description: "从指定节点出发遍历相邻节点",
    inputSchema: {
      node_id: z.string(),
      direction: z
        .enum(["downstream", "upstream", "both"])
        .optional()
        .default("downstream"),
      max_depth: z.number().int().optional().default(3),
    },
  },
  async ({ node_id, direction, max_depth }) => {
    const index = buildGraphIndex(rootDir);
    const visited = new Set<string>();
    const result: string[] = [];

    function dfs(nodeId: string, depth: number) {
      if (depth > max_depth || visited.has(nodeId)) return;
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
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
);

server.registerTool(
  "graph_search",
  {
    description: "按条件搜索节点",
    inputSchema: {
      query: z.string().optional(),
      status: nodeStatusSchema.optional(),
      type: nodeTypeSchema.optional(),
      assigned_to: z.string().optional(),
    },
  },
  async ({ query, status, type, assigned_to }) => {
    const nodes = listNodes(rootDir);
    const filtered = nodes.filter((n) => {
      if (query && !n.id.includes(query) && !n.label.includes(query))
        return false;
      if (status && n.status !== status) return false;
      if (type && n.type !== type) return false;
      if (assigned_to && n.assigned_to !== assigned_to) return false;
      return true;
    });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(filtered, null, 2) },
      ],
    };
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
