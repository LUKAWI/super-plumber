#!/usr/bin/env node
// Report a checkpoint progress update (report-as-you-go).
// Thin wrapper over the core engine — one checkpoint at a time, per the protocol.
// Usage: node graph-checkpoint.mjs <node_id> <checkpoint_id> <pending|running|passed|failed|skipped>
import { updateCheckpoint } from "../../../../dist/core/node.js";

const [nodeId, cpId, status] = process.argv.slice(2);
if (!nodeId || !cpId || !status) {
  console.error(
    "Usage: node graph-checkpoint.mjs <node_id> <checkpoint_id> <pending|running|passed|failed|skipped>",
  );
  process.exit(1);
}

const node = updateCheckpoint(process.cwd(), nodeId, cpId, status);
const cp = node.checkpoints?.find((c) => c.id === cpId);
console.log(`✅ ${nodeId} / ${cpId}: ${cp?.status}`);
