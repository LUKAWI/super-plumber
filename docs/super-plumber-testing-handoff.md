# Handoff：Super Plumber 全面测试与改进

> 生成时间：2026-08-06 | 会话背景：验证 + 修复 + skill 建设 + 改名完成后，进入**全面测试与改进**阶段
> 本文件不含 API 密钥、密码或个人身份信息（环境配置中的密钥请在测试时自行跳过，勿外泄）。
> 用法：新会话**先读本文件 → 按第 5 节测试清单逐项执行 → 发现问题按第 6 节记入 Bug 清单 → 修复后更新本文件状态**。

---

## 1. 项目概况（详细内容引用已有文档，不重复）

| 项 | 值 |
|----|----|
| 项目目录 | `D:/LUKAWI/AI_project/projects/topological-tool/`（目录名未改，仅品牌名改了） |
| 品牌名 / npm 包名 | **super-plumber**（CLI 命令 `graph` / `graph-mcp` 不变） |
| Git | master 分支，可回滚点 `mvp-checkpoint` tag；最新提交 `04e18e4`（改名） |
| 测试基线 | **79/79 通过**（7 个测试文件），`npx tsc --noEmit` 零错误，`vite build` 无警告 |

**必读文档（引用，不重复内容）：**

- 需求说明书：`D:/LUKAWI/AI_project/projects/topological tool/拓扑图管理工具-轮子需求.md`
- 领域术语：`CONTEXT.md`（已含品牌名说明）
- 架构决策：`docs/adr/0001`（拓扑排序忽略运行时边）、`docs/adr/0002`（纯文件存储）
- 上一阶段验证清单：`docs/verification-handoff.md`（旧名时代产物，本文件是它的升级版）
- 实施计划：`docs/superpowers/plans/2026-07-28-topological-wheel-mvp.md`
- README：`README.md`（中文）/ `README.en.md`（英文）

## 2. 会话环境速查（Windows，重要！）

```bash
# 工具（全局 npm link 已装好，新会话可直接用）
graph --version          # CLI（0.1.0）
graph-mcp                # MCP server（stdio）
# 或绕过全局直接用：
node D:/LUKAWI/AI_project/projects/topological-tool/dist/cli/index.js
node D:/LUKAWI/AI_project/projects/topological-tool/dist/mcp/server.js
```

**环境坑（实测踩过，务必遵守）：**

1. **路径盘符**：bash 的 `/tmp` = `C:\Users\liujiayu\AppData\Local\Temp`；node 进程的 `/tmp` 按**当前盘符**解析（cwd 在 C 盘 → `C:\tmp`，在 D 盘 → `D:\tmp`）。测试目录统一用 `C:/Users/liujiayu/AppData/Local/Temp/<name>` 显式路径，别用 `/tmp`。
2. **Windows cmd 引号**：`execSync` 走 cmd.exe，单引号不识别、双引号内 `\"` 会被剥除。CLI 测试传 JSON 参数用 `spawnSync(args 数组)` 绕开（见 `tests/cli/commands.test.ts` 的 add-checkpoint 测试写法）。
3. **biome 自动格式化**：用 edit 工具改 .ts 文件后，biome auto-fix 会把缩进改成 **tab**（项目规范是 2 空格），导致 diff 爆炸。修复：`perl -pi -e 's/^\t+/"  " x length($&)/e' <file>`。
4. **测试环境隔离**：所有功能测试在临时目录 `graph init` 起全新环境，**严禁污染示例 `.graph/`**（20 节点 36 边示例数据是验收依据）。
5. 全局安装是 `npm link`（符号链接指向项目 dist），**改 src 后必须 `npx tsc` 重新构建**，dist 才会更新（MCP server 名实测就因此滞后过一次）。

## 3. 已知基线（已通过，新会话不用重测，除非怀疑回归）

| 事项 | 证据 |
|------|------|
| 状态机 7 态 14 转换 + 非法转换报错 | `tests/core/state-machine.test.ts`（25 用例，含全部合法转换） |
| 拓扑排序（Kahn 迭代）/ 环检测（迭代 DFS，无递归栈溢出） | `tests/core/graph.test.ts`（11 用例，含 6000 深链回归） |
| 节点/边 CRUD + claim + execution_report + 软删除过滤 | `tests/core/node.test.ts`（13）、`edge.test.ts`（5） |
| graph.yaml 引用列表 CRUD 同步 | `tests/core/parser.test.ts`（7） |
| CLI 11 命令主流程 + 8 个错误路径 | `tests/cli/commands.test.ts`（12） |
| MCP 协议合规（缺参/非法枚举 → -32602 isError） | `tests/mcp/server.test.ts`（6） |
| 10000 节点（含 10000 深链）validate 4.7s 通过 | 实测 |
| WebSocket 增量推送（node:updated / graph:update / removed） | 实测 |
| headless Chrome 渲染（SVG 节点/边/图例/光点层） | 实测 |

