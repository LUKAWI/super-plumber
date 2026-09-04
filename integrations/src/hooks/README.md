# hooks 可选资产（v0.9.4 S04，默认关闭）

Super-plumber 的 hook 适配层：两个**可选** harness（Claude Code / ZCode）hook 资产，落在本正本目录 `integrations/src/hooks/`。

**定位（adr_0009）**：这是「**用户选择的额外护栏，不是 SP 的新机制**」。核心层（`src/`）没有也不加 hook 事件总线；SP 已有强制力的地方（状态机门禁、ready 前置校验、max_attempts 拦截）不需要 hook 重复，nudge 类提醒已内嵌在工具响应里。hooks 只补一个 SP 覆盖不到的高价值面：**纯文件存储仓库的 git 误操作防护**。

**默认关闭，且关闭方式是结构性的**：

- 本目录**不在任何注册面登记**——`integrations/plugin/.claude-plugin/plugin.json` 无 hooks 注册（hooks 不是 skill，不进插件清单）、`.pi/settings.json` 不引用、仓库无 `.claude/settings.json` 指向这里；
- gen 管线（`scripts/sync-integrations.mjs`）的 SOURCES / COPIES / TEMPLATED 三张表**均未登记本目录**，因此不向 `.pi/`、`integrations/plugin/`、`integrations/shared/` 任何渠道产物面投影。hooks 仅作 integrations 内可选资产分发——**分发给的就是本目录本身**，用户按需引用脚本绝对路径或自行拷贝。这是有意决策：进插件产物面但不注册 hooks.json 只会制造「看似激活」的歧义；默认关闭要求「不登记 = 字面上不存在于任何 harness 视野」。
- 因此不启用时，全量行为与没有这两个文件完全一致（不装 hooks 就什么都不发生）。

## 资产一览

| 资产 | hook 类型 | 作用 |
|------|-----------|------|
| `git-guardrails.mjs` | PreToolUse（matcher `Bash`） | 危险 git 命令拦截：命中清单时 exit 2 + stderr 解释，harness 把原因回喂模型 |
| `session-brief.mjs` | SessionStart | 会话开始往 stdout 写一行 `graph status --oneline`（F18 单行状态），harness 注入为会话上下文；图未初始化 / CLI 缺失 / 超时一律静默 exit 0 |

## 启用（显式登记才生效）

在 Claude Code 的 `~/.claude/settings.json`（或项目 `.claude/settings.json`）、ZCode 对应 settings 的 `hooks` 节登记，路径换成你的检出路径：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node <检出路径>/integrations/src/hooks/git-guardrails.mjs" }]
      }
    ],
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "node <检出路径>/integrations/src/hooks/session-brief.mjs" }]
      }
    ]
  }
}
```

两个资产相互独立，按需只登记其一。停用 = 从 settings 里删掉对应条目（或对 git-guardrails 临时设环境变量 `SP_GIT_GUARDRAILS_OFF=1`）。

## git-guardrails 拦截清单

对命令按 `&&` / `||` / `;` / `|` / 换行拆段，逐段启发式匹配（子命令须出现在 `git` 后 0-4 个 token 内，前置旗标如 `git -C <path> push` 可识别）：

| 规则 | 拦截面 | 替代做法 |
|------|--------|----------|
| `push-force` | `git push --force` / 短参含 f（`-f`、`-uf`） | `--force-with-lease`（有远端校验，**放行**） |
| `push-delete-remote` | `git push --delete` / 短参含 d | 先合并或打归档 tag 再删 |
| `reset-hard` | `git reset --hard` | 先 `git stash` |
| `clean-force` | `git clean -f/-fd/-xdf/--force` | 先 `git clean -n` 干跑预览 |
| `checkout-discard` | `git checkout -- <paths>` / `git checkout .` | 先 `git stash` 具体路径 |
| `restore-discard` | `git restore`（工作面丢弃；**纯 `--staged` 的 unstage 放行**） | unstage 用 `--staged`，丢弃前 stash |
| `history-rewrite` | `git filter-branch` / `git filter-repo` | `git revert` |
| `rebase` | `git rebase`（`--abort` / `--quit` 放行） | 合并用 `git merge` |
| `branch-force-delete` | `git branch -D` / `--force` | 先 `-d`（小写，有未合并会拒绝） |
| `reflog-drop` | `git reflog expire` / `delete` | 保持 reflog 完整 |
| `gc-prune` | `git gc --prune=now` / `--aggressive` | 保留默认宽限期 |
| `stash-drop` | `git stash drop` / `clear` | `pop` 或 `git stash branch` |

设计取舍：`--force-with-lease`、`git restore --staged`、`git rebase --abort/quit` 这些**带自我校验或中止语义**的形态放行；`git commit --amend` 不拦（高频正常操作，误报代价大于收益）。

**扩展与绕过**：

- `SP_GIT_GUARD_EXTRA=<regex>`：追加自定义拦截正则（JavaScript RegExp 源码，大小写不敏感，逐段匹配），如 `SP_GIT_GUARD_EXTRA='git\s+remote\s+(remove|set-url)'`；
- `SP_GIT_GUARDRAILS_OFF=1`：整体临时停用（脚本批量操作 git 时）；
- 终极绕过：从 settings 删掉登记。**它是启发式正则，防误操作、不防绕过、不是沙箱**——不解析 shell 语法（`$(...)`、引号字面量如 `echo "git push -f"` 可能误报/漏报），只看 Bash 工具，只看 git 命令。
- 退出码 fail-open：脚本自身故障（非协议输入、stdin 异常）一律 exit 0 放行——可选护栏不允许把用户工作流卡死。

## session-brief 数据源与 CLI 解析

一行状态来自 `graph status --oneline`（F18），形如：

```
roadmap-to-1-0-0 65/85 passed (76%)｜ready 0｜running 3｜failed 0｜blocked 0
```

CLI 解析顺序（命中即停）：`SP_GRAPH_BIN` 环境变量（显式指定 CLI 脚本路径）→ `<cwd>/node_modules/@lukawi/super-plumber/dist/cli/index.js`（项目本地依赖）→ cwd 本身是 super-plumber 仓库检出（package.json name 匹配且 dist 已构建，覆盖开发/自举场景）→ PATH 上的 `graph`（全局安装）→ `npm root -g` 回推全局包（与 `sp-scripts/sp-core.mjs` 同一回退约定）。超时 4 秒；未初始化目录 / CLI 缺失 / 超时一律零输出 exit 0。

## 与 gen 管线的关系（维护者须知）

`scripts/sync-integrations.mjs` 未登记本目录：正本即分发件，**改这里不需要跑 gen、也不会产生任何产物差异**（`--check` 对本目录零感知）。若未来决定把 hooks 纳入某渠道产物面（如随插件包分发 `hooks/` 目录），需在 gen 的 SOURCES 表登记并在本文件与 README 取舍节同步改写「默认关闭」论证。
