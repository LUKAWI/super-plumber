#!/usr/bin/env node
// Report a checkpoint progress update (report-as-you-go).
// Thin wrapper over the core engine — one checkpoint at a time, per the protocol.
// Usage: node graph-checkpoint.mjs <node_id> <checkpoint_id> <pending|running|passed|failed|skipped>
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const GLOBAL_CORE = pathToFileURL(
	path.join(
		execSync("npm root -g").toString().trim(),
		"@lukawi/super-plumber/dist/core/node.js",
	),
).href;
const { updateCheckpoint } = await import(GLOBAL_CORE);

const [nodeId, cpId, status] = process.argv.slice(2);
if (!nodeId || !cpId || !status) {
	console.error(
		"Usage: node graph-checkpoint.mjs <node_id> <checkpoint_id> <pending|running|passed|failed|skipped>",
	);
	process.exit(1);
}

// 前置校验：非法 status 直接友好报错（核心层也会拦截，这里给 agent 更清晰的提示）
const CP_STATUSES = ["pending", "running", "passed", "failed", "skipped"];
if (!CP_STATUSES.includes(status)) {
	console.error(
		`❌ 非法 checkpoint 状态: ${status}。允许的值: ${CP_STATUSES.join(", ")}`,
	);
	process.exit(1);
}

try {
	const node = updateCheckpoint(process.cwd(), nodeId, cpId, status);
	const cp = node.checkpoints?.find((c) => c.id === cpId);
	console.log(`✅ ${nodeId} / ${cpId}: ${cp?.status}`);
} catch (err) {
	console.error(`❌ ${err.message}`);
	process.exit(1);
}
