#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = "@lukawi/super-plumber";

/** integrations/plugin 内所有会启动 graph-mcp 的 npx 声明，升级时必须一起改版本。 */
export const PINNED_PLUGIN_LAUNCHERS = [
  "integrations/plugin/.mcp.json",
  "integrations/plugin/.codex-plugin/plugin.json",
];

export function expectedPackageSpec(version) {
  return `${PACKAGE_NAME}@${version}`;
}

function readJson(root, file) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) return { exists: false };
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    return {
      exists: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function launcherConfig(json) {
  return json?.mcpServers?.["graph-mcp"];
}

/**
 * npx 依赖更新策略：始终使用 `-y @lukawi/super-plumber@<package.json.version> graph-mcp`。
 * 因此未 pin 和 pin 到旧版本都会在安装/升级前直接失败，而不是静默拉取 latest。
 */
export function checkPinnedPluginDependencies(root = REPO_ROOT) {
  const packageJson = readJson(root, "package.json");
  const version = packageJson.value?.version;
  const packageSpec = expectedPackageSpec(version);
  const checked = [];
  const issues = [];

  if (!packageJson.exists) {
    issues.push({ file: "package.json", field: "<file>", reason: "文件缺失" });
  } else if (packageJson.error) {
    issues.push({ file: "package.json", field: "<json>", reason: `JSON 解析失败：${packageJson.error}` });
  } else if (typeof version !== "string" || version.length === 0) {
    issues.push({ file: "package.json", field: "version", value: version, reason: "version 不是非空字符串" });
  }

  for (const file of PINNED_PLUGIN_LAUNCHERS) {
    const parsed = readJson(root, file);
    if (parsed.exists) checked.push(file);
    if (!parsed.exists) {
      issues.push({ file, field: "<file>", reason: "文件缺失" });
      continue;
    }
    if (parsed.error) {
      issues.push({ file, field: "<json>", reason: `JSON 解析失败：${parsed.error}` });
      continue;
    }

    const launcher = launcherConfig(parsed.value);
    const args = launcher?.args;
    if (launcher?.command !== "npx") {
      issues.push({ file, field: "mcpServers.graph-mcp.command", value: launcher?.command, reason: "必须使用 npx" });
    }
    if (!Array.isArray(args)) {
      issues.push({ file, field: "mcpServers.graph-mcp.args", value: args, reason: "必须是 npx 参数数组" });
      continue;
    }
    const expected = ["-y", packageSpec, "graph-mcp"];
    if (args.length !== expected.length || args.some((arg, index) => arg !== expected[index])) {
      issues.push({
        file,
        field: "mcpServers.graph-mcp.args",
        value: args,
        reason: `必须精确为 ${JSON.stringify(expected)}（禁止 unpinned 或旧版本）`,
      });
    }
  }

  return { ok: issues.length === 0, packageSpec, checked, issues };
}

export function formatDependencyIssues(result) {
  if (result.ok) {
    return `插件 npx 依赖可复现：${result.packageSpec} 已在 ${result.checked.length} 个 launcher 中精确 pin`;
  }
  const lines = [`插件 npx 依赖门禁失败：期望 ${result.packageSpec}`];
  for (const issue of result.issues) {
    const value = issue.value === undefined ? "<缺失>" : JSON.stringify(issue.value);
    lines.push(`- ${issue.file}#${issue.field}: ${value}（${issue.reason}）`);
  }
  lines.push("升级策略：先更新 package.json version，再同步每个 launcher 的精确 package@version 并重跑此门禁。");
  return lines.join("\n");
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const result = checkPinnedPluginDependencies();
  console.log(formatDependencyIssues(result));
  if (!result.ok) process.exitCode = 1;
}
