#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function normalizePath(file) {
  return file.split(path.sep).join("/").toLowerCase();
}

function reportTestFiles(report, projectRoot) {
  return new Set(
    (report.testResults || [])
      .map((suite) => suite?.name || suite?.filepath)
      .filter((file) => typeof file === "string")
      .map((file) => normalizePath(path.relative(projectRoot, file))),
  );
}

function countAssertionStatuses(report, status) {
  let count = 0;
  for (const suite of report.testResults || []) {
    for (const assertion of suite?.assertionResults || []) {
      if (assertion?.status === status) count += 1;
    }
  }
  return count;
}

/**
 * 检查 Vitest JSON 报告：任何 skipped/todo/pending suite 或未收集关键测试都使发布失败。
 * 该函数不依赖当前仓库，测试可以用最小 JSON 失败样本锁住「skipIf 假绿」回归。
 */
export function inspectReleaseTestReport(report, { projectRoot, criticalFiles = [] } = {}) {
  const pendingTests = Math.max(
    Number(report?.numPendingTests || 0),
    countAssertionStatuses(report || {}, "pending"),
    countAssertionStatuses(report || {}, "skipped"),
  );
  const todoTests = Math.max(
    Number(report?.numTodoTests || 0),
    countAssertionStatuses(report || {}, "todo"),
  );
  const pendingSuites = Number(report?.numPendingTestSuites || 0);
  const totalTests = Number(report?.numTotalTests || 0);
  const problems = [];

  if (pendingSuites > 0 || pendingTests > 0 || todoTests > 0) {
    problems.push(
      `测试门禁拒绝跳过用例：pending suites=${pendingSuites}, pending/skipped tests=${pendingTests}, todo=${todoTests}`,
    );
  }
  if (totalTests === 0) {
    problems.push("测试门禁拒绝空测试报告：没有收集到任何测试");
  }

  if (criticalFiles.length > 0) {
    if (!projectRoot) {
      problems.push("测试门禁无法核对关键测试文件：缺少 projectRoot");
    } else {
      const files = reportTestFiles(report || {}, projectRoot);
      const missing = criticalFiles
        .map(normalizePath)
        .filter((file) => !files.has(file));
      if (missing.length > 0) {
        problems.push(`关键测试文件未被收集：${missing.join(", ")}`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }

  return {
    totalTests,
    pendingSuites,
    pendingTests,
    todoTests,
    files: reportTestFiles(report || {}, projectRoot || process.cwd()),
  };
}

/**
 * 检查真实的 v8 coverage-summary.json，避免只生成 coverage 目录却没有数值门禁。
 * 通过 include 由调用方明确本次变更的可测试源码边界，阈值按行覆盖率执行。
 */
export function inspectCoverageSummary(summary, { minimumLines = 0 } = {}) {
  const lines = Number(summary?.total?.lines?.pct);
  const functions = Number(summary?.total?.functions?.pct);
  const branches = Number(summary?.total?.branches?.pct);
  if (![lines, functions, branches].every(Number.isFinite)) {
    throw new Error("coverage 报告缺少有效的 total lines/functions/branches 数值");
  }
  if (lines < minimumLines) {
    throw new Error(`coverage 行覆盖率 ${lines.toFixed(2)}% 低于门槛 ${minimumLines.toFixed(2)}%`);
  }
  return { lines, functions, branches };
}

function parseArgs(argv) {
  const options = {
    project: "root",
    criticalFiles: [],
    coverage: false,
    coverageIncludes: [],
    coverageMinLines: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project") {
      options.project = argv[++index];
    } else if (arg === "--critical-file") {
      options.criticalFiles.push(argv[++index]);
    } else if (arg === "--coverage") {
      options.coverage = true;
    } else if (arg === "--coverage-include") {
      options.coverageIncludes.push(argv[++index]);
    } else if (arg === "--coverage-min-lines") {
      options.coverageMinLines = Number(argv[++index]);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "用法：node scripts/run-release-tests.mjs --project root|web-ui [--critical-file <path>]... [--coverage --coverage-include <path>] [--coverage-min-lines <number>]",
      );
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!new Set(["root", "web-ui"]).has(options.project)) {
    throw new Error(`不支持的测试项目：${options.project}`);
  }
  if (!Number.isFinite(options.coverageMinLines) || options.coverageMinLines < 0 || options.coverageMinLines > 100) {
    throw new Error(`coverage 行覆盖率门槛必须在 0 到 100 之间：${options.coverageMinLines}`);
  }
  return options;
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = options.project === "root" ? REPO_ROOT : path.join(REPO_ROOT, "web-ui");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "super-plumber-release-test-"));
  const reportFile = path.join(tempRoot, "vitest.json");
  const coverageDir = path.join(tempRoot, "coverage");
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const npm = fs.existsSync(npmCli)
    ? process.execPath
    : process.platform === "win32"
      ? "npm.cmd"
      : "npm";
  const npmPrefix = npm === process.execPath ? [npmCli] : [];
  const vitestArgs = ["--reporter=json", "--outputFile", reportFile];
  if (options.coverage) {
    vitestArgs.push(
      "--coverage",
      "--coverage.provider=v8",
      "--coverage.reporter=json-summary",
      "--coverage.reportOnFailure",
      "--coverage.reportsDirectory",
      coverageDir,
      ...options.coverageIncludes.flatMap((file) => ["--coverage.include", file]),
    );
  }
  const npmArgs = options.project === "root"
    ? [...npmPrefix, "test", "--", ...vitestArgs]
    : [...npmPrefix, "--prefix", "web-ui", "test", "--", ...vitestArgs];

  let status = 1;
  try {
    console.log(`发布门禁：${options.project === "root" ? "root" : "web-ui"} test`);
    const result = spawnSync(npm, npmArgs, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    status = result.status ?? 1;

    if (!fs.existsSync(reportFile)) {
      throw new Error("Vitest 未生成 JSON 测试报告，不能把无报告视为通过");
    }
    const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    const summary = inspectReleaseTestReport(report, {
      projectRoot,
      criticalFiles: options.criticalFiles,
    });
    let coverageSummary;
    if (options.coverage) {
      const coverageReportFile = path.join(coverageDir, "coverage-summary.json");
      if (!fs.existsSync(coverageReportFile)) {
        throw new Error("Vitest 未生成 coverage-summary.json，不能把无 coverage 报告视为通过");
      }
      coverageSummary = inspectCoverageSummary(
        JSON.parse(fs.readFileSync(coverageReportFile, "utf8")),
        { minimumLines: options.coverageMinLines },
      );
    }
    if (status !== 0) {
      throw new Error(`测试进程退出码为 ${status}`);
    }
    console.log(
      `发布门禁：${options.project === "root" ? "root" : "web-ui"} test 通过（${summary.totalTests} tests，${summary.files.size} files，未跳过${coverageSummary ? `，行 coverage ${coverageSummary.lines.toFixed(2)}%` : ""}）`,
    );
    status = 0;
  } catch (error) {
    console.error(`发布测试门禁失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  process.exitCode = status;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  run();
}
