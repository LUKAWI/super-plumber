import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildGraphIndex, resetIndexCache } from "../../dist/core/index-service.js";
import { computeNextActions } from "../../dist/core/graph.js";
import { validateGraphDir } from "../../dist/core/validate.js";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const sizes = option("--sizes", "1000,10000").split(",").map(Number);
const samples = Number(option("--samples", "20"));
const json = argv.includes("--json");
const check = argv.includes("--check");
const baselineFile = option("--baseline", "");
const regressionBudgetPercent = Number(option("--regression-budget-percent", "20"));

function parseAbsoluteGuards(value) {
  const guards = {};
  for (const item of value.split(",")) {
    const [size, limit] = item.split(":");
    const nodes = Number(size);
    const guard = Number(limit);
    if (!Number.isInteger(nodes) || nodes < 1 || !Number.isFinite(guard) || guard < 0) {
      throw new Error("--absolute-guard-ms 需为 nodes:毫秒, nodes:毫秒 格式");
    }
    guards[String(nodes)] = guard;
  }
  return guards;
}

function readBaseline(file) {
  if (!file) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"));
  } catch (error) {
    throw new Error(`无法读取 --baseline 文件: ${error.message}`);
  }
  const entries = Array.isArray(parsed?.scales)
    ? Object.fromEntries(parsed.scales.map((scale) => [String(scale.nodes), scale]))
    : parsed;
  if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error("--baseline 须为按规模索引的 JSON 对象或 benchmark report");
  }
  const baseline = {};
  for (const [nodes, entry] of Object.entries(entries)) {
    const next = entry?.next?.p95_ms ?? entry?.next_p95_ms;
    const validate = entry?.validate?.p95_ms ?? entry?.validate_p95_ms;
    if (!Number.isFinite(next) || next < 0 || !Number.isFinite(validate) || validate < 0) {
      throw new Error(`--baseline 缺少 ${nodes} 的 next/validate P95 数值`);
    }
    baseline[nodes] = { next_p95_ms: next, validate_p95_ms: validate };
  }
  return baseline;
}

const absoluteGuardMs = parseAbsoluteGuards(
  option("--absolute-guard-ms", "1000:100,10000:1000"),
);
const baseline = readBaseline(baselineFile);
if (
  sizes.some((n) => !Number.isInteger(n) || n < 1) ||
  !Number.isInteger(samples) ||
  samples < 3 ||
  !Number.isFinite(regressionBudgetPercent) ||
  regressionBudgetPercent < 0
) {
  throw new Error("--sizes 需为正整数逗号列表，--samples 需为 >=3 的整数");
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
};
const summarize = (values) => ({
  p50_ms: Number(percentile(values, 0.5).toFixed(2)),
  p95_ms: Number(percentile(values, 0.95).toFixed(2)),
});
const measure = (fn) => {
  const started = performance.now();
  fn();
  return performance.now() - started;
};

function checkReport(index5k, scales) {
  const failures = [];
  if (!index5k.within_budget) {
    failures.push({
      type: "index_cold_budget",
      actual_ms: index5k.cold_ms,
      limit_ms: index5k.budget_ms,
    });
  }
  for (const scale of scales) {
    const key = String(scale.nodes);
    const absoluteGuard = absoluteGuardMs[key];
    if (absoluteGuard === undefined) {
      failures.push({ type: "absolute_guard_missing", nodes: scale.nodes });
    } else {
      for (const operation of ["next", "validate"]) {
        const p95 = scale[operation].p95_ms;
        if (p95 > absoluteGuard) {
          failures.push({
            type: "absolute_guard",
            nodes: scale.nodes,
            operation,
            actual_p95_ms: p95,
            limit_ms: absoluteGuard,
          });
        }
      }
    }
    if (baseline !== null) {
      const base = baseline[key];
      if (base === undefined) {
        failures.push({ type: "baseline_missing", nodes: scale.nodes });
      } else {
        for (const operation of ["next", "validate"]) {
          const baselineP95 = base[`${operation}_p95_ms`];
          const limit = baselineP95 * (1 + regressionBudgetPercent / 100);
          const p95 = scale[operation].p95_ms;
          if (p95 > limit) {
            failures.push({
              type: "regression_budget",
              nodes: scale.nodes,
              operation,
              actual_p95_ms: p95,
              baseline_p95_ms: baselineP95,
              limit_ms: Number(limit.toFixed(2)),
              budget_percent: regressionBudgetPercent,
            });
          }
        }
      }
    }
  }
  return { enabled: check, ok: !check || failures.length === 0, failures };
}

