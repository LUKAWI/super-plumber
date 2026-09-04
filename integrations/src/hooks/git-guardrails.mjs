#!/usr/bin/env node
/**
 * git-guardrails — 危险 git 命令拦截 hook（PreToolUse，可选资产，默认关闭）。
 *
 * 定位（adr_0009）：这是「用户选择的额外护栏」，不是 super-plumber 的新机制。
 * 本脚本只有被用户显式登记进 harness（Claude Code / ZCode）的 hooks 配置才会生效；
 * 仓库与插件包不在任何注册面引用它，SP 核心层（src/）零 hook 事件总线代码。
 *
 * 工作方式：实现 harness 的 PreToolUse hook 协议——stdin 读一条 JSON
 * （{ tool_name, tool_input: { command } }），对 Bash 工具的命令串做启发式正则匹配，
 * 命中危险清单则 stderr 给出解释并 exit 2（harness 语义：拦截并把 stderr 回喂模型）；
 * 其余一律 exit 0 放行。退出码设计为 fail-open：脚本自身故障（输入非 JSON、
 * stdin 异常等）一律放行不阻塞工作流——护栏防误操作，不做沙箱、不防绕过。
 *
 * 危险清单（对纯文件存储仓库价值最高——误操作直接丢工作区/丢历史）：
 *   push-force           git push 带强制面（--force / 短参含 f，如 -f、-uf；
 *                        --force-with-lease 有远端校验，放行）
 *   push-delete-remote   git push 删远端分支（--delete / 短参含 d，如 -d、-ud）
 *   reset-hard           git reset --hard（丢弃全部未提交改动）
 *   clean-force          git clean 带强制面（-f / -fd / -xdf / --force，删未跟踪文件）
 *   checkout-discard     git checkout -- <paths> / git checkout .（丢弃工作区改动）
 *   restore-discard      git restore（丢弃工作区改动；仅纯 --staged 的 unstage 放行）
 *   history-rewrite      git filter-branch / filter-repo（重写全部历史）
 *   rebase               git rebase（重写提交；--abort / --quit 放行）
 *   branch-force-delete  git branch -D / --force（删未合并分支）
 *   reflog-drop          git reflog expire / delete（抹掉恢复路径）
 *   gc-prune             git gc --prune=now / --aggressive（立刻不可恢复地清对象）
 *   stash-drop           git stash drop / clear（丢弃暂存）
 *
 * 已知边界（有意为之，README 有完整说明）：只看 Bash 工具、只看 git 命令；
 * 启发式正则不解析 shell 语法，引号内的字面量（如 echo "git push -f"）可能误报。
 *
 * 环境变量：
 *   SP_GIT_GUARDRAILS_OFF=1   整体停用（脚本批量跑 git 时用），立即 exit 0
 *   SP_GIT_GUARD_EXTRA=<regex> 追加自定义拦截正则（JavaScript RegExp 源码，大小写不敏感），
 *                              对命令逐段匹配；写错只忽略不报错（fail-open）
 *
 * 启用方式（路径换成你的检出路径）：
 *   Claude Code ~/.claude/settings.json / ZCode 对应 settings 的 hooks 节：
 *     "hooks": { "PreToolUse": [ { "matcher": "Bash",
 *       "hooks": [ { "type": "command", "command": "node <路径>/git-guardrails.mjs" } ] } ] }
 *   详见同目录 README.md。
 *
 * 实现：Node >=20 ESM，零依赖，跨平台。
 */

import fs from 'node:fs';

/** 子命令定位：`git` 后 0-4 个 token 内出现该词（容忍 git -C <path> push 这类前置旗标，
 *  也把 `git commit -m "rebase fix"` 这类消息文本挡在匹配窗外）。 */
function hasSub(seg, sub) {
  return new RegExp(`\\bgit\\s+(?:\\S+\\s+){0,4}${sub}\\b`).test(seg);
}

/** 短旗标 token：形如 -f、-fd、-uf（组合短参逐字母覆盖，如 clean -fd）；不含 -- 长参。 */
function flagShort(seg, letters) {
  return new RegExp(`(^|\\s)-[a-z]*[${letters}]`).test(seg);
}

