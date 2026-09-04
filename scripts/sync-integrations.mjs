#!/usr/bin/env node
/**
 * super-plumber 集成资产 gen 引擎（0.9.4 S01 单真相源重组，adr_0008）
 *
 * 模型（sync → gen）：
 *   integrations/src/ 是唯一正本区（skill / agent / 命令 / 手册 / 脚本）；
 *   .pi/、integrations/plugin/、integrations/shared/ 全部是本脚本的生成产物——
 *   默认模式执行生成（正本 → 渠道产物），--check 把渲染结果与盘上产物逐字节比对，
 *   不一致即 exit(1)（生成完整性检查，替代 0.6.1 的 sha256 三方同步断言）。
 *
 * 渠道与模板：
 *   渠道 = pi（.pi/ 视图，仓库根寻址）与 plugin（integrations/plugin/ 插件包视图，包根寻址）。
 *   正本可用模板标记（仅存在于 integrations/src/，渲染后不出现在产物）：
 *     {{#pi}}...{{/pi}} / {{#plugin}}...{{/plugin}}  渠道条件块（可多段，不嵌套）
 *     {{manual}} / {{base}} / {{scripts}}            渠道变量（见 VARS；未登记的 {{...}}
 *                                                    占位符原样透传，如 {{executor-agent-types}}）
 *   SKILL/agents 双副本传导因此是机器性质：改正本一处，两渠道产物由本脚本生成，
 *   --check 拦截任何手改产物或漏生成（0.9.1 漏传类事故的门禁根治，issue log B1 / IL-028）。
 *
 * 挂点：
 *   package.json "prepublishOnly" 以 `node scripts/sync-integrations.mjs --check` 作为发布门禁（仅断言）；
 *   .github/workflows/ci.yml 以同命令做生成完整性检查；
 *   默认模式（无参数）执行生成后断言零差异，用于本地重新播种产物。
 *
 * 行为：
 *   node scripts/sync-integrations.mjs          # 生成：正本 → 渠道产物，然后断言零差异
 *   node scripts/sync-integrations.mjs --check  # 仅断言：产物缺失/被手改，或版本面不一致 → 列出差异清单并 exit(1)
 *
 * 散文锚点门禁（0.9.4 C7b，--check 路径）：把会漂移的散文计数行纳入机器断言——
 *   (a) integrations/src/manual.md 版本锚点行（可 grep 模板 `> **版本锚点**：super-plumber **<x.y.z>**（`）
 *       的版本 == package.json version；
 *   (b) README「项目状态」状态行（可 grep 模板
 *       `Tests: <n>（后端）+ <n>（前端）✅ | CLI: <n> 命令 | MCP: <n> 工具 |`）== 实测值：
 *       CLI 命令数从 dist/cli/index.js 数 `.addCommand(`（dist 缺失回退 src/cli/index.ts，CI 冷启动步骤），
 *       MCP 工具数从 dist/mcp/server.js 数 `.registerTool(`（同上回退 src/mcp/server.ts），
 *       测试计数动态取 vitest list --json（后端=仓库根、前端=web-ui；vitest 不可用时该项跳过并提示）。
 *   断言只读不写，失败逐条列出并随 --check 一起 exit(1)。
 *
 * 版本面门禁（IL-016，--check 路径，原样保留）：断言 package.json 的 version 与各 manifest 一致——
 *   .claude-plugin/marketplace.json（plugins[].version）、integrations/plugin/.claude-plugin/plugin.json（version）；
 *   0.9.5 起加 .codex-plugin/plugin.json 与 .agents/plugins/marketplace.json。
 *   manifest 文件存在才校验其 version，不存在跳过（前向兼容，不硬编码报错）；
 *   不一致 exit(1) 并逐条列出差异文件与两边版本值。发版步骤见 README「发版清单」。
 *
 * 兼容投影说明：integrations/shared/ 仅保留 manual.md（pi 渠道手册寻址位）与 commands/
 *   （tests/sync-commands.test.ts 钉住）两类兼容投影；执行脚本的 shared 投影已随
 *   0.9.4 S03 八脚本收敛退役（tests 同步迁移到 integrations/src/ 正本位运行）。
 *
 * 实现：Node >=20 ESM，零依赖，跨平台（路径用 node:path）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(REPO_ROOT, 'integrations', 'src');

/** 渠道变量表：SKILL/agents/manual 正本里 {{manual}} / {{base}} / {{scripts}} 的渠道取值
 *  （寻址约定 → 手册 §11；{{scripts}} = 执行脚本运行位，manual §2.6 质检寻址用）。 */