function writeFixture(root, nodeCount, withEdges) {
  const graphDir = path.join(root, ".graph");
  const nodeDir = path.join(graphDir, "nodes");
  const edgeDir = path.join(graphDir, "edges");
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.mkdirSync(edgeDir, { recursive: true });
  const nodeRefs = [];
  const edgeRefs = [];
  const stamp = "2026-01-01T00:00:00.000Z";
  for (let i = 0; i < nodeCount; i++) {
    const id = `n${String(i).padStart(5, "0")}`;
    nodeRefs.push(`  - file: nodes/${id}.yaml`);
    fs.writeFileSync(path.join(nodeDir, `${id}.yaml`), [
      `id: ${id}`, "type: task", `label: Node ${i}`, "level: 1", "status: pending",
      "attempts: 0", "max_attempts: 3", `created_at: '${stamp}'`, `updated_at: '${stamp}'`, "",
    ].join("\n"));
    if (withEdges && i > 0) {
      const previous = `n${String(i - 1).padStart(5, "0")}`;
      const edge = `e${String(i - 1).padStart(5, "0")}`;
      edgeRefs.push(`  - file: edges/${edge}.yaml`);
      fs.writeFileSync(path.join(edgeDir, `${edge}.yaml`), [
        `id: ${edge}`, `source: ${previous}`, `target: ${id}`, "type: depends_on", "",
      ].join("\n"));
    }
  }
  fs.writeFileSync(path.join(graphDir, "graph.yaml"), [
    "id: q1-benchmark", "version: 1.0.0", `label: Q1 deterministic ${nodeCount}`,
    "entry:", "  description: benchmark entry", "  defined_by: human", "  level: 0",
    "exit:", "  description: benchmark exit", "  acceptance_criteria:", "    - deterministic",
    "  defined_by: human", "  level: 0", "nodes:", ...nodeRefs, "edges:", ...edgeRefs, "",
  ].join("\n"));
  return graphDir;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "super-plumber-q1-"));
try {
  const indexRoot = path.join(tempRoot, "index-5k");
  const indexDir = writeFixture(indexRoot, 5_000, false);
  resetIndexCache();
  const indexColdMs = measure(() => buildGraphIndex(indexDir, { useCache: true }));

  const scales = [];
  for (const nodes of sizes) {
    const root = path.join(tempRoot, `scale-${nodes}`);
    const graphDir = writeFixture(root, nodes, true);
    resetIndexCache();
    buildGraphIndex(graphDir, { useCache: true });
    computeNextActions(graphDir);
    validateGraphDir(graphDir);
    const next = [];
    const validate = [];
    for (let i = 0; i < samples; i++) {
      next.push(measure(() => computeNextActions(graphDir)));
      validate.push(measure(() => validateGraphDir(graphDir)));
    }
    scales.push({ nodes, samples, next: summarize(next), validate: summarize(validate) });
  }

  const index_5k = {
    cold_ms: Number(indexColdMs.toFixed(2)),
    budget_ms: 30_000,
    within_budget: indexColdMs < 30_000,
    strategy: "cold start is reported separately; it is not hidden inside warm next/validate samples",
  };
  const checks = checkReport(index_5k, scales);
  const report = {
    environment: {
      node: process.version,
      platform: process.platform,
      release: os.release(),
      cpu: os.cpus()[0]?.model ?? "unknown",
      logical_cpus: os.cpus().length,
    },
    fixture: "deterministic chain; fixed ids/status/timestamps; one depends_on edge per non-entry node",
    policy: {
      regression_budget_percent: regressionBudgetPercent,
      absolute_guard_ms: absoluteGuardMs,
      baseline_file: baselineFile || null,
    },
    index_5k,
    scales,
    checks,
  };
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    console.log(`Q1 benchmark | ${report.environment.cpu} | Node ${report.environment.node}`);
    console.log(`5k index cold: ${report.index_5k.cold_ms}ms / ${report.index_5k.budget_ms}ms`);
    for (const scale of scales) {
      console.log(`${scale.nodes} nodes | next P50/P95 ${scale.next.p50_ms}/${scale.next.p95_ms}ms | validate P50/P95 ${scale.validate.p50_ms}/${scale.validate.p95_ms}ms`);
    }
    if (check) {
      console.log(`Q1 check: ${checks.ok ? "passed" : "failed"}`);
      for (const failure of checks.failures) console.log(`  - ${JSON.stringify(failure)}`);
    }
  }
  if (check && !checks.ok) process.exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  resetIndexCache();
}
