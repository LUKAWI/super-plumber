#!/usr/bin/env node
// 从指定节点遍历相邻节点（跨平台，取代 sp-traverse.sh；核心层迭代实现，无递归栈风险）。
// Usage: node sp-traverse.mjs <node_id> [downstream|upstream|both] [max_depth]
import { loadCore } from "./sp-core.mjs";

const { buildGraphIndex } = await loadCore();

const [nodeId, directionArg, depthArg] = process.argv.slice(2);
if (!nodeId) {
	console.error("Usage: node sp-traverse.mjs <node_id> [downstream|upstream|both] [max_depth]");
	process.exit(1);
}
const direction = directionArg ?? "downstream";
const maxDepth = Number.parseInt(depthArg ?? "3", 10);

try {
	const index = buildGraphIndex(process.cwd());
	if (!index.adjacency.has(nodeId)) {
		throw new Error(`Node ${nodeId} not found`);
	}
	const visited = new Set();
	const result = [];
	function dfs(cur, depth) {
		if (depth > maxDepth || visited.has(cur)) return;
		visited.add(cur);
		result.push(cur);
		if (direction === "downstream" || direction === "both") {
			for (const n of index.adjacency.get(cur) ?? []) dfs(n, depth + 1);
		}
		if (direction === "upstream" || direction === "both") {
			for (const n of index.reverseAdj.get(cur) ?? []) dfs(n, depth + 1);
		}
	}
	dfs(nodeId, 0);
	console.log(`遍历结果 (${result.length} 节点):`);
	for (const id of result) {
		const n = index.nodes.find((x) => x.id === id);
		console.log(`  ${id}${n ? ` (${n.status})` : ""}`);
	}
} catch (err) {
	console.error(`❌ ${err.message}`);
	process.exit(1);
}
