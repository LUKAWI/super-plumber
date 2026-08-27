#!/usr/bin/env node
// 读取单个节点的完整 YAML 内容（跨平台，取代 sp-get-node.sh）。
// Usage: node sp-get-node.mjs <node_id>
import { loadCore } from "./sp-core.mjs";

const { getNode } = await loadCore();

const [nodeId] = process.argv.slice(2);
if (!nodeId) {
	console.error("Usage: node sp-get-node.mjs <node_id>");
	process.exit(1);
}

try {
	const node = getNode(process.cwd(), nodeId);
	console.log(JSON.stringify(node, null, 2));
} catch (err) {
	console.error(`❌ ${err.message}`);
	process.exit(1);
}