const VARS = {
  pi: {
    manual: 'integrations/shared/manual.md',
    base: '仓库根',
    scripts: '.pi/skills/plumber-execute/scripts',
  },
  plugin: {
    manual: './manual.md',
    base: '插件包根',
    scripts: 'scripts',
  },
};

/** 渠道条件块标记 → 是否保留该块。 */
const CHANNELS = ['pi', 'plugin'];

/**
 * 字节拷贝类映射（正本子目录 → 各产物目录）。单一 SOURCE 数组驱动：
 *  - commands/*.md：glob 驱动，第 5 个命令正本落 integrations/src/commands/ 即自动纳入。
 *  - 执行脚本（.mjs）：sp.mjs 单入口 + sp-check-design.mjs 设计体检（S03 八脚本收敛后），两渠道运行位。
 *  manual.md（Operations 手册）已不在此表：S03 起 §2.6 质检寻址渠道自适应（{{scripts}} 变量），
 *  移入 TEMPLATED 按渠道渲染 → shared（pi 寻址位）与插件包根。
 */
const SOURCES = [
  {
    name: 'commands/*.md（斜杠命令文案）',
    dir: 'commands',
    filter: (name) => name.endsWith('.md'),
    targets: [
      'integrations/shared/commands',
      'integrations/plugin/commands',
    ],
  },
  {
    name: 'sp-scripts/*.mjs（sp.mjs 单入口 + sp-check-design.mjs 设计体检）',
    dir: 'sp-scripts',
    filter: (name) => name.endsWith('.mjs'),
    targets: [
      path.join('.pi', 'skills', 'plumber-execute', 'scripts'),
      'integrations/plugin/scripts',
    ],
  },
  // S02 附件分层（0.9.4，adr_0008/DEC-4）：skill 主文档的 attachments/ 细则面，glob 驱动字节拷贝两渠道。
  // 附件正本不含渠道模板标记（寻址写法渠道中立），无需渲染；两渠道内附件与 SKILL.md 同目录，相对引用可解析。
  {
    name: 'skills/plumber-design/attachments/*.md（S02 主文档附件分层）',
    dir: path.join('skills', 'plumber-design', 'attachments'),
    filter: (name) => name.endsWith('.md'),
    targets: [
      path.join('.pi', 'skills', 'plumber-design', 'attachments'),
      path.join('integrations', 'plugin', 'skills', 'plumber-design', 'attachments'),
    ],
  },
  {
    name: 'skills/plumber-execute/attachments/*.md（S02 主文档附件分层）',
    dir: path.join('skills', 'plumber-execute', 'attachments'),
    filter: (name) => name.endsWith('.md'),
    targets: [
      path.join('.pi', 'skills', 'plumber-execute', 'attachments'),
      path.join('integrations', 'plugin', 'skills', 'plumber-execute', 'attachments'),
    ],
  },
];

/** 单文件字节拷贝（不成目录 glob）：{ src: 正本相对路径, targets: 产物目录数组 }
 *  排序约定：本表必须位于 SOURCES 之后——tests/sync-commands.test.ts 以
 *  「dir: 'commands' … 首个 sp-scripts」切片断言 commands 登记为 glob 驱动（无逐命令点名）。 */
const COPIES = [
  {
    src: path.join('sp-scripts', 'README.md'),
    targets: [
      path.join('.pi', 'skills', 'plumber-execute', 'scripts'),
      'integrations/plugin/scripts',
    ],
  },
];

