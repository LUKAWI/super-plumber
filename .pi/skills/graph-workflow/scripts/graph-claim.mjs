#!/usr/bin/env node
// Claim a node: ready → running, records assigned_to + started_at.
// Thin wrapper over the core engine (dist/core/node.js) — does NOT reimplement the state machine.
// Usage: node graph-claim.mjs <node_id> <claim_by>
// Run from the project directory that contains .graph/
import { updateNodeStatus } from "../../../../dist/core/node.js";

const [id, claimBy] = process.argv.slice(2);
if (!id || !claimBy) {
  console.error("Usage: node graph-claim.mjs <node_id> <claim_by>");
  process.exit(1);
}

const node = updateNodeStatus(process.cwd(), id, "running", claimBy);
console.log(
  `✅ ${id}: running (claimed by ${claimBy}, started ${node.execution_report?.started_at})`,
);
