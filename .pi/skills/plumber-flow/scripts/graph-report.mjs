#!/usr/bin/env node
// Submit the execution report (handoff) BEFORE the node may be marked passed.
// Thin wrapper over the core engine.
// Usage: node graph-report.mjs <node_id> <summary> [artifacts.csv] [blockers.csv] [notes]
//   artifacts/blockers: comma-separated lists (optional)
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const GLOBAL_CORE = pathToFileURL(
  path.join(execSync("npm root -g").toString().trim(), "super-plumber/dist/core/node.js"),
).href;
const { updateExecutionReport } = await import(GLOBAL_CORE);

const [nodeId, summary, artifactsCsv, blockersCsv, notes] =
	process.argv.slice(2);
if (!nodeId || !summary) {
	console.error(
		"Usage: node graph-report.mjs <node_id> <summary> [artifacts.csv] [blockers.csv] [notes]",
	);
	process.exit(1);
}

const report = {
	summary,
	...(artifactsCsv
		? { artifacts: artifactsCsv.split(",").map((s) => s.trim()) }
		: {}),
	...(blockersCsv
		? { blockers: blockersCsv.split(",").map((s) => s.trim()) }
		: {}),
	...(notes ? { notes } : {}),
};
try {
	const node = updateExecutionReport(process.cwd(), nodeId, report);
	console.log(
		`✅ ${nodeId}: execution_report saved (${node.execution_report?.artifacts?.length ?? 0} artifacts)`,
	);
} catch (err) {
	console.error(`❌ ${err.message}`);
	process.exit(1);
}
