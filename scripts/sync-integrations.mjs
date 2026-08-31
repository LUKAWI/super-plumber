#!/usr/bin/env node
/**
 * super-plumber 机械共享件构建期同步脚本 v0.6.1
 *
 * 用途：
 *   将 integrations/shared/ 下的机械共享件（Operations 手册、斜杠命令文案、sp-* 执行脚本）
 *   字节级拷贝到各集成包的约定位置，使三方拷贝与正本一致；对提示词类文件不做任何处理
 *   （三工具提示词按 ADR-0001 分别手写，不归本脚本管）。
 *
 * 正本位约定：
 *   integrations/shared/ 是唯一权威源；
 *   .pi/skills/plumber-execute/scripts/ 与 integrations/plugin/ 内均为下游拷贝。
 *
 * 挂点：
 *   package.json "prepublishOnly" 以 `node scripts/sync-integrations.mjs --check` 作为发布门禁（仅断言）；
 *   默认模式（无参数）执行拷贝后断言零差异，用于本地修复漂移。
 *
 * 行为：
 *   node scripts/sync-integrations.mjs          # 同步：执行拷贝使三方与正本一致，然后断言
 *   node scripts/sync-integrations.mjs --check  # 仅断言：共享件缺失/漂移，或版本面不一致 → 列出差异清单并 exit(1)
 *
 * 版本面门禁（IL-016，--check 路径）：额外断言 package.json 的 version 与各 manifest 一致——
 *   .claude-plugin/marketplace.json（plugins[].version）、integrations/plugin/.claude-plugin/plugin.json（version）；
 *   0.9.5 起加 .codex-plugin/plugin.json 与 .agents/plugins/marketplace.json。
 *   manifest 文件存在才校验其 version，不存在跳过（前向兼容，不硬编码报错）；
 *   不一致 exit(1) 并逐条列出差异文件与两边版本值。发版步骤见 README「发版清单」。
 *
 * 映射约定来源：
 *   docs/multitool-v061/integration-blueprint.md §3（权威映射表）＋
 *   integrations/shared/commands/*.md 头注释。变更落位前先改蓝图再改此处。
 *
 * 实现：Node >=20 ESM，零依赖，跨平台（路径用 node:path，hash 用 node:crypto）。
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_ROOT = path.join(REPO_ROOT, 'integrations', 'shared');

/** 单一 SOURCE 数组驱动全部映射：{ dir: 正本子目录 | '' , filter: 文件名过滤, targets: 目标目录数组（相对仓库根） }
 *  - manual.md：仅向两个插件包根拷贝（pi 按相对路径直引正本，见蓝图 §3 第一行）。 */
const SOURCES = [
  {
    name: 'manual.md（Operations 手册）',
    dir: '',
    filter: (name) => name === 'manual.md',
    targets: ['integrations/plugin'],
  },
  {
    name: 'commands/*.md（斜杠命令文案）',
    dir: 'commands',
    filter: (name) => name.endsWith('.md'),
    targets: [
      'integrations/plugin/commands',
    ],
  },
  {
    name: 'sp-scripts/*.mjs（执行期共享脚本）',
    dir: 'sp-scripts',
    filter: (name) => name.endsWith('.mjs'),
    targets: [
      path.join('.pi', 'skills', 'plumber-execute', 'scripts'),
      'integrations/plugin/scripts',
    ],
  },
];

/** 构建扁平拷贝计划：[{ relName, srcAbs, targetAbs }] */
function buildPlan() {
  const plan = [];
  for (const source of SOURCES) {
    const srcDirAbs = source.dir ? path.join(SHARED_ROOT, source.dir) : SHARED_ROOT;
    if (!fs.existsSync(srcDirAbs)) {
      fail(`正本目录不存在：${path.relative(REPO_ROOT, srcDirAbs)}`);
    }
    const files = fs.readdirSync(srcDirAbs).filter(source.filter).sort();
    if (files.length === 0) {
      fail(`正本目录没有任何匹配文件：${path.relative(REPO_ROOT, srcDirAbs)}`);
    }
    for (const file of files) {
      const srcAbs = path.join(srcDirAbs, file);
      const targetRels = source.targets.map((t) => path.join(t, file));
      for (const targetRel of targetRels) {
        plan.push({
          relName: file,
          displayTarget: targetRel.split(path.sep).join('/'),
          srcAbs,
          targetAbs: path.join(REPO_ROOT, targetRel),
        });
      }
    }
  }
  return plan;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fail(message) {
  console.error(`sync-integrations: ${message}`);
  process.exit(2);
}

/** 审计每一条目标：缺失 / 漂移 / 一致 */
function audit(plan) {
  const diffs = [];
  let okCount = 0;
  for (const item of plan) {
    if (!fs.existsSync(item.srcAbs)) {
      diffs.push({ ...item, status: '正本缺失' });
      continue;
    }
    if (!fs.existsSync(item.targetAbs)) {
      diffs.push({ ...item, status: '缺失' });
      continue;
    }
    if (statIsDir(item.targetAbs)) {
      diffs.push({ ...item, status: '同名路径是目录，无法覆盖' });
      continue;
    }
    const expected = sha256(item.srcAbs);
    const actual = sha256(item.targetAbs);
    if (expected !== actual) {
      diffs.push({ ...item, status: '漂移', expected, actual });
    } else {
      okCount += 1;
    }
  }
  return { diffs, okCount };
}

function statIsDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** IL-016 版本面断言的被查 manifest 清单（相对仓库根，显示用 POSIX 风格）。 */
const VERSION_MANIFESTS = [
  '.claude-plugin/marketplace.json',
  'integrations/plugin/.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.agents/plugins/marketplace.json',
];

/** 从 manifest JSON 取 version：plugin.json 在顶层；marketplace.json 在 plugins[0].version。 */
function readManifestVersion(json) {
  if (typeof json?.version === 'string') return json.version;
  if (Array.isArray(json?.plugins) && typeof json.plugins[0]?.version === 'string') {
    return json.plugins[0].version;
  }
  return undefined;
}

/** 版本面一致性断言（IL-016）：manifest 存在才校验，不存在跳过（前向兼容）。
 *  返回 { pkgVersion, checked, mismatches }；mismatches 元素形如 { file, manifestVersion }，
 *  manifestVersion 为 undefined 表示文件在位但没有可读的 version 字段。 */
function checkVersions() {
  const pkgVersion = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
  ).version;
  const mismatches = [];
  let checked = 0;
  for (const relFile of VERSION_MANIFESTS) {
    const abs = path.join(REPO_ROOT, relFile);
    if (!fs.existsSync(abs)) continue;
    checked += 1;
    let manifestVersion;
    try {
      manifestVersion = readManifestVersion(JSON.parse(fs.readFileSync(abs, 'utf8')));
    } catch (e) {
      mismatches.push({ file: relFile, manifestVersion: `<解析失败：${e.message}>` });
      continue;
    }
    if (manifestVersion !== pkgVersion) {
      mismatches.push({ file: relFile, manifestVersion });
    }
  }
  return { pkgVersion, checked, mismatches };
}