/** 模板渲染类映射（manual/SKILL/agents 双渠道传导面）：{ src, outs: { pi, plugin } } */
const TEMPLATED = [
  {
    src: 'manual.md',
    outs: {
      pi: path.join('integrations', 'shared', 'manual.md'),
      plugin: path.join('integrations', 'plugin', 'manual.md'),
    },
  },
  {
    src: path.join('skills', 'plumber-design', 'SKILL.md'),
    outs: {
      pi: path.join('.pi', 'skills', 'plumber-design', 'SKILL.md'),
      plugin: path.join('integrations', 'plugin', 'skills', 'plumber-design', 'SKILL.md'),
    },
  },
  {
    src: path.join('skills', 'plumber-execute', 'SKILL.md'),
    outs: {
      pi: path.join('.pi', 'skills', 'plumber-execute', 'SKILL.md'),
      plugin: path.join('integrations', 'plugin', 'skills', 'plumber-execute', 'SKILL.md'),
    },
  },
  {
    src: path.join('skills', 'plumber-join', 'SKILL.md'),
    outs: {
      pi: path.join('.pi', 'skills', 'plumber-join', 'SKILL.md'),
      plugin: path.join('integrations', 'plugin', 'skills', 'plumber-join', 'SKILL.md'),
    },
  },
  {
    src: path.join('skills', 'sp-grilling', 'SKILL.md'),
    outs: {
      pi: path.join('.pi', 'skills', 'sp-grilling', 'SKILL.md'),
      plugin: path.join('integrations', 'plugin', 'skills', 'sp-grilling', 'SKILL.md'),
    },
  },
  // 纪律技能族（DEC-6，adr_0005）：正本住 src/skills/disciplines/<name>/，产物仍落两渠道
  // skills/<name>/ 平面位（宿主技能发现只扫一层， disciplines/ 只是正本区的族命名空间）。
  {
    src: path.join('skills', 'disciplines', 'plumber-tdd', 'SKILL.md'),
    outs: {
      pi: path.join('.pi', 'skills', 'plumber-tdd', 'SKILL.md'),
      plugin: path.join('integrations', 'plugin', 'skills', 'plumber-tdd', 'SKILL.md'),
    },
  },
  {
    src: path.join('skills', 'disciplines', 'plumber-review', 'SKILL.md'),
    outs: {
      pi: path.join('.pi', 'skills', 'plumber-review', 'SKILL.md'),
      plugin: path.join('integrations', 'plugin', 'skills', 'plumber-review', 'SKILL.md'),
    },
  },
  {
    src: path.join('agents', 'sp-designer.md'),
    outs: {
      pi: path.join('.pi', 'agents', 'sp-designer.md'),
      plugin: path.join('integrations', 'plugin', 'agents', 'sp-designer.md'),
    },
  },
  {
    src: path.join('agents', 'super-mario.md'),
    outs: {
      pi: path.join('.pi', 'agents', 'super-mario.md'),
      plugin: path.join('integrations', 'plugin', 'agents', 'super-mario.md'),
    },
  },
  {
    src: path.join('agents', 'sp-executor.md'),
    outs: {
      pi: path.join('.pi', 'agents', 'sp-executor.md'),
      plugin: path.join('integrations', 'plugin', 'agents', 'sp-executor.md'),
    },
  },
];

/** 构建字节拷贝计划：[{ displayTarget, srcAbs, targetAbs }] */
function buildCopyPlan() {
  const plan = [];
  for (const source of SOURCES) {
    const srcDirAbs = path.join(SRC_ROOT, source.dir);
    if (!fs.existsSync(srcDirAbs)) {
      fail(`正本目录不存在：${display(srcDirAbs)}`);
    }
    const files = fs.readdirSync(srcDirAbs).filter(source.filter).sort();
    if (files.length === 0) {
      fail(`正本目录没有任何匹配文件：${display(srcDirAbs)}`);
    }
    for (const file of files) {
      for (const targetRel of source.targets) {
        plan.push({
          displayTarget: display(path.join(targetRel, file)),
          srcAbs: path.join(srcDirAbs, file),
          targetAbs: path.join(REPO_ROOT, targetRel, file),
        });
      }
    }
  }
  for (const copy of COPIES) {
    const srcAbs = path.join(SRC_ROOT, copy.src);
    if (!fs.existsSync(srcAbs)) {
      fail(`正本文件不存在：${display(srcAbs)}`);
    }
    for (const targetRel of copy.targets) {
      plan.push({
        displayTarget: display(path.join(targetRel, path.basename(copy.src))),
        srcAbs,
        targetAbs: path.join(REPO_ROOT, targetRel, path.basename(copy.src)),
      });
    }
  }
  return plan;
}

