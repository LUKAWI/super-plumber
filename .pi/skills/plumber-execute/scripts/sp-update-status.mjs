#!/usr/bin/env node
// 状态机校验的状态流转（跨平台，取代 sp-update-status.sh）。
// Usage: node sp-update-status.mjs <node_id> <pending|ready|running|passed|failed|blocked|cancelled> [--force]
import { loadCore } from "./sp-core.mjs";

const { updateNodeStatus } = await loadCore();

const [nodeId, status, flag] = process.argv.slice(2);
if (!nodeId || !status) {
	console.error(
		"Usage: node sp-update-status.mjs <node_id> <pending|ready|running|passed|failed|blocked|cancelled> [--force]",
	);
	process.exit(1);
}

try {
	const node = updateNodeStatus(process.cwd(), nodeId, status, undefined, {
		force: flag === "--force",
	});
	console.log(`✅ ${nodeId}: ${node.status}`);
} catch (err) {
	console.error(`❌ ${err.message}`);
	process.exit(1);
}