**已修复的 bug（git 历史可见，勿重复报告）：** 软删除不生效、detectCycles 栈溢出、create-node 重复 id 静默覆盖、add-edge 幽灵边/非法类型、validate 矛盾输出、status 未初始化崩溃、`--add-dod`/`--add-checkpoint` 多值丢失、delete 假成功、graph.yaml 失同步、init 目录骨架缺失。

## 4. 已知问题与改进候选（新会话优先验证/处理）

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **entry/exit 无 CLI 编辑命令** | 中 | graph.yaml 的 entry/exit 只能手改 YAML，agent 建图时无法用 CLI 设置入口/出口描述（validate 会报"描述为空"警告） |
| 2 | **MCP 缺 graph_diff / graph_snapshot** | 低 | 需求 4.5 列出但 MVP 未实现；版本控制（snapshot/diff/branch/merge/rollback）整体未做，只有 Git 提交 |
| 3 | CLI update-status 无 claim_by 参数 | 低 | claim 语义只在 MCP 和 `plumber-flow/scripts/graph-claim.mjs`，CLI 对齐缺口 |
| 4 | plumber-flow 脚本（graph-get-node.sh 等）用 `grep -oP` | 低 | git-bash 可用；macOS/BSD grep 不支持 -oP，跨平台声明（需求 7）存疑 |
| 5 | `graph-traverse.sh` DFS 递归 | 低 | 脚本层递归，超大图可能栈溢出（核心层已迭代化，脚本未同步） |
| 6 | MCP 测试覆盖薄 | 中 | 只测 6 场景；缺 create_node 正常、search 过滤、traverse 正常、claim 完整链、delete 正常 的端到端断言 |
| 7 | CLI 测试缺 serve/rebuild/validate 错误路径 | 中 | 12 个用例未覆盖 serve 端口占用、rebuild 缺 graph.yaml、validate 幽灵边等 |
| 8 | Web UI 60fps 流畅度未量化 | 低 | 只有 headless DOM 验证，无帧率/大图交互性能测试 |
| 9 | chokidar 高频变更事件合并 | 低 | 两次连续 CLI 写入曾只收到一次 WS 事件，未专项验证 |
| 10 | 文档残留检查 | 中 | 改名后：`docs/verification-handoff.md` 内容仍是旧名时代；测试 README 与实现是否还有 `topological-tool` 残留（源码/文档已清，历史文档保留属正常） |
| 11 | npm publish 未做 | 低 | 全局只有 `npm link`；真发布需 `npm publish`（注意包名 super-plumber 已确认 npm 可用） |
| 12 | tests/mcp 用 `command: "node"` | 低 | Windows 依赖 PATH 里的 node，CI/其他环境可能解析失败，可用 `process.execPath` |

## 5. 测试清单（逐项执行，每项记录 通过/失败 + 证据）

> 方法：所有 CLI/MCP 测试在 `C:/Users/liujiayu/AppData/Local/Temp/sp-test-<name>/` 临时目录执行；MCP 用 `@modelcontextprotocol/sdk` 真实客户端（参考 `tests/mcp/server.test.ts` 的写法）；**每项测试后记录输出**。

### A. 完整性（对照需求 10 条验收标准）