/** 构建模板渲染计划：[{ displayTarget, srcAbs, targetAbs, channel }] */
function buildTemplatePlan() {
  const plan = [];
  for (const entry of TEMPLATED) {
    const srcAbs = path.join(SRC_ROOT, entry.src);
    if (!fs.existsSync(srcAbs)) {
      fail(`正本文件不存在：${display(srcAbs)}`);
    }
    for (const channel of CHANNELS) {
      plan.push({
        displayTarget: `${display(entry.outs[channel])} [${channel}]`,
        srcAbs,
        targetAbs: path.join(REPO_ROOT, entry.outs[channel]),
        channel,
      });
    }
  }
  return plan;
}

/** 渲染一个正本为指定渠道产物文本；渲染后残留任何未闭合条件块标记即硬失败。 */
function render(srcAbs, channel) {
  let text = fs.readFileSync(srcAbs, 'utf8');
  for (const ch of CHANNELS) {
    const re = new RegExp(`\\{\\{#${ch}\\}\\}([\\s\\S]*?)\\{\\{/${ch}\\}\\}`, 'g');
    text = text.replace(re, ch === channel ? '$1' : '');
  }
  for (const [key, value] of Object.entries(VARS[channel])) {
    text = text.split(`{{${key}}}`).join(value);
  }
  if (text.includes('{{#') || text.includes('{{/')) {
    fail(`模板渲染后残留条件块标记（正本标记不配对）：${display(srcAbs)}`);
  }
  return text;
}

function display(abs) {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

function fail(message) {
  console.error(`sync-integrations: ${message}`);
  process.exit(2);
}

/** 审计每一条目标：缺失 / 漂移 / 一致（模板条目按渲染结果比对，拷贝条目按字节比对）。 */
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
      diffs.push({ ...item, status: '同名路径是目录，无法写入' });
      continue;
    }
    const expected = item.channel
      ? render(item.srcAbs, item.channel)
      : fs.readFileSync(item.srcAbs, 'utf8');
    const actual = fs.readFileSync(item.targetAbs, 'utf8');
    if (expected !== actual) {
      diffs.push({ ...item, status: '漂移（手改产物或未重新生成）' });
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

/** 读 package.json 的 version（版本面门禁 IL-016 与散文锚点门禁 C7b 共用）。 */
function readPkgVersion() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
}

/** 版本面一致性断言（IL-016）：manifest 存在才校验，不存在跳过（前向兼容）。
 *  返回 { pkgVersion, checked, mismatches }；mismatches 元素形如 { file, manifestVersion }，
 *  manifestVersion 为 undefined 表示文件在位但没有可读的 version 字段。 */
