#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROOT_CRITICAL_TESTS = [
  "tests/release-gates.test.ts",
  "tests/core/style-lint.test.ts",
  "tests/core/state-machine.test.ts",
  "tests/core/validate.test.ts",
  "tests/cli/commands.test.ts",
  "tests/cli/sp-script.test.ts",
  "tests/cli/sp-targeting.test.ts",
  "tests/mcp/server.test.ts",
];

const UI_CRITICAL_TESTS = [
  "src/lib/store.test.ts",
  "src/lib/api.test.ts",
  "src/lib/render-smoke.test.ts",
  "src/components/GraphCanvas.test.ts",
];

const ROOT_COVERAGE_INCLUDES = [
  "src/core/graph-dir.ts",
  "src/core/style-lint.ts",
  "scripts/plugin-dependency-check.mjs",
  "scripts/release-gates.mjs",
  "scripts/release-version-check.mjs",
  "scripts/run-release-tests.mjs",
];

const UI_COVERAGE_INCLUDES = ["src/components/GraphCanvas.svelte"];

function coverageArgs(minimumLines, files) {
  return [
    "--coverage",
    "--coverage-min-lines",
    String(minimumLines),
    ...files.flatMap((file) => ["--coverage-include", file]),
  ];
}

/**
 * 发布门禁的唯一执行清单。每个 release test 都由 run-release-tests.mjs 执行，
 * 它会保存 JSON 报告并拒绝 skipped/todo/空报告，关键文件列表则防止测试收集面缩水。
 */
export function createReleaseSteps(root = REPO_ROOT) {
  return [
    {
      label: "版本单一来源（package.json/package-lock/manifest）",
      command: process.execPath,
      args: ["scripts/release-version-check.mjs"],
      cwd: root,
    },
    {
      label: "插件 npx 依赖精确版本",
      command: process.execPath,
      args: ["scripts/plugin-dependency-check.mjs"],
      cwd: root,
    },
    {
      label: "root typecheck",
      command: "npm",
      args: ["run", "typecheck"],
      cwd: root,
    },
    {
      label: "root build",
      command: "npm",
      args: ["run", "build"],
      cwd: root,
    },
    {
      label: "发布 CLI/MCP 构建物存在",
      requiredFiles: ["dist/cli/index.js", "dist/mcp/server.js"],
      cwd: root,
    },
    {
      label: "root test + 关键 coverage",
      command: process.execPath,
      args: [
        "scripts/run-release-tests.mjs",
        "--project",
        "root",
        ...coverageArgs(40, ROOT_COVERAGE_INCLUDES),
        ...ROOT_CRITICAL_TESTS.flatMap((file) => ["--critical-file", file]),
      ],
      cwd: root,
    },
    {
      label: "web-ui typecheck",
      command: "npm",
      args: ["--prefix", "web-ui", "run", "typecheck"],
      cwd: root,
    },
    {
      label: "web-ui build",
      command: "npm",
      args: ["--prefix", "web-ui", "run", "build"],
      cwd: root,
    },
    {
      label: "web-ui test + 关键 coverage",
      command: process.execPath,
      args: [
        "scripts/run-release-tests.mjs",
        "--project",
        "web-ui",
        ...coverageArgs(60, UI_COVERAGE_INCLUDES),
        ...UI_CRITICAL_TESTS.flatMap((file) => ["--critical-file", file]),
      ],
      cwd: root,
    },
    {
      label: "integrations gen/sync check",
      command: process.execPath,
      args: ["scripts/sync-integrations.mjs", "--check"],
      cwd: root,
    },
    {
      label: "graph docs export check",
      command: process.execPath,
      args: ["scripts/release-docs-check.mjs"],
      cwd: root,
    },
  ];
}

function executable(command) {
  if (command !== "npm") return command;
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(npmCli)) return { command: process.execPath, prefix: [npmCli] };
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", prefix: [] };
}

function runCommand(step) {
  const resolved = executable(step.command);
  const command = typeof resolved === "string" ? resolved : resolved.command;
  const args = typeof resolved === "string" ? step.args : [...resolved.prefix, ...step.args];
  const result = spawnSync(command, args, {
    cwd: step.cwd,
    stdio: "inherit",
    windowsHide: true,
    shell: typeof resolved === "string" && command.toLowerCase().endsWith(".cmd"),
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`退出码 ${result.status ?? 1}`);
  }
}

function checkRequiredFiles(step) {
  const missing = step.requiredFiles.filter((file) => !fs.existsSync(path.join(step.cwd, file)));
  if (missing.length > 0) {
    throw new Error(`发布门禁所需构建物缺失：${missing.join(", ")}；请先完成 build`);
  }
}

function run() {
  for (const step of createReleaseSteps()) {
    console.log(`\n发布门禁：${step.label}`);
    try {
      if (step.requiredFiles) checkRequiredFiles(step);
      else runCommand(step);
    } catch (error) {
      console.error(`发布门禁失败（${step.label}）：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log("\n发布门禁全部通过：版本、类型、构建、root/UI 测试与关键 coverage、sync、docs export 均已核验。");
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  run();
}
