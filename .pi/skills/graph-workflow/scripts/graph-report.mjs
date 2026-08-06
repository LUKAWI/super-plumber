#!/usr/bin/env node
// Submit the execution report (handoff) BEFORE the node may be marked passed.
// Thin wrapper over the core engine.
// Usage: node graph-report.mjs <node_id> <summary> [artifacts.csv] [blockers.csv] [notes]
//   artifacts/blockers: comma-separated lists (optional)
import { updateExecutionReport } from "../../../../dist/core/node.js";

const [nodeId, summary, artifactsCsv, blockersCsv, notes] = process.argv.slice(2);
if (!nodeId || !summary) {
  console.error(
    "Usage: node graph-report.mjs <node_id> <summary> [artifacts.csv] [blockers.csv] [notes]",
  );
  process.exit(1);
}

const report = {
  summary,
  ...(artifactsCsv ? { artifacts: artifactsCsv.split(",").map((s) => s.trim()) } : {}),
  ...(blockersCsv ? { blockers: blockersCsv.split(",").map((s) => s.trim()) } : {}),
  ...(notes ? { notes } : {}),
};
const node = updateExecutionReport(process.cwd(), nodeId, report);
console.log(`✅ ${nodeId}: execution_report saved (${node.execution_report?.artifacts?.length ?? 0} artifacts)`);