| # | 测试 | 步骤 | 预期 |
|---|------|------|------|
| A1 | YAML 定义图 | `graph init` 后检查结构 | graph.yaml 可解析；nodes/edges/index/snapshots 目录齐全 |
| A2 | Agent 通过 MCP 建/读/改节点 | 客户端调 graph_create_node/get_node/update_node_status | 全通，参数校验生效 |
| A3 | 状态机完整生命周期 | pending→ready→running→passed→blocked 全链 + 非法转换 | 14 个合法转换全过，非法报错 |
| A4 | 结构化字段 | 节点含 plan/checkpoints/expected_outcome | create-node --plan-desc/--dod + update-node --add-checkpoint 组合后字段完整 |
| A5 | typed edge 7 种 | add-edge 各类型 + 验证 graph.yaml | 7 种边类型均可写入；depends_on/validates 参与排序 |
| A6 | 拓扑排序 + 环检测 | 正常 DAG + 人为造环 | 排序通过；造环后 validate 报错且**输出不自相矛盾** |
| A7 | Git 快照 | git log | commits 存在，mvp-checkpoint 可回滚 |
| A8 | 人类查看 | export --mermaid + serve | mermaid 可生成；UI 可访问（见 G） |
| A9 | 纯文本可编辑 | 直接改 .graph/nodes/*.yaml 再 status | 手工修改生效 |
| A10 | rebuild | 删 index/ → rebuild | graph.json/meta.json 恢复 |

### B. 代码质量

| # | 测试 | 命令 | 预期 |
|---|------|------|------|
| B1 | 类型检查 | `npx tsc --noEmit` | 零错误 |
| B2 | LSP 诊断 | lsp_diagnostics src + tests + web-ui | 零 error；auxiliary 里 no-console 对 CLI 属误报可忽略 |
| B3 | 测试全量 | `npx vitest run` | ≥79 通过 |
| B4 | 前端构建 | `cd web-ui && npx vite build` | 无警告 |
| B5 | 死代码 | 查未使用 import/导出（knip 报过 addGraphRef 属误报，确认） | 无新增 unused |
| B6 | 依赖最小化 | package.json 核对 | core 仅 js-yaml；运行时 5 依赖（MCP SDK/chokidar/commander/js-yaml/ws） |
| B7 | 错误处理 | 逐命令测错误路径（见 C 矩阵） | 无裸崩溃（ENOENT 堆栈）、无静默假成功 |
| B8 | 安全 | grep password/secret/api_key/token | 无泄漏 |

### C. CLI 11 命令测试矩阵（逐个命令：正常 / 错误 / 边界）

> 统一：`cd <temp>` 后 `graph <cmd>`。每个命令记录：正常输出、错误输出、退出码。

| 命令 | 正常路径 | 错误/边界路径（预期报错且退出码≠0） |
|------|----------|------------------------------------|
| `init` | `-l 名称` 建骨架 | 在已存在 .graph 的目录重复 init（观察是否幂等/覆盖） |
| `create-node` | `-i/-l/-t/--level/--plan-desc/--dod×2/--assigned-to` | ①重复 id（报错不覆盖）②非法 type（报错）③未 init 目录（观察半初始化行为） |
| `add-edge` | `-i/-s/-t/--type` | ①幽灵 source/target ②非法 type ③重复边 id |
| `update-status` | pending→ready→running→passed 全链 | ①非法转换（pending→running 直跳）②非法 status 枚举 ③不存在节点（应友好报错非 ENOENT 堆栈） |
| `update-node` | `--plan-desc/--add-dod×2/--add-checkpoint×2/--set-assigned/--show` | ①非法 checkpoint JSON ②不存在节点 ③--add-checkpoint 多次传参是否全保留（回归！） |
| `delete-node` | 正常删除 | ①不存在节点（报错）②删除后 status/export/rebuild **不再出现**该节点（回归！） |
| `status` | 正常显示 | 未 init 目录（友好报错非崩溃） |
| `validate` | 正常图 | ①造环图（报错+输出一致）②幽灵边图（报错非"误报环"）③未 init |
| `rebuild` | 正常重建 index/ | 未 init 目录（观察行为） |
| `export --mermaid` | 正常导出 | ①软删除节点不出现在 mermaid（回归！）②空图 |
| `serve` | 启动 + 访问 8934 | ①端口占用（报错？）②`/api/graph` 返回 JSON ③静态资源 200（详见 G） |

### D. MCP 9 工具测试矩阵（真实 SDK 客户端，每条记录 isError / 错误消息原文）

| 工具 | 正常 | 缺参（-32602） | 非法枚举（-32602） | 不存在实体（isError） |
|------|------|----------------|---------------------|----------------------|
| `graph_get_node` | 返回完整节点 | `{}` | — | 不存在 id → isError（非假成功） |
| `graph_create_node` | 建节点 | 缺 id | type=`rocket` | 重复 id → isError（不覆盖！回归） |
| `graph_update_node_status` | 全状态链 | 缺 status | status=`bogus` | 不存在节点；非法转换 running→ready → isError |
| `graph_update_checkpoint` | 上报 | 缺 node_id | status 非法 | cp 不存在 → isError |
| `graph_update_execution_report` | 填交接单 | 缺 summary | — | 不存在节点 → isError |
| `graph_delete_node` | 软删除 | 缺 id | — | 不存在 → isError（**回归：曾假成功**） |
| `graph_get_graph` | 全拓扑 | — | — | 空图返回空数组 |
| `graph_traverse` | 正常遍历 | 缺 node_id | direction=`sideways` | 不存在起点 → 观察返回 |
| `graph_search` | 多条件过滤 | — | status 非法 | 无匹配返回空数组 |

**重点验证（agent 视角）：工具返回的 content 是否**：①JSON 可解析 ②错误消息可读（LLM 能自纠）③`isError` 语义正确（非静默）。

### E. Skills 功能测试（agent 调用时会不会出错，记录出错内容）

> 这是本 handoff 的**核心专项**：用真实 subagent 模拟 agent 调用 skills，记录任何报错。

| # | Skill | 测试方法 | 关注点 |
|---|-------|----------|--------|
| E1 | `plumber-flow`（项目 `.pi/skills/plumber-flow/` + 全局 `~/.pi/agent/skills/plumber-flow/`） | 派 subagent 读 skill 后执行"拆解需求→建图→claim→checkpoint→report"全流程 | ①skill 路径引用是否有效 ②协议步骤能否全部执行 ③脚本是否可运行 ④有无过时命令/路径 |
| E2 | `plumber-flow/scripts/graph-claim.mjs` | 直接跑 | ①ready→running+claim_by ②非 ready 节点被状态机拦截（报错内容）③npm root -g 解析是否指向 super-plumber（改名回归！） |
| E3 | `graph-checkpoint.mjs` / `graph-report.mjs` | 直接跑 | 同上 + report 的 artifacts 列表解析 |
| E4 | `plumber-flow/reference.md`（工具参考） | subagent 按参考文档操作 | ①命令示例是否仍有效（`graph` 全局可用）②脚本路径 ③MCP 工具表与实现一致（9 个）
| E5 | 全局脚本（`~/.pi/agent/skills/plumber-flow/scripts/`） | 在**非项目目录**跑 | 改名后 `npm root -g` → `super-plumber/dist/core/node.js` 解析是否成功（回归！） |
| E6 | agents（`.pi/agents/super-mario.md`、`graph-designer.md`） | 检查描述/工具列表与实际一致 | 无失效引用（如曾有的 graph-watchman 问题） |
| E7 | prompts（`~/.pi/agent/prompts/design-topology.md` 等 4 个） | 逐个检查引用的 agent 名存在 | 无失效 agent 引用（回归：曾引用已删除的 graph-watchman） |

**出错记录模板**：`[skill 名] [操作] → 报错原文/堆栈/退出码 → 根因 → 修复建议`。

### F. 性能

| # | 测试 | 方法 | 预期 |
|---|------|------|------|
| F1 | 1000 节点 | 脚本生成 DAG（参考会话方法：1000 节点 2994 边）→ `graph validate` | ≤2s 通过 |
| F2 | 10000 节点深链 | 单链 10000 → validate | 通过且不崩溃（回归：曾栈溢出） |
| F3 | 50000+ 节点（可选） | 压测 detectCycles 上限 | 记录崩溃点或耗时，评估是否需优化 |
| F4 | 增量 vs 全量 | WS 实测 node:updated vs graph:update 负载 | 增量显著更小 |
| F5 | 文件监听 | 高频连续写（10 次/秒）观察 chokidar | 不抖动、不崩溃、事件不丢关键状态 |

### G. Web UI + WebSocket

| # | 测试 | 预期 |
|---|------|------|
| G1 | `graph serve` 启动 + `http://localhost:8934` | 200，index.html |
| G2 | `/api/graph` | JSON 含 nodes/edges/adjacency |
| G3 | WS 连接 → `graph:full` | 收到全量 |
| G4 | 改节点状态 → `node:updated` 增量（含 nodeId/status） | 增量非全量 |
| G5 | 加边 → `graph:update` 全量 | 事件含 file 路径 |
| G6 | 删节点 → `node:updated removed=true` | UI 节点消失 |
| G7 | headless Chrome 渲染 | SVG 节点/边/图例/光点层存在（`--dump-dom`） |
| G8 | 光点流动 | 节点置 running 后 flow-layer 有光点（源码 GraphCanvas.svelte:423+ 已确认，UI 实测） |
| G9 | 50+ 节点交互 | 缩放/平移无明显卡顿（记录主观帧率） |

### H. MCP 协议合规（架构）

| # | 检查 | 预期 |
|---|------|------|
| H1 | McpServer（非 deprecated Server） | src/mcp/server.ts |
| H2 | zod inputSchema 驱动校验 | 非法参数 -32602 |
| H3 | 错误返回 isError 非静默 | 全工具 |
| H4 | 无 deprecated API（z.nativeEnum 等） | grep 确认 |
| H5 | 进程级错误处理 | uncaughtException 兜底存在（仅 MCP 有，CLI 无——已知缺口） |
| H6 | MCP server 名 = super-plumber | initialize 返回 serverInfo.name |

### I. 文档对齐（改名后重点）

| # | 检查 | 预期 |
|---|------|------|
| I1 | README 中英：MCP 9 工具 / 2 agents / 测试数 / 11 命令 / 包名 super-plumber | 与实现一致（README 曾多次过时，重点核对测试数 79、CLI 表 11 项） |
| I2 | CONTEXT.md | 术语与实现一致，品牌名已含 |
| I3 | ADR 0001/0002 | 与拓扑排序/存储实现一致 |
| I4 | `.pi/skills/*` 与全局副本 | 内容同步；路径引用有效（改名为 super-plumber 后无 topological-tool 残留） |
| I5 | prompts 引用 agent | 无失效引用 |
| I6 | docs/verification-handoff.md | 旧名内容，如继续使用需更新品牌名（或本 handoff 取代之） |

### J. 全局集成

| # | 测试 | 预期 |
|---|------|------|
| J1 | `graph --version` | 0.1.0（npm link 符号链接） |
| J2 | `npm ls -g` 含 super-plumber，无 topological-tool | 改名干净 |
| J3 | opencode 配置 `~/.config/opencode/opencode.json` mcp.super-plumber | 键名=super-plumber，command/cwd 指向项目 |
| J4 | 任意目录（非项目）跑全局脚本 | npm root -g 解析成功 |
| J5 | `npm publish --dry-run`（可选） | 包内容正确（不发布） |

## 6. Bug 清单模板（发现后按此记录）

```
[ID] 严重度(高/中/低) | 位置(文件:行) | 现象 | 复现步骤 | 根因 | 修复建议 | 状态(待修复/已修复)
```

## 7. 七维度评分清单（测试完成后按此打分，总分 100）

| 维度 | 权重 | 10 分制标准 | 得分 |
|------|:----:|-------------|:----:|
| A. 完整性 | 15% | 10 条验收标准全过；每缺 1 条扣 1；核心（状态机/拓扑/存储）严重缺扣多 | |
| B. 代码质量 | 20% | tsc/LSP/测试/build 全绿、无死代码、依赖最小、错误处理完整；每项不达标扣 2 | |
| C. 功能正确性 | 25% | 11 CLI + 9 MCP 全端到端正确；静默错误扣 4/个，误导报错扣 2/个 | |
| D. 性能 | 10% | 1000 节点秒级、增量推送生效、UI 流畅 | |
| E. 架构合规 | 10% | McpServer+zod、isError、无 deprecated；违规扣 2/项 | |
| F. 文档对齐 | 10% | README/CONTEXT/ADR/skills/agents/prompts 齐全一致；过时扣 1/项 | |
| G. 测试覆盖 | 10% | 核心全覆盖 + 本 handoff 新增专项；缺关键用例扣分 | |

**等级**：90+ 达标 / 75-89 基本达标需修复 / 60-74 不达标 / <60 重评架构

## 8. 改进方向（测试通过后的可选增强）

1. **entry/exit CLI 命令**（`graph set-entry --desc` / `graph set-exit --desc`）——补齐问题 4.1
2. **MCP graph_diff / graph_snapshot**——需求 4.5 版本控制第一步
3. **CLI claim 参数**：`update-status -s running --claim-by` 对齐 MCP
4. **脚本跨平台化**：plumber-flow 脚本 `grep -oP` → 兼容写法；traverse DFS 迭代化
5. **测试补齐**：MCP 全工具端到端断言、CLI serve/rebuild 错误路径、大图 UI 帧率
6. **npm publish 发布**（包名已确权）

## 9. Suggested Skills（新会话应加载）

- **plumber-flow** —— 测试 skills 功能时按协议操作拓扑图（本会话产物，含协议脚本）
- **plumber-flow**（含 reference.md）—— 工具参考 + 协议
- **systematic-debugging** —— 测试发现 bug 后先找根因再修（Iron Law：无根因不修复）
- **test-driven-development** —— 任何修复前先写失败测试
- **verification-before-completion** —— 宣称测试完成/修复前必须跑证据（tsc/vitest/build）
- **writing-skills** —— 若 skills 功能测试发现缺陷需改进时使用
- **handoff** —— 本文件更新时使用
