#!/usr/bin/env node
/**
 * session-brief — 会话开始注入一行图状态 hook（SessionStart，可选资产，默认关闭）。
 *
 * 定位（adr_0009）：这是「用户选择的额外护栏/便利」，不是 super-plumber 的新机制。
 * 本脚本只有被用户显式登记进 harness（Claude Code / ZCode）的 hooks 配置才会生效；
 * 仓库与插件包不在任何注册面引用它，SP 核心层（src/）零 hook 事件总线代码。
 *
 * 工作方式：实现 harness 的 SessionStart hook 协议——解析本地拓扑图并往 stdout 写
 * 恰好一行 `graph status --oneline`（F18 单行状态：图名 + 进度 + ready/running/
 * failed/blocked 前沿计数），harness 会把 stdout 作为上下文注入新会话。
 *
 * CLI 解析顺序（命中即停）：
 *   1. 环境变量 SP_GRAPH_BIN —— 显式指定 CLI 脚本路径，以 `node <SP_GRAPH_BIN> status --oneline` 调用；
 *   2. <cwd>/node_modules/@lukawi/super-plumber/dist/cli/index.js —— 项目本地依赖；
 *   3. <cwd> 本身是 super-plumber 仓库检出（package.json name 匹配且 dist 已构建）——
 *      开发/自举场景（在 SP 仓库里跑图的会话）直接用仓库内 CLI；
 *   4. PATH 上的 `graph` 命令（npm i -g @lukawi/super-plumber；Windows 走 shell 解析 .cmd 垫片）；
 *   5. `npm root -g` 回推全局包内的 dist/cli/index.js（同 sp.mjs 单入口的回退约定）。
 *
 * 静默契约：图未初始化、CLI 缺失、超时（4s）、任何非零退出——一律不出声、exit 0。
 * hook 是会话的第一段代码，绝不拖慢或弄脏会话启动。
 *
 * 启用方式（路径换成你的检出路径）：
 *   Claude Code ~/.claude/settings.json / ZCode 对应 settings 的 hooks 节：
 *     "hooks": { "SessionStart": [
 *       { "hooks": [ { "type": "command", "command": "node <路径>/session-brief.mjs" } ] } ] }
 *   详见同目录 README.md。
 *
 * 实现：Node >=20 ESM，零依赖，跨平台。
 */

import fs, { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const ARGS = ['status', '--oneline'];
const TIMEOUT_MS = 4000;

/** 统一出口：把单行状态写到 stdout（多行只留首行），失败零输出。 */
function emit(text) {
  const line = String(text).split('\n').map((l) => l.trim()).filter(Boolean)[0];
  if (line) console.log(line);
  process.exit(0);
}

/** 统一失败出口：静默放行。 */
function silent() {
  process.exit(0);
}

/** 以 node 直接执行一个 CLI 脚本路径，取 stdout 首行。 */
function runNodeScript(scriptPath) {
  const res = spawnSync(process.execPath, [scriptPath, ...ARGS], {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  if (res.status === 0 && typeof res.stdout === 'string' && res.stdout.trim() !== '') {
    emit(res.stdout);
  }
  silent();
}

// 1) 显式指定：SP_GRAPH_BIN
if (process.env.SP_GRAPH_BIN) {
  if (existsSync(process.env.SP_GRAPH_BIN)) runNodeScript(process.env.SP_GRAPH_BIN);
  silent();
}

// 2) 项目本地依赖
const localCli = path.join(
  process.cwd(),
  'node_modules',
  '@lukawi',
  'super-plumber',
  'dist',
  'cli',
  'index.js',
);
if (existsSync(localCli)) runNodeScript(localCli);

// 3) cwd 本身是 super-plumber 仓库检出（开发/自举场景）
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const repoCli = path.join(process.cwd(), 'dist', 'cli', 'index.js');
  if (pkg?.name === '@lukawi/super-plumber' && existsSync(repoCli)) runNodeScript(repoCli);
} catch {
  // 无 package.json 或解析失败：继续后续解析
}

// 4) PATH 上的 graph 命令（Windows 需 shell 才能解析 .cmd 垫片）
{
  const res = spawnSync('graph', ARGS, {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    shell: process.platform === 'win32',
  });
  if (res.status === 0 && typeof res.stdout === 'string' && res.stdout.trim() !== '') {
    emit(res.stdout);
  }
}

// 5) npm root -g 回推全局包（仅在前面全部未命中时才走到这里）
try {
  const globalRoot = execFileSync('npm', ['root', '-g'], {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  }).trim();
  if (globalRoot) {
    const globalCli = path.join(
      globalRoot,
      '@lukawi',
      'super-plumber',
      'dist',
      'cli',
      'index.js',
    );
    if (existsSync(globalCli)) runNodeScript(globalCli);
  }
} catch {
  // npm 不可用：静默
}

silent();
