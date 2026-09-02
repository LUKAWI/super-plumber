#!/usr/bin/env node
// 从指定节点遍历相邻节点（跨平台，取代 sp-traverse.sh；图索引经 sp-core.mjs 加载核心引擎）。
// Usage: node sp-traverse.mjs <node_id> [downstream|upstream|both] [max_depth]
//
// IL-017 脚本通道收编：输出语义 ≡ MCP graph_traverse（IL-003 修复后形状）——
//   { nodes, truncated, truncated_by_depth, truncated_by_nodes } JSON 一行；
//   - max_depth 缺省 3、上限 50（超界收敛到 50，≡ MCP zod .max(50)，传 60 也只到 50）；
//   - 深度截断与节点数截断分开记账、如实上报，不再静默缺失/虚报 truncated:false；
//   - max_nodes 固定 200（≡ MCP 缺省；CLI 签名不暴露该参）。
// 注：下方 dfs 与 src/mcp/server.ts graph_traverse 逐行同构。核心层抽出共享
// traverse 函数前（S03 七脚本收敛），改动本算法必须与 MCP 通道同步。
import { loadCore } from "./sp-core.mjs";

const MAX_DEPTH_LIMIT = 50; // ≡ MCP graph_traverse max_depth zod 上限
const MAX_NODES_LIMIT = 200; // ≡ MCP graph_traverse max_nodes 缺省

const [nodeId, directionArg, depthArg] = process.argv.slice(2);
if (!nodeId) {
	console.error("Usage: node sp-traverse.mjs <node_id> [downstream|upstream|both] [max_depth]");
	process.exit(1);
}
const direction = directionArg ?? "downstream";
if (!["downstream", "upstream", "both"].includes(direction)) {
	console.error(`❌ 无效方向: ${direction}（可选 downstream|upstream|both）`);
	process.exit(1);
}
const maxDepth = Number.parseInt(depthArg ?? "3", 10);
if (Number.isNaN(maxDepth) || maxDepth < 1) {
	console.error(`❌ 无效 max_depth: ${depthArg}（需正整数，上限 ${MAX_DEPTH_LIMIT}）`);
	process.exit(1);
}
const effectiveDepth = Math.min(maxDepth, MAX_DEPTH_LIMIT);

try {
	const core = await loadCore();
	const index = core.buildGraphIndex(process.cwd());
	// 起点不存在时明确报错（≡ MCP：曾静默返回 [node_id] 误导调用方以为节点存在）
	if (!index.adjacency.has(nodeId)) {
		throw new Error(`Node ${nodeId} not found`);
	}
	const visited = new Set();
	const nodes = [];
	let truncatedByDepth = false;
	let truncatedByNodes = false;
	// 与 src/mcp/server.ts graph_traverse 的 dfs 逐行同构（先查 visited，再深度、再节点数）
	function dfs(cur, depth) {
		if (visited.has(cur)) return;
		if (depth > effectiveDepth) {
			truncatedByDepth = true;
			return;
		}
		if (nodes.length >= MAX_NODES_LIMIT) {
			truncatedByNodes = true;
			return;
		}
		visited.add(cur);
		nodes.push(cur);
		if (direction === "downstream" || direction === "both") {
			for (const n of index.adjacency.get(cur) ?? []) dfs(n, depth + 1);
		}
		if (direction === "upstream" || direction === "both") {
			for (const n of index.reverseAdj.get(cur) ?? []) dfs(n, depth + 1);
		}
	}
	dfs(nodeId, 0);
	console.log(
		JSON.stringify({
			nodes,
			truncated: truncatedByDepth || truncatedByNodes,
			truncated_by_depth: truncatedByDepth,
			truncated_by_nodes: truncatedByNodes,
		}),
	);
} catch (err) {
	console.error(`❌ ${err.message}`);
	process.exit(1);
}