function checkVersions() {
  const pkgVersion = readPkgVersion();
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

// ---------------------------------------------------------------------------
// 散文锚点断言（0.9.4 C7b，仅 --check 路径）：散文名义值 == 机器实测值。
// 原则：锚点行先固化成可 grep 模板再断言；断言只读不写；测不了的项明确跳过并提示，绝不静默。
// ---------------------------------------------------------------------------

/** manual 正本版本锚点行的可 grep 模板（捕获组 1 = 版本号，兼容 prerelease 如 0.9.4-rc.1）。 */
const MANUAL_VERSION_ANCHOR_RE =
  /^> \*\*版本锚点\*\*：super-plumber \*\*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\*\*（/gm;

/** README「项目状态」状态行前缀的可 grep 模板（捕获组：后端用例数/前端用例数/CLI 命令数/MCP 工具数；
 *  行内该前缀之后的自由文本不受约束）。 */
const README_STATUS_LINE_RE =
  /^Tests: (\d+)（后端）\+ (\d+)（前端）✅ \| CLI: (\d+) 命令 \| MCP: (\d+) 工具 \|/gm;

/** 统计文件内 pattern 出现次数；文件缺失返回 null。 */
function countPatternInFile(relPath, pattern) {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return (fs.readFileSync(abs, 'utf8').match(pattern) || []).length;
}

/** CLI 命令注册数：优先编译产物 dist（发布门禁口径），CI 冷启动步骤尚无 dist 时回退源码统计
 *  （tsc 编译不改 addCommand 调用数，两口径同值）；两处都不可读返回 null。 */
function measureCliCommands() {
  const dist = countPatternInFile(path.join('dist', 'cli', 'index.js'), /\.addCommand\(/g);
  if (dist !== null) return { count: dist, source: 'dist/cli/index.js 的 .addCommand( 计数' };
  const src = countPatternInFile(path.join('src', 'cli', 'index.ts'), /\.addCommand\(/g);
  if (src !== null) {
    return { count: src, source: 'src/cli/index.ts 的 .addCommand( 计数（dist 缺失，回退源码）' };
  }
  return null;
}

/** MCP 工具注册数：口径同 measureCliCommands（registerTool）。 */
function measureMcpTools() {
  const dist = countPatternInFile(path.join('dist', 'mcp', 'server.js'), /\.registerTool\(/g);
  if (dist !== null) return { count: dist, source: 'dist/mcp/server.js 的 .registerTool( 计数' };
  const src = countPatternInFile(path.join('src', 'mcp', 'server.ts'), /\.registerTool\(/g);
  if (src !== null) {
    return { count: src, source: 'src/mcp/server.ts 的 .registerTool( 计数（dist 缺失，回退源码）' };
  }
  return null;
}

/** 从 vitest list --json 输出统计 { tests, files }：兼容 flat 形态（vitest 2/3 实测：
 *  顶层为 [{name, file}] 用例平铺表），也兼容嵌套形态（suite.tasks 递归）以对抗版本演化。 */
function summarizeVitestList(stdout) {
  const start = stdout.indexOf('[');
  if (start < 0) return null;
  const data = JSON.parse(stdout.slice(start));
  const flat = Array.isArray(data) && data.every((e) => typeof e?.name === 'string' && typeof e?.file === 'string');
  if (flat) {
    return { tests: data.length, files: new Set(data.map((e) => e.file)).size };
  }
  let tests = 0;
  const files = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'test' || (!Array.isArray(node.tasks) && typeof node.name === 'string')) {
      tests += 1;
      return;
    }
    for (const child of node.tasks || []) walk(child);
  };
  const roots = Array.isArray(data) ? data : [data];
  for (const root of roots) {
    walk(root);
    if (typeof root?.file === 'string') files.add(root.file);
    else if (typeof root?.filepath === 'string') files.add(root.filepath);
  }
  return tests > 0 ? { tests, files: files.size } : null;
}

/** 在指定项目目录动态取测试计数（vitest list --json，收集但不执行）。
 *  vitest 未安装（如 CI 冷启动步骤）或收集失败返回 null，调用方跳过该项并明示。 */
function measureTests(projectDir) {
  const vitestBin = path.join(REPO_ROOT, projectDir, 'node_modules', 'vitest', 'vitest.mjs');
  if (!fs.existsSync(vitestBin)) return null;
  const res = spawnSync(process.execPath, [vitestBin, 'list', '--json'], {
    cwd: path.join(REPO_ROOT, projectDir),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0 || !res.stdout) return null;
  try {
    return summarizeVitestList(res.stdout);
  } catch {
    return null;
  }
}

/** 散文锚点断言（C7b）：返回 { issues, notes, summary }。
 *  issues 非空 → --check 以 exit(1) 拦截；notes 为「测不了而跳过」的明示；summary 为成功摘要。 */
function checkProseAnchors() {
  const issues = [];
  const notes = [];
  const pkgVersion = readPkgVersion();

  // (a) manual 正本版本锚点行 == package.json version（只读正本；产物拷贝另有字节比对覆盖）
  const manualMatches = [
    ...fs.readFileSync(path.join(SRC_ROOT, 'manual.md'), 'utf8').matchAll(MANUAL_VERSION_ANCHOR_RE),
  ];
  if (manualMatches.length === 0) {
    issues.push(
      'integrations/src/manual.md 未找到版本锚点行（模板：`> **版本锚点**：super-plumber **<x.y.z>**（`）'
    );
  } else if (manualMatches.length > 1) {
    issues.push(`integrations/src/manual.md 版本锚点行出现 ${manualMatches.length} 次（应为恰好 1 次）`);
  } else if (manualMatches[0][1] !== pkgVersion) {
    issues.push(
      `integrations/src/manual.md 版本锚点 ${manualMatches[0][1]} ≠ package.json ${pkgVersion}` +
        `（发版时改正本锚点行，再运行 node scripts/sync-integrations.mjs 刷新产物）`
    );
  }

  // (b) README「项目状态」状态行 == 实测（CLI/MCP 从 dist（缺省回退 src）数注册；测试计数 vitest list 动态取）
  const statusMatches = [
    ...fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8').matchAll(README_STATUS_LINE_RE),
  ];
  const measured = [];
  if (statusMatches.length !== 1) {
    issues.push(
      `README.md 项目状态行匹配到 ${statusMatches.length} 处（应为恰好 1 处；` +
        '模板：`Tests: <n>（后端）+ <n>（前端）✅ | CLI: <n> 命令 | MCP: <n> 工具 |`）'
    );
  } else {
    const [, testsBack, testsFront, cliCount, mcpCount] = statusMatches[0];

    const cli = measureCliCommands();
    if (cli) {
      measured.push(`CLI ${cli.count}（${cli.source}）`);
      if (cli.count !== Number(cliCount)) {
        issues.push(
          `README 状态行 CLI 命令数 ${cliCount} ≠ 实测 ${cli.count}` +
            `（计数源：${cli.source}；增删命令后同步刷新 README）`
        );
      }
    } else {
      notes.push('CLI 命令数未校验：dist/cli/index.js 与 src/cli/index.ts 均不可读');
    }

    const mcp = measureMcpTools();
    if (mcp) {
      measured.push(`MCP ${mcp.count}（${mcp.source}）`);
      if (mcp.count !== Number(mcpCount)) {
        issues.push(
          `README 状态行 MCP 工具数 ${mcpCount} ≠ 实测 ${mcp.count}` +
            `（计数源：${mcp.source}；增删工具后同步刷新 README）`
        );
      }
    } else {
      notes.push('MCP 工具数未校验：dist/mcp/server.js 与 src/mcp/server.ts 均不可读');
    }

    const back = measureTests('.');
    if (back) {
      measured.push(`后端测试 ${back.tests} 例/${back.files} 文件（vitest list 实测）`);
      if (back.tests !== Number(testsBack)) {
        issues.push(
          `README 状态行后端测试数 ${testsBack} ≠ vitest list 实测 ${back.tests} 例（${back.files} 文件；` +
            '套件增删后刷新 README 状态行）'
        );
      }
    } else {
      notes.push('后端测试计数未校验：根目录 vitest 不可用（CI 冷启动步骤属预期，跳过）');
    }

    const front = measureTests('web-ui');
    if (front) {
      measured.push(`前端测试 ${front.tests} 例/${front.files} 文件（web-ui vitest list 实测）`);
      if (front.tests !== Number(testsFront)) {
        issues.push(
          `README 状态行前端测试数 ${testsFront} ≠ web-ui vitest list 实测 ${front.tests} 例（${front.files} 文件；` +
            '套件增删后刷新 README 状态行）'
        );
      }
    } else {
      notes.push('前端测试计数未校验：web-ui 的 vitest 不可用（依赖未安装时属预期，跳过）');
    }
  }

  const anchorOk =
    manualMatches.length === 1 && manualMatches[0][1] === pkgVersion && statusMatches.length === 1;
  const summary =
    `散文锚点一致：manual 版本锚点 ${pkgVersion} == package.json` +
    (measured.length > 0 ? `；README 状态行 == 实测（${measured.join('，')}）` : '');
  return { issues, notes, summary, anchorOk };
}

function printDiffs(diffs) {
  console.error('\n差异清单（产物 × 状态）：');
  for (const d of diffs.sort((a, b) => a.displayTarget.localeCompare(b.displayTarget))) {
    console.error(`- [${d.status}] ${d.displayTarget}`);
    if (d.status.startsWith('漂移')) {
      console.error(`    正本：integrations/src/ 下对应正本；产物禁止手改。`);
    }
  }
}

/** 默认模式：把与正本渲染结果不一致（含缺失）的产物重新生成。 */
function generate(plan) {
  let written = 0;
  for (const item of plan) {
    const expected = item.channel
      ? render(item.srcAbs, item.channel)
      : fs.readFileSync(item.srcAbs, 'utf8');
    if (
      !fs.existsSync(item.targetAbs) ||
      (!statIsDir(item.targetAbs) && fs.readFileSync(item.targetAbs, 'utf8') !== expected)
    ) {
      fs.mkdirSync(path.dirname(item.targetAbs), { recursive: true });
      fs.writeFileSync(item.targetAbs, expected);
      written += 1;
      console.log(`已生成: ${item.displayTarget}`);
    }
  }
  return written;
}

function main() {
  const checkOnly = process.argv.slice(2).includes('--check');
  const plan = [...buildCopyPlan(), ...buildTemplatePlan()];
  const masterCount = new Set(plan.map((p) => p.srcAbs)).size;

  if (!checkOnly) {
    const written = generate(plan);
    console.log(
      `生成完成：${written} 个产物被写入${written === 0 ? '（本就一致，未改动）' : ''}。`
    );
  }

  const { diffs, okCount } = audit(plan);

  // --check 是 prepublishOnly 第一道门禁，同场断言版本面一致性（IL-016）与散文锚点（0.9.4 C7b）
  const versionFace = checkOnly ? checkVersions() : null;
  const proseAnchors = checkOnly ? checkProseAnchors() : null;

  const versionBad = versionFace && versionFace.mismatches.length > 0;
  const anchorsBad = proseAnchors !== null && proseAnchors.issues.length > 0;

  if (diffs.length > 0 || versionBad || anchorsBad) {
    if (versionBad) {
      printVersionMismatches(versionFace);
    }
    if (anchorsBad) {
      console.error('\n散文锚点断言失败（0.9.4 C7b）：散文名义值与实测不一致：');
      for (const issue of proseAnchors.issues) {
        console.error(`- ${issue}`);
      }
      console.error(
        `\n修复方式：按实测值刷新 integrations/src/manual.md 版本锚点行与 README「项目状态」状态行` +
          `（manual 属正本，改后运行 \`node scripts/sync-integrations.mjs\` 刷新产物）。`
      );
    }
    if (diffs.length > 0) {
      printDiffs(diffs);
      console.error(
        `\n校验失败：${diffs.length}/${plan.length} 个产物与 integrations/src/ 正本渲染结果不一致（--check 不做任何写入）。` +
          `\n修复方式：运行 \`node scripts/sync-integrations.mjs\`（默认模式重新生成）。` +
          `\n若要改插件包/.pi 内的 skill、agent、命令、手册或脚本内容，请改 integrations/src/ 唯一正本后再生成——产物禁止手改。`
      );
    }
    process.exit(1);
  }

  if (versionFace) {
    console.log(
      `版本面一致：package.json ${versionFace.pkgVersion} 与在位 ${versionFace.checked}/${VERSION_MANIFESTS.length} 份 manifest 全部一致`
    );
  }

  if (proseAnchors) {
    for (const note of proseAnchors.notes) {
      console.log(`提示：${note}`);
    }
    if (proseAnchors.anchorOk) {
      console.log(proseAnchors.summary);
    }
  }

  console.log(
    `${masterCount} 个正本 × ${okCount} 个产物 全部一致（gen 生成完整性检查通过）`
  );
}

main();
