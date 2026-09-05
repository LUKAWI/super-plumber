import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 发版版本面唯一来源为 package.json；其余字段都是必须与它相等的发布输入。
 * 对 marketplace 同时检查顶层版本和每个插件条目的版本，避免只校验第一处而漏漂移。
 */
export const RELEASE_VERSION_FILES = [
  { file: "package-lock.json", kind: "lockfile" },
  { file: ".claude-plugin/marketplace.json", kind: "marketplace" },
  { file: ".agents/plugins/marketplace.json", kind: "marketplace" },
  { file: "integrations/plugin/.claude-plugin/plugin.json", kind: "plugin" },
  { file: "integrations/plugin/.codex-plugin/plugin.json", kind: "plugin" },
];

const RELEASE_MANIFEST_COUNT = RELEASE_VERSION_FILES.filter((spec) => spec.kind !== "lockfile").length;

function readJson(root, file) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) {
    return { exists: false, value: undefined };
  }
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    return {
      exists: true,
      value: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function addRecord(records, file, location, value, extra = {}) {
  records.push({ file, location, value, ...extra });
}

/** 读取所有发布相关 version 字段；不把依赖包的版本误当成项目版本。 */
export function collectVersionRecords(root = REPO_ROOT) {
  const records = [];

  for (const spec of RELEASE_VERSION_FILES) {
    const parsed = readJson(root, spec.file);
    if (!parsed.exists) {
      addRecord(records, spec.file, "<file>", undefined, { exists: false });
      continue;
    }
    if (parsed.error) {
      addRecord(records, spec.file, "<json>", undefined, { error: parsed.error });
      continue;
    }

    if (spec.kind === "lockfile") {
      addRecord(records, spec.file, "version", parsed.value?.version);
      addRecord(records, spec.file, 'packages[""].version', parsed.value?.packages?.[""]?.version);
      continue;
    }

    addRecord(records, spec.file, "version", parsed.value?.version);
    if (spec.kind === "marketplace") {
      const plugins = Array.isArray(parsed.value?.plugins) ? parsed.value.plugins : [];
      plugins.forEach((plugin, index) => {
        addRecord(records, spec.file, `plugins[${index}].version`, plugin?.version);
      });
      if (plugins.length === 0) {
        addRecord(records, spec.file, "plugins[0].version", undefined);
      }
    }
  }

  return records;
}

/**
 * 校验 package.json -> package-lock/marketplace/plugin manifests 的版本单一来源。
 * 返回结构化结果供门禁、sync 脚本和测试复用，不在库函数内退出进程。
 */
export function checkReleaseVersions(root = REPO_ROOT) {
  const packageJson = readJson(root, "package.json");
  const sourceVersion = packageJson.value?.version;
  const issues = [];

  if (!packageJson.exists) {
    issues.push({ file: "package.json", location: "<file>", value: undefined, reason: "文件缺失" });
  } else if (packageJson.error) {
    issues.push({ file: "package.json", location: "<json>", value: undefined, reason: packageJson.error });
  } else if (typeof sourceVersion !== "string" || sourceVersion.length === 0) {
    issues.push({ file: "package.json", location: "version", value: sourceVersion, reason: "version 不是非空字符串" });
  }

  const records = collectVersionRecords(root);
  for (const record of records) {
    if (record.exists === false) {
      issues.push({ ...record, reason: "文件缺失" });
    } else if (record.error) {
      issues.push({ ...record, reason: `JSON 解析失败：${record.error}` });
    } else if (record.value !== sourceVersion) {
      issues.push({ ...record, reason: `与 package.json version（${sourceVersion ?? "<缺失>"}）不一致` });
    }
  }

  return {
    ok: issues.length === 0,
    sourceVersion,
    records,
    issues,
  };
}

export function formatVersionIssues(result) {
  if (result.ok) {
    return `版本面一致：package.json ${result.sourceVersion} 与 package-lock、${RELEASE_MANIFEST_COUNT} 份发布 manifest 全部一致`;
  }

  const lines = [
    `版本面一致性门禁失败：package.json version=${result.sourceVersion ?? "<缺失>"}`,
  ];
  for (const issue of result.issues) {
    const value = issue.value === undefined ? "<缺失>" : String(issue.value);
    lines.push(`- ${issue.file}#${issue.location}: ${value}（${issue.reason}）`);
  }
  lines.push("修复方式：只以 package.json version 为源，更新 package-lock 与全部发布 manifest 后重跑门禁。");
  return lines.join("\n");
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const result = checkReleaseVersions();
  console.log(formatVersionIssues(result));
  if (!result.ok) process.exitCode = 1;
}
