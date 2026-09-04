# v0.9.5 Codex 插件适配取证

> 取证日期：2026-09-04。发布候选版本为 0.9.5；本文覆盖发布前的实现、回归和独立交叉复核证据。实际 npm 发布与 tag 另由 release 节点记录。

## 兼容方案

- 插件根为 `integrations/plugin/`，新增 `.codex-plugin/plugin.json`；skills 使用 `./skills/`，`mcpServers.graph-mcp` 以内联 `command` + `args` 表达，避免把 Claude 的 `.mcp.json` 直接交给 Codex 解析。
- Claude 插件清单采用当前 Claude CLI 可验证的最小字段集：移除 CLI 拒绝的旧式顶层 `skills` 和未知的 `description_i18n`，由插件内 `skills/` 目录自动发现；`.mcp.json` 不变。Claude/ZCode/Codex 插件渠道继续共用 skills、scripts、agents 文件和插件根 `manual.md`，pi 产物仍由同一正本生成。
- Codex 插件没有 Claude 的 slash-command / Markdown-subagent 注册位，因此默认走 skill 内建 solo 分支；`.codex/agents/sp-designer.toml` 与 `.codex/agents/super-mario.toml` 是宿主项目可选增强，不写入插件清单。
- 本项目 hooks harness 在 Claude/ZCode 侧也未注册、默认关闭；Codex 不继承 Claude hook/settings 配置，启用时必须按宿主格式单独接线。
- 仓库级市场清单为 `.agents/plugins/marketplace.json`，entry 使用 `source: local` 指向 `./integrations/plugin`，安装策略为 `AVAILABLE` / `ON_INSTALL`。

## 机器验证

| 检查 | 命令 | 结果 |
|---|---|---|
| Codex 插件 schema | `python C:\Users\liujiayu\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py integrations\plugin` | `Plugin validation passed` |
| Claude 插件 schema | `claude plugin validate integrations\\plugin` | `Validation passed` |
| 生成完整性与版本面 | `node scripts/sync-integrations.mjs --check` | 4/4 manifest 版本一致；24 个正本 × 48 个产物一致；README/manual 锚点一致 |
| 后端回归 | `npm test -- --reporter=dot` | 95 files / 822 tests passed（338.90s） |
| 前端回归 | `npm --prefix web-ui test` | 12 files / 109 tests passed |
| 构建与文档视图 | `npm run build`；`npm --prefix web-ui run build`；`node dist/cli/index.js export --docs --check` | 均通过；发现的 `DECISIONS.md` 漂移已由图真相源重新导出 |
| npm 分发面 | `npm pack --dry-run --json` | 包含 `.agents/plugins/marketplace.json` 与 `integrations/plugin/.codex-plugin/plugin.json` |

## Codex CLI 安装冒烟

在仓库根执行：

```text
codex plugin marketplace add . --json
→ {"marketplaceName":"lukawi-super-plumber","installedRoot":"<repo>","alreadyAdded":false}

codex plugin list --marketplace lukawi-super-plumber --available --json
→ super-plumber@lukawi-super-plumber，source.path=<repo>/integrations/plugin，version=0.9.4

codex plugin add super-plumber --marketplace lukawi-super-plumber --json
→ 安装成功；version=0.9.5；缓存目录内含 .codex-plugin/plugin.json、manual.md 和 6 个 skills

codex mcp get graph-mcp --json
→ enabled=true；stdio command=npx；args=["-y", "@lukawi/super-plumber", "graph-mcp"]
```

这证明仓库级 marketplace 可被当前 `codex-cli 0.153.1` 发现并安装，且插件内联的 `graph-mcp` 已进入 Codex MCP 配置。安装后应开启新会话以加载缓存组件。

## MCP 连通性

1. 用插件声明的 Windows-safe 命令 `npx -y @lukawi/super-plumber graph-mcp` 做 stdio `initialize` / `tools/list` 握手，服务端正常返回协议版本 `2024-11-05` 和 26 个 `graph_*` 工具。
2. 用 MCP SDK 直接启动上述插件命令并执行 `tools/list` + `graph_list_graphs`，返回 `toolCount=26`，且 `roadmap-to-1-0-0` 查询成功（111 节点 / 181 边 / 73 passed）。
3. 当前仓库构建物的 `VERSION` 为 `0.9.5`；此前对 `node dist/mcp/server.js` 的同一握手返回 26 个工具。
4. Codex 当前连接的 `mcp__super_plumber__graph_list_graphs`、`mcp__super_plumber__graph_get_next_actions` 与 `mcp__super_plumber__graph_validate` 均成功返回结构化 JSON；前者列出 6 张图，后者返回 `v095-manifest` 等调度条目，validate 返回 `ok=true` 且 `errors=[]`。

在本次开发取证时，公共 npm registry 的 unpinned `npx` 命令仍返回已发布版本 0.9.3；这是因为 0.9.5 尚未执行发布动作。发布节点完成 npm 发布后，同一命令会解析到最新发布包；不要在发布前把 registry 版本号视为仓库版本号。

## 回归边界

`.claude-plugin/marketplace.json` 与 `integrations/plugin/.mcp.json` 未被改写；`.claude-plugin/plugin.json` 仅做上述 schema 兼容清理并通过当前 Claude CLI 校验。同步检查、后端/前端全量回归均通过；pi 的同源脚本读面可正常取得 `v095-verify` 节点。当前机器没有 ZCode 可执行宿主，因此不把 ZCode UI 冒烟伪装成已执行；其目录级共享产物已进入同步和打包检查。

## 独立交叉复核交接

- reviewer 只提交规格轴与惯例轴证据，未写 checkpoint、execution report、verification verdict 或节点状态。
- `plumber-review` 现在强制所有调用均为叶子复核，无法从能力或 skill 文本推断自身在代理树中的层级；只有直接承接用户请求的外层协调者可直接派独立 reviewer。
- 本节点的 checkpoint、报告、verdict 和状态必须由与执行者、reviewer 不同的 Super Mario / 指定裁决者独立读取本文件、节点 DoD 和 artifact 后更新，且顺序为 verdict 在前、状态在后。