/** 单条拦截规则：id + 人话解释 + 替代做法 + 对命令段的判定函数。 */
const RULES = [
  {
    id: 'push-force',
    why: '强制推送会用本地历史覆盖远端，协作者/其他机器的提交会被抹掉',
    instead: '用 --force-with-lease（先校验远端没有新提交）',
    match: (seg) =>
      hasSub(seg, 'push') &&
      (/--force(?!-with)/.test(seg) || flagShort(seg, 'f')),
  },
  {
    id: 'push-delete-remote',
    why: '删除远端分支会连带丢掉只存在于该分支的提交',
    instead: '确认分支已合并，或先 git tag 打归档点再删',
    match: (seg) =>
      hasSub(seg, 'push') && (/--delete\b/.test(seg) || flagShort(seg, 'd')),
  },
  {
    id: 'reset-hard',
    why: 'git reset --hard 不可逆地丢弃全部未提交改动',
    instead: '先 git stash，或只恢复具体文件',
    match: (seg) => hasSub(seg, 'reset') && /--hard\b/.test(seg),
  },
  {
    id: 'clean-force',
    why: 'git clean -f/-fd/-xdf 会删除全部未跟踪文件（含未提交的新代码）',
    instead: '先 git clean -n 预览干跑清单，确认后逐目录执行',
    match: (seg) =>
      hasSub(seg, 'clean') && (flagShort(seg, 'f') || /--force\b/.test(seg)),
  },
  {
    id: 'checkout-discard',
    why: 'git checkout -- <paths> / git checkout . 用旧版本覆盖工作区改动，不可恢复',
    instead: '先 git stash 具体路径，或 git diff 确认后再丢',
    match: (seg) =>
      hasSub(seg, 'checkout') &&
      (/(^|\s)--(\s|$)/.test(seg) || /\bcheckout\s+\.$/.test(seg.trim())),
  },
  {
    id: 'restore-discard',
    why: 'git restore 默认丢弃工作区改动且不可恢复（仅纯 --staged 的 unstage 放行）',
    instead: 'unstage 用 git restore --staged <file>；丢弃改动前先 git stash',
    match: (seg) => {
      if (!hasSub(seg, 'restore')) return false;
      if (!/--staged\b/.test(seg)) return true; // 纯工作面 restore，拦
      return /--worktree\b/.test(seg) || flagShort(seg, 'Ww'); // staged+worktree 同丢，拦
    },
  },
  {
    id: 'history-rewrite',
    why: 'filter-branch / filter-repo 重写全部历史，所有克隆都会失效',
    instead: '用 git revert 生成反向提交',
    match: (seg) =>
      /\bgit\s+/.test(seg) && /filter-(branch|repo)\b/.test(seg),
  },
  {
    id: 'rebase',
    why: 'rebase 重写已有提交，推送后会把协作者的历史搅乱',
    instead: '合并用 git merge；中止在途 rebase 用 git rebase --abort',
    match: (seg) => hasSub(seg, 'rebase') && !/--(abort|quit)\b/.test(seg),
  },
  {
    id: 'branch-force-delete',
    why: 'git branch -D 跳过已合并检查，未合并提交直接丢失',
    instead: '先 git branch -d（小写，有未合并会拒绝），确认真要丢再 -D',
    match: (seg) =>
      hasSub(seg, 'branch') &&
      (/(^|\s)-[a-z]*D/.test(seg) || /--force\b/.test(seg)),
  },
  {
    id: 'reflog-drop',
    why: 'reflog expire/delete 抹掉「误操作的后悔药」，reset/clean 丢的东西再也找不回',
    instead: '保持 reflog 完整；确要收缩历史先打 git tag 备份点',
    match: (seg) =>
      hasSub(seg, 'reflog') && /\b(expire|delete)\b/.test(seg),
  },
  {
    id: 'gc-prune',
    why: 'git gc --prune=now / --aggressive 立即销毁不可达对象，不可恢复',
    instead: '保留默认宽限期（不加 --prune=now）',
    match: (seg) =>
      hasSub(seg, 'gc') && /--prune=now\b|--aggressive\b/.test(seg),
  },
  {
    id: 'stash-drop',
    why: 'git stash drop / clear 丢弃暂存改动（drop 单条、clear 全部）',
    instead: 'pop 恢复到工作区，或先 git stash branch 落成提交',
    match: (seg) =>
      hasSub(seg, 'stash') && /(^|\s)(drop|clear)\b/.test(seg),
  },
];

/** 把复合命令拆成段：&&、||、;、|、换行。子 shell 括号随后剥掉。 */
function segments(command) {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((seg) => seg.trim().replace(/^[({\[]+|[)}\]]+$/g, '').trim())
    .filter(Boolean);
}

function main() {
  if (process.env.SP_GIT_GUARDRAILS_OFF === '1') return;

  let raw;
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return; // stdin 不可读：fail-open
  }
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return; // 非 hook 协议输入：fail-open
  }
  const tool = String(event?.tool_name ?? '');
  const command = String(event?.tool_input?.command ?? '');
  if (!/^bash$/i.test(tool) || command === '') return;

  const extraRaw = process.env.SP_GIT_GUARD_EXTRA ?? '';
  let extraRe = null;
  if (extraRaw !== '') {
    try {
      extraRe = new RegExp(extraRaw, 'i');
    } catch {
      extraRe = null; // 正则写错：忽略，不阻塞
    }
  }

  for (const seg of segments(command)) {
    for (const rule of RULES) {
      if (!rule.match(seg)) continue;
      process.stderr.write(
        [
          `[git-guardrails] 已拦截（${rule.id}）：${seg}`,
          `原因：${rule.why}`,
          `替代：${rule.instead}`,
          `（本 hook 是用户启用的可选护栏；绕过方式见 integrations/src/hooks/README.md）`,
        ].join('\n') + '\n',
      );
      process.exit(2); // harness 约定：2 = 拦截并把 stderr 回喂模型
    }
    if (extraRe && extraRe.test(seg)) {
      process.stderr.write(
        `[git-guardrails] 已拦截（自定义规则 SP_GIT_GUARD_EXTRA）：${seg}\n`,
      );
      process.exit(2);
    }
  }
}

main();