function printVersionMismatches({ pkgVersion, mismatches }) {
  console.error(
    `\n版本面一致性断言失败（IL-016）：以下 manifest 的 version 与 package.json（${pkgVersion}）不一致：`
  );
  for (const m of mismatches) {
    const shown = m.manifestVersion ?? '<文件在位但未找到 version 字段>';
    console.error(`- ${m.file}: ${shown} ≠ package.json ${pkgVersion}`);
  }
  console.error(
    `修复方式：发版时把上述文件的 version 与 package.json 改为同一值（步骤见 README「发版清单」）。`
  );
}

function printDiffs(diffs) {
  console.error('\n差异清单（文件 × 期望 sha256 × 实际状态）：');
  for (const d of diffs.sort((a, b) => a.displayTarget.localeCompare(b.displayTarget))) {
    console.error(`- [${d.status}] ${d.displayTarget}`);
    if (d.status === '漂移') {
      console.error(`    期望 sha256: ${d.expected}（正本 integrations/shared/${d.relName}）`);
      console.error(`    实际 sha256: ${d.actual}`);
    }
  }
}

/** 默认模式：把与正本不一致（含缺失）的目标用正本覆盖（字节级），并保持 POSIX 执行位 */
function sync(plan) {
  let written = 0;
  for (const item of plan) {
    if (
      !fs.existsSync(item.targetAbs) ||
      (!statIsDir(item.targetAbs) && sha256(item.srcAbs) !== sha256(item.targetAbs))
    ) {
      fs.mkdirSync(path.dirname(item.targetAbs), { recursive: true });
      fs.copyFileSync(item.srcAbs, item.targetAbs);
      try {
        fs.chmodSync(item.targetAbs, fs.statSync(item.srcAbs).mode & 0o777);
      } catch {
        /* Windows 上 chmod 基本为 no-op，失败可忽略 */
      }
      written += 1;
      console.log(`已同步: ${item.displayTarget}`);
    }
  }
  return written;
}

function main() {
  const checkOnly = process.argv.slice(2).includes('--check');
  const plan = buildPlan();
  const sharedFileCount = new Set(plan.map((p) => p.srcAbs)).size;

  if (!checkOnly) {
    const written = sync(plan);
    console.log(
      `同步完成：${written} 个目标被写入${written === 0 ? '（本就一致，未改动）' : ''}。`
    );
  }

  const { diffs, okCount } = audit(plan);

  // --check 是 prepublishOnly 第一道门禁，同场断言版本面一致性（IL-016）
  const versionFace = checkOnly ? checkVersions() : null;

  if (diffs.length > 0 || (versionFace && versionFace.mismatches.length > 0)) {
    if (versionFace && versionFace.mismatches.length > 0) {
      printVersionMismatches(versionFace);
    }
    if (diffs.length > 0) {
      printDiffs(diffs);
      console.error(
        `\n校验失败：${diffs.length}/${plan.length} 个目标位不一致（--check 不做任何写入）。` +
          `\n修复方式：运行 \`node scripts/sync-integrations.mjs\`（默认模式重新播种）。` +
          `\n若改动的是插件包内文案本身（如 commands/manual），请改 integrations/shared/ 正本后再同步——下游拷贝禁止手改。`
      );
    }
    process.exit(1);
  }

  if (versionFace) {
    console.log(
      `版本面一致：package.json ${versionFace.pkgVersion} 与在位 ${versionFace.checked}/${VERSION_MANIFESTS.length} 份 manifest 全部一致`
    );
  }

  console.log(
    `${sharedFileCount} 个共享件 × ${okCount} 个目标 全部一致`
  );
}

main();
