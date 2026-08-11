#!/usr/bin/env node
// Claim a node: ready → running, records assigned_to + started_at.
// Thin wrapper over the core engine (dist/core/node.js) — does NOT reimplement the state machine.
// Usage: node sp-claim.mjs <node_id> <claim_by>
// Run from the project directory that contains .graph/
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const GLOBAL_CORE = pathToFileURL(
  path.join(execSync("npm root -g").toString().trim(), "@lukawi/super-plumber/dist/core/node.js"),
).href;
const { updateNodeStatus } = await import(GLOBAL_CORE);

const [id, claimBy] = process.argv.slice(2);
if (!id || !claimBy) {
	console.error("Usage: node sp-claim.mjs <node_id> <claim_by>");
	process.exit(1);
}

try {
	const node = updateNodeStatus(process.cwd(), id, "running", claimBy);
	console.log(
		`✅ ${id}: running (claimed by ${claimBy}, started ${node.execution_report?.started_at})`,
	);
} catch (err) {
	console.error(`❌ ${err.message}`);
	process.exit(1);
}
