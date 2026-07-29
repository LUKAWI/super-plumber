#!/usr/bin/env node
// src/mcp/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getNode,
  createNode as createNodeOp,
  updateNodeStatus,
  listNodes,
} from "../core/node.js";
import { deleteNode } from "../core/parser.js";
import { buildGraphIndex } from "../core/graph.js";
import { NodeType, NodeStatus } from "../core/types.js";

const rootDir = process.cwd();

const server = new Server(
  { name: "topological-tool", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "graph_get_node",
      description: "读取单个节点的全部内容",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "graph_create_node",
      description: "创建新节点",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          type: { type: "string", enum: Object.values(NodeType) },
          level: { type: "number" },
          assigned_to: { type: "string" },
        },
        required: ["id", "label"],
      },
    },
    {
      name: "graph_update_node_status",
      description: "更新节点状态（状态机校验）",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: Object.values(NodeStatus) },
        },
        required: ["id", "status"],
      },
    },
    {
      name: "graph_delete_node",
      description: "软删除一个节点（标记为废弃，保留历史）",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "graph_get_graph",
      description: "获取完整图拓扑",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "graph_traverse",
      description: "从指定节点出发遍历相邻节点",
      inputSchema: {
        type: "object",
        properties: {
          node_id: { type: "string" },
          direction: { type: "string", enum: ["downstream", "upstream", "both"] },
          max_depth: { type: "number" },
        },
        required: ["node_id"],
      },
    },
    {
      name: "graph_search",
      description: "按条件搜索节点",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          status: { type: "string", enum: Object.values(NodeStatus) },
          type: { type: "string", enum: Object.values(NodeType) },
          assigned_to: { type: "string" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "graph_get_node": {
        const node = getNode(rootDir, args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
      }
      case "graph_delete_node": {
        deleteNode(rootDir, args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify({ deleted: args!.id }, null, 2) }] };
      }
      case "graph_create_node": {
        const a = args!;
        const node = createNodeOp(rootDir, {
          id: a.id as string,
          label: a.label as string,
          type: (a.type as NodeType) ?? NodeType.Task,
          level: a.level as number | undefined,
          assigned_to: a.assigned_to as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
      }
      case "graph_update_node_status": {
        const a = args!;
        const node = updateNodeStatus(rootDir, a.id as string, a.status as NodeStatus);
        return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
      }
      case "graph_get_graph": {
        const index = buildGraphIndex(rootDir);
        // ponytail: Map doesn't serialize to JSON, convert to plain objects
        const serializable = {
          nodes: index.nodes,
          edges: index.edges,
          adjacency: Object.fromEntries(index.adjacency),
          reverseAdj: Object.fromEntries(index.reverseAdj),
        };
        return { content: [{ type: "text", text: JSON.stringify(serializable, null, 2) }] };
      }
      case "graph_traverse": {
        const a = args!;
        const index = buildGraphIndex(rootDir);
        const visited = new Set<string>();
        const result: string[] = [];
        const maxDepth = (a.max_depth as number) ?? 3;
        const direction = (a.direction as string) ?? "downstream";

        function dfs(nodeId: string, depth: number) {
          if (depth > maxDepth || visited.has(nodeId)) return;
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
        dfs(a.node_id as string, 0);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "graph_search": {
        const a = args!;
        const nodes = listNodes(rootDir);
        const filtered = nodes.filter((n) => {
          if (a.query && !n.id.includes(a.query as string) && !n.label.includes(a.query as string)) return false;
          if (a.status && n.status !== a.status) return false;
          if (a.type && n.type !== a.type) return false;
          if (a.assigned_to && n.assigned_to !== a.assigned_to) return false;
          return true;
        });
        return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
