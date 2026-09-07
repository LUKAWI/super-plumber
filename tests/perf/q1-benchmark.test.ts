import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const BENCHMARK = path.resolve("scripts/perf/q1-next-validate.mjs");

describe("Q1 next/validate benchmark command", () => {
  it("--check 覆盖 1k/10k 绝对护栏并输出确定性 P50/P95、环境与门槛", () => {
    const run = spawnSync(process.execPath, [
      BENCHMARK,
      "--sizes",
      "1000,10000",
      "--samples",
      "3",
      "--check",
      "--json",
    ], {
      cwd: path.resolve("."),
      encoding: "utf-8",
      timeout: 120_000,
    });

    expect(run.status, run.stderr).toBe(0);
    const report = JSON.parse(run.stdout) as {
      environment: { node: string; platform: string; cpu: string };
      policy: { regression_budget_percent: number; absolute_guard_ms: Record<string, number> };
      index_5k: { cold_ms: number; budget_ms: number; within_budget: boolean };
      checks: { enabled: boolean; ok: boolean; failures: Array<{ type: string }> };
      scales: Array<{
        nodes: number;
        next: { p50_ms: number; p95_ms: number };
        validate: { p50_ms: number; p95_ms: number };
      }>;
    };

    expect(report.environment.node).toMatch(/^v\d+/);
    expect(report.environment.platform).toBe(process.platform);
    expect(report.environment.cpu.length).toBeGreaterThan(0);
    expect(report.policy.regression_budget_percent).toBe(20);
    expect(report.policy.absolute_guard_ms).toEqual({ "1000": 100, "10000": 1000 });
    expect(report.index_5k.budget_ms).toBe(30_000);
    expect(report.index_5k.cold_ms).toBeGreaterThan(0);
    expect(report.checks).toEqual({ enabled: true, ok: true, failures: [] });
    expect(report.scales.map((scale) => scale.nodes)).toEqual([1000, 10000]);
    for (const scale of report.scales) {
      expect(scale.next.p95_ms).toBeGreaterThan(0);
      expect(scale.validate.p95_ms).toBeGreaterThan(0);
    }
  }, 150_000);

  it("--check 触发 1k 绝对护栏超限时以非零退出", () => {
    const run = spawnSync(process.execPath, [
      BENCHMARK,
      "--sizes",
      "1000",
      "--samples",
      "3",
      "--check",
      "--absolute-guard-ms",
      "1000:0",
      "--json",
    ], {
      cwd: path.resolve("."),
      encoding: "utf-8",
      timeout: 90_000,
    });

    expect(run.status, run.stderr).toBe(1);
    const report = JSON.parse(run.stdout) as {
      checks: { ok: boolean; failures: Array<{ type: string; nodes?: number }> };
    };
    expect(report.checks.ok).toBe(false);
    expect(report.checks.failures.some((failure) =>
      failure.type === "absolute_guard" && failure.nodes === 1000,
    )).toBe(true);
  }, 120_000);

  it("基线 P95 超过 20% 回归预算时以非零退出", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "super-plumber-q1-baseline-"));
    const baselineFile = path.join(tempDir, "baseline.json");
    fs.writeFileSync(
      baselineFile,
      JSON.stringify({ "1000": { next_p95_ms: 0, validate_p95_ms: 0 } }),
      "utf-8",
    );
    try {
      const run = spawnSync(process.execPath, [
        BENCHMARK,
        "--sizes",
        "1000",
        "--samples",
        "3",
        "--check",
        "--absolute-guard-ms",
        "1000:100000",
        "--baseline",
        baselineFile,
        "--json",
      ], {
        cwd: path.resolve("."),
        encoding: "utf-8",
        timeout: 90_000,
      });

      expect(run.status, run.stderr).toBe(1);
      const report = JSON.parse(run.stdout) as {
        policy: { regression_budget_percent: number };
        checks: { ok: boolean; failures: Array<{ type: string; nodes?: number }> };
      };
      expect(report.policy.regression_budget_percent).toBe(20);
      expect(report.checks.ok).toBe(false);
      expect(report.checks.failures.some((failure) =>
        failure.type === "regression_budget" && failure.nodes === 1000,
      )).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 120_000);
});
