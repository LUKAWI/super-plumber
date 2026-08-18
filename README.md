# Super Plumber 🚰 — AI Agent工作流拓扑图管理工具

> 把"任务文档"变成 **agent 能原生理解的拓扑图**：节点是任务、边是依赖、状态机管生命周期。
> 一条命令装好，CLI / MCP / Web UI 三层访问，纯 YAML 文件存储（无数据库、无服务端）。

[![npm version](https://img.shields.io/npm/v/@lukawi/super-plumber)](https://www.npmjs.com/package/@lukawi/super-plumber)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-270%2F270-green)](https://github.com/LUKAWI/super-plumber/actions)
[![GitHub](https://img.shields.io/badge/GitHub-LUKAWI%2Fsuper--plumber-black)](https://github.com/LUKAWI/super-plumber)

**English:** [README.en.md](README.en.md) · **npm:** [@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber)

---

## 为什么需要它？

普通的 Todo 列表只有一行行文字——没有依赖顺序、没有验收标准、没有生命周期。当任务交给 AI agent 执行时，它**看不懂**你的任务文档，只能靠猜。

Super Plumber 把工作流重构为**图**：

```text
todo: "做个注册模块"            →     entry → l1_register → l1_login → exit
                                      ↳ 每个节点 = plan + checkpoints + 验收标准
                                      ↳ 每条边 = 类型化依赖（谁先谁后、谁验证谁）
                                      ↳ 每个状态 = 状态机强制流转（不能跳步）
```

- **对人类**：一目了然的结构、实时可视化的 Web UI、可提交进 Git 的纯文本文件
- **对 AI agent**：通过 MCP 直接读图、认领任务、上报进度——每个节点是一个"压缩包"（计划 + 检查点 + 交接单），agent 不需要猜

---

## 特性一览

| 能力 | 说明 |
|------|------|
| 🧭 **类型化拓扑** | 7 种边类型：`depends_on` / `validates` 参与拓扑排序，`shares_context` / `fan_out` / `fan_in` / `fallback` / `iterates` 表达运行时控制流 |
| 🔄 **状态机强制** | 7 态 + 三条硬规则：ready 门禁（门控前驱必须 passed）、max_attempts 上限（修改 plan 自动重置）、**passed 硬门禁**（无执行报告 / checkpoint 未聚合 / failed 裁决 → 拒绝 passed）；并发认领锁内原子；attempts 重置必须显式 `--reset-attempts`（写审计事件，改 plan 不再自动重置） |
| 🛡️ **Schema 校验** | 读入层逐文件校验 YAML（枚举/类型/必填），手改拼错即时报可读错误，`graph validate` 逐文件定位 |
| 🗂️ **版本控制** | `snapshot` / `diff` / `rollback` 三原语（回滚自动备份、必须确认；**design-only 回滚**保留执行进度只回卷设计），Branch/Merge 由 Git 承担 |
| 🧾 **事件日志** | `.graph/events.jsonl` append-only 审计：谁在何时创建/删除/流转/claim/越权/重置/回滚，`graph events` 一键追查 |
| 🤖 **MCP 原生接入** | 19 个 `graph_*` 工具：设计期（批量建图/建边/编辑 entry-exit）、执行期（原子 claim/checkpoint/report/**reclaim 回收死认领**）、裁决（verdict）、版本（snapshot/diff/rollback）全流程覆盖，zod 参数校验 |
| 🎯 **调度决策** | `graph next` / `graph_get_next_actions` 一屏返回可认领 / **可转 ready（ready_eligible，冷启动入口）** / 等依赖 / 执行中 / 疑似卡住，每桶分页 + truncated 标记，ready/ready_eligible 按节点 `priority` 排序，stale 判据=最后活动时间（上报即心跳），agent 规划循环首选 |
| 📉 **上下文经济** | MCP 读接口全面分页：`graph_get_graph` 默认 summary 模式（紧凑字段）+ full 分页、`graph_search` limit、`graph_traverse` max_nodes、`graph_get_node` 可附拓扑邻居——大图不再 token 爆炸 |
| ⚡ **大图热路径** | 索引两级缓存（内存 + 磁盘 graph.json，mtime 精确新鲜度校验）：门禁/调度从"每次全图扫描"（10k 图 ~9s）降为查表 + 单文件读；调度 O(N+M) |
| 🌐 **Web 可视化** | 力导向图 + 边类型着色 + running 光点流动 + checkpoint 进度条 + 执行报告面板 + 层级过滤/搜索 + 版本 diff 视图，WebSocket 增量推送 + 断线自动重连 + 内部目录事件过滤去抖 |
| 📁 **纯文件存储** | 每个节点/边一个 YAML 文件，Git 是唯一真相源，人类可直接编辑，无数据库 |
| 🧩 **agent 协作协议** | 内置 `plumber-design`（拓扑设计+预览审核）与 `plumber-execute`（拓扑执行+三层验收）双阶段 skill + 2 个专用 subagent（拆解 / 裁决） |

---

## 安装（保姆式）

### 前置要求

| 依赖 | 版本 | 检查方法 |
|------|------|----------|
| Node.js | **≥ 20**（含 npm） | `node --version` |
| 平台 | Windows / macOS / Linux | — |

> 没有 Node.js？去 [nodejs.org](https://nodejs.org) 下载 LTS 版本安装（一路默认下一步即可）。

### 1. 全局安装

```bash
npm install -g @lukawi/super-plumber
```

> **公司内网 / 代理环境**装不上？先确认 npm registry 可达：
>
> ```bash
> npm config get registry        # 应为 https://registry.npmjs.org/
> npm install -g @lukawi/super-plumber --registry=https://registry.npmjs.org
> ```

### 2. 验证安装

```bash
graph --version     # 输出 0.2.0 即成功
graph --help        # 查看全部 19 个命令
which graph         # 确认命令位置（Windows: where graph）
```

### 3. 找个空目录试一下

```bash
mkdir ~/my-first-graph && cd ~/my-first-graph
graph init -l "我的第一个拓扑图"
```

看到 `✅ 已初始化 .graph/ 目录` 就成功了。此时目录里多了一个 `.graph/` 文件夹——这就是你的图。

---

## 快速开始（2 分钟建一张图）

```bash
# 1. 初始化
graph init -l "用户注册模块"

# 2. 创建节点（-i id、-l 标签、--level 层级、--plan-desc 计划、--dod 完成标准可重复）
graph create-node -i l1_register -l "注册功能" -t task --level 1 \
  --plan-desc "实现邮箱+密码注册" --dod "注册接口可用" --dod "密码加密存储"

graph create-node -i l1_login -l "登录功能" -t task --level 1 \
  --plan-desc "实现登录与会话" --dod "登录接口可用"

# 3. 添加依赖边（l1_login 依赖 l1_register）
graph add-edge -i e1 -s l1_register -t l1_login --type depends_on

# 4. 查看状态
graph status

# 5. 校验（引用完整性 + 拓扑排序 + 环检测）
graph validate

# 6. 可视化
graph serve    # 启动服务并自动打开浏览器（无头环境用 graph serve --no-open）
```

---

## 完整教程：从零到交付一张图

以"用户注册模块"为例，走一遍完整生命周期。

### 第 1 步：初始化并设计入口/出口

```bash
graph init -l "用户注册模块"
```

一张图有且仅有一个**入口**（entry，表达需求）和一个**出口**（exit，表达验收标准），都在 level 0。CLI 目前没有专门的 entry/exit 命令，直接用编辑器打开 `.graph/graph.yaml` 填写：

```yaml
entry:
  description: "开发用户注册模块，支持邮箱+密码注册与登录"
  defined_by: human
  level: 0
exit:
  description: "可用的注册/登录功能，全部测试通过"
  acceptance_criteria:
    - "注册接口可用"
    - "登录后能保持会话"
  defined_by: human
  level: 0
```

> `graph validate` 会提醒 entry/exit 为空——这是提示，不是错误；填上后警告消失。

### 第 2 步：创建节点（每个节点是一个"压缩包"）

一个节点 = **id + label + plan（计划）+ checkpoints（检查点）+ definition_of_done（验收标准）**：

```bash
# 主干节点：带计划、完成标准、负责人
graph create-node -i l1_register -l "注册功能" -t task --level 1 \
  --plan-desc "实现邮箱+密码注册：接口、校验、存储" \
  --dod "注册接口返回 200" --dod "密码 bcrypt 加密" --dod "重复邮箱报错" \
  --assigned-to "backend-agent"

# 子节点：细化到可执行粒度
graph create-node -i l2_reg_api -l "注册接口" -t task --level 2 \
  --plan-desc "POST /register 接口" --dod "接口测试通过"

graph create-node -i l2_reg_store -l "用户存储" -t task --level 2 \
  --plan-desc "用户表 + 密码加密" --dod "存储层测试通过"
```

给节点加**检查点**（checkpoint，执行时逐步上报的子步骤）：

```bash
graph update-node -i l1_register \
  --add-checkpoint '{"id":"cp1","label":"接口开发"}' \
  --add-checkpoint '{"id":"cp2","label":"密码加密"}' \
  --add-checkpoint '{"id":"cp3","label":"联调测试"}'

# 查看节点完整内容
graph update-node -i l1_register --show
```

### 第 3 步：连接边（7 种类型任选）

```bash
graph add-edge -i e1 -s l1_register -t l1_login --type depends_on
graph add-edge -i e2 -s l2_reg_api -t l2_reg_store --type depends_on
graph add-edge -i e3 -s l2_reg_api -t l1_register --type validates   # 验证关系
graph add-edge -i e4 -s l1_register -t l1_login --type shares_context # 共享上下文
```

| 边类型 | 语义 | 参与拓扑排序 |
|--------|------|:---:|
| `depends_on` | 顺序依赖：B 依赖 A 完成 | ✅ |
| `validates` | 验证关系：A 的输出由 B 验证 | ✅ |
| `shares_context` | A 的输出作为 B 的输入上下文 | ❌ |
| `fan_out` | A 完成后多个下游可并行 | ❌ |
| `fan_in` | 多个上游都完成后 C 才可执行 | ❌ |
| `fallback` | B 失败时回退到 A 重试 | ❌ |
| `iterates` | A ⇄ B 反复迭代优化 | ❌ |

> `depends_on` / `validates` 参与拓扑排序；其余边表达运行时控制流，排序自动忽略（如 `fallback` 的逆向引用不会误报成环）。

### 第 4 步：校验

```bash
graph validate
```

预期输出：

```text
✅ 节点: 3 个
✅ 边: 4 条
✅ 拓扑排序: 3 节点通过
✅ 循环检测: 无环路
📊 校验结果: 0 错误, 0 警告
```

> **故意制造一个环试试**：`graph add-edge -i e_cycle -s l1_login -t l1_register --type depends_on`
> validate 会明确报出 `检测到循环依赖: l1_register → l1_login → l1_register`——工具不会让你带着环上路。

### 第 5 步：执行（状态机驱动，agent 或人认领）

```bash
# 状态机：pending → ready → running → passed
graph update-status -i l1_register -s ready      # 前置完成，进入待执行
graph update-status -i l1_register -s running    # 认领（claim）：记录开始时间（记录执行者需 MCP 传 claim_by）
graph update-status -i l1_register -s passed     # 完成

# 试试非法跳步——会被状态机拦住：
graph update-status -i l1_login -s running
# ❌ Invalid transition: pending → running. Allowed: [ready, cancelled]
```

> 完整状态机：`pending → ready → running → passed → blocked`，`running → failed → pending`（重试，自动累加 `attempts`），任意状态 → `cancelled`。

**上报 checkpoint 和交接单**（CLI 没有这两个命令，用 MCP 工具或 skill 脚本）：

方式一 · MCP 工具（需已接入 agent，见下文 MCP 章节）：

```json
// graph_update_checkpoint: { node_id: "l1_register", checkpoint_id: "cp1", status: "passed" }
// graph_update_execution_report: { node_id: "l1_register", summary: "注册功能完成", artifacts: ["dist/register.js"] }
```

方式二 · skill 脚本（脚本随 `plumber-execute` skill 提供，pi 用户位于 `~/.pi/agent/skills/plumber-execute/scripts/`，项目内为 `.pi/skills/plumber-execute/scripts/`）：

```bash
SCRIPTS=~/.pi/agent/skills/plumber-execute/scripts

# 认领 ready 节点（记录 claim_by + started_at；非 ready 节点会被状态机拦截）
node $SCRIPTS/sp-claim.mjs l1_register backend-agent

# 每完成一个检查点就上报一次（报告完的进度不会丢）
node $SCRIPTS/sp-checkpoint.mjs l1_register cp1 passed

# 交付交接单（summary + artifacts + blockers + notes）
node $SCRIPTS/sp-report.mjs l1_register "注册功能完成" "dist/register.js,test/register.test.js" "" "密码加密采用 bcrypt"
```

### 第 6 步：可视化与分享

```bash
graph export --mermaid -o flow.mmd    # 导出 Mermaid 流程图
graph serve                           # 打开 http://localhost:8934 看力导向图
```

---

## CLI 命令参考（11 个）

| 命令 | 功能 | 常用参数 |
|------|------|----------|
| `graph init` | 初始化 `.graph/` 骨架（含 schema.yaml） | `-l <label>` 图名称；`--force` 已初始化时强制重置 |
| `graph create-node` | 创建节点（一次可带完整压缩包） | `-i <id>` `-l <label>` `-t <type>`（task/checkpoint/decision/gate）`--level <n>` `--plan-desc <text>` `--dod <item>`（可多次）`--assigned-to <agent>` `--max-attempts <n>` |
| `graph get-node` | 读取节点 + 合法转换 + 门禁状态（可附拓扑邻居） | `-i <id>`；`--json` 稳定输出；`--neighbors up\|down\|none` |
| `graph add-edge` | 添加边（核心层校验端点存在） | `-i <id>` `-s <source>` `-t <target>` `--type <7种之一>` |
| `graph update-status` | 状态流转（状态机 + ready 门禁 + max_attempts + passed 硬门禁） | `-i <id>` `-s <status>`；`--claim-by <agent>` 认领；`--force` 仅人类运维 |
| `graph reclaim` | 回收死认领：running → pending（清空执行者 + 回收记录） | `-i <id>`；`--by <actor>` |
| `graph update-node` | 更新节点详情 | `-i <id>` `--plan-desc` `--add-dod <item>`（可多次）`--clear-dod` `--add-checkpoint '<JSON>'`（可多次）`--set-assigned <agent>` `--label <text>` `--max-attempts <n>` `--show` |
| `graph update-graph` | 编辑 entry/exit/验收标准/图名（不再手写 graph.yaml） | `--entry-desc` `--exit-desc` `--add-criteria <item>`（可多次）`--clear-criteria` `--label` `--set-context '<json>'` |
| `graph delete-node` | 软删除节点；有引用边默认拒绝 | `-i <id>`；`--cascade` 连同引用边一起删 |
| `graph delete-edge` | 软删除边 | `-i <id>` |
| `graph status` | 状态概览 + 拓扑检查 | `--json` |
| `graph validate` | schema + 引用 + 拓扑 + 环（逐文件定位） | `--json` |
| `graph next` | 调度决策：可认领/可转 ready/等依赖/执行中/疑似卡住 | `--stale-ms <ms>`（默认 30 分钟）；`--json` |
| `graph verdict` | 记录裁决结论（Super Mario 用） | `-i <id>` `--verdict passed\|failed\|pending` `--note <text>` |
| `graph snapshot` | 创建版本快照 | `-m <msg>`；`--git` 同时 git commit |
| `graph snapshots` | 快照列表 | `--json` |
| `graph diff` | 差异对比（默认最新快照 vs 当前） | `--from <id>` `--to <id>`；`--json` |
| `graph rollback` | 回滚（自动备份当前状态） | `<snapshot-id>` `--confirm`；`--design-only` 保留执行进度只回卷设计 |
| `graph events` | 查看事件日志（审计追溯） | `--node <id>` `--kind <k>` `--last <n>`；`--json` |
| `graph rebuild` | 重建 `index/` 派生索引（graph.json + topology.dot） | — |
| `graph export --mermaid` | 导出 Mermaid 图 | `-o <file>` |
| `graph serve` | 启动 Web UI（自动打开浏览器） | `-p <port>`（默认 8934）；`--no-open` 不自动打开 |

> 参数拿不准？每个命令都有 `--help`：`graph create-node --help`。

### 快捷指令（别名）

常用命令支持 1-2 字符别名，完整命令照常可用（两者等价）：

| 完整命令 | 别名 | 完整命令 | 别名 |
|----------|------|----------|------|
| `graph init` | `graph i` | `graph update-node` | `graph un` |
| `graph create-node` | `graph cn` | `graph delete-node` | `graph dn` |
| `graph get-node` | `graph gn` | `graph delete-edge` | `graph de` |
| `graph add-edge` | `graph ae` | `graph update-graph` | `graph ug` |
| `graph update-status` | `graph us` | `graph next` | `graph n` |
| `graph verdict` | `graph vd` | `graph diff` | `graph d` |
| `graph snapshot` | `graph sp` | `graph snapshots` | `graph sps` |
| `graph rollback` | `graph rol` | `graph status` | `graph s` |
| `graph validate` | `graph v` | `graph export --mermaid` | `graph x --mermaid` |
| `graph rebuild` | `graph rb` | `graph serve` | `graph sv` |

例如：`graph cn -i t1 -l "任务1"` ≡ `graph create-node -i t1 -l "任务1"`。

---

## 状态机（7 态 + 三条硬规则）

```text
pending ──► ready ──► running ──► passed ──► blocked
                     │   │
                     │   └──► failed ──► pending   （重试，attempts 累加）
                     ▼
              cancelled（终止态）
        blocked ──► ready / failed / cancelled
```

- **认领（claim）**：`ready → running` 记录 `assigned_to` + `started_at`（MCP 传 `claim_by` 参数）
- **完成**：转 `passed` / `failed` 自动记录 `completed_at`
- **passed 硬门禁**：无执行报告（summary 为空）/ 存在 failed 裁决 / checkpoint 未聚合时，`running → passed` 被核心层拒绝（`--force` 仅人类运维）
- **回收**：`graph reclaim` 把 running 死认领收回 pending（执行 agent 崩溃后的恢复路径）；cancelled 可重开为 pending
- **保护**：非法转换（如 `pending → running` 直跳）返回明确错误，**绝不静默**

---

## MCP：让 AI agent 直接干活 🤖

Super Plumber 自带 MCP Server（stdio 传输），coding agent 可以像用工具一样读图、建节点、认领任务、上报进度。

### 启动

```bash
graph-mcp
```

### 接入配置

**Claude Code**（`claude.json`）：

```json
{
  "mcpServers": {
    "super-plumber": {
      "command": "graph-mcp"
    }
  }
}
```

**opencode**（`~/.config/opencode/opencode.json`）：

```json
{
  "mcp": {
    "super-plumber": {
      "type": "local",
      "command": ["graph-mcp"],
      "enabled": true
    }
  }
}
```

> 也可以直接用绝对路径：`"command": "node D:/path/to/dist/mcp/server.js"`，并设 `cwd` 为你的图所在目录；或 `"command": "graph-mcp --root /path/to/graph"` 显式指定图目录。

### 19 个工具

**调度**：`graph_get_next_actions` — 一次返回可认领（ready）/ **可转 ready（ready_eligible，门禁已满足的 pending/failed——冷启动入口）** / 等依赖（blocked，附未满足前驱）/ 执行中（running，附时长）/ 疑似卡住（stale_running），每桶分页（`limit` + `truncated`），是 agent 规划循环的首选。

**读取**：`graph_get_node`（节点 + 合法转换 + checkpoint 聚合 + 门禁状态，可附拓扑邻居）、`graph_get_graph`（默认 summary 紧凑模式，`mode=full` + `offset/limit` 分页）、`graph_traverse`（`max_nodes` 上限）、`graph_search`（`limit` 上限 + 紧凑结果）。

**设计期写入**：`graph_create_node`（一次带 plan/DoD/checkpoints 完整压缩包）、`graph_batch_create`（批量 nodes+edges，先全量预校验报全部冲突）、`graph_add_edge`、`graph_update_node`、`graph_update_graph`（entry/exit/验收标准）、`graph_delete_node`（有引用边默认拒绝，`cascade` 连删）、`graph_delete_edge`。

**执行期写入**：`graph_update_node_status`（`status=running` 传 `claim_by` 完成**原子认领**，并发只有第一个成功；**force 在 MCP 通道被协议级拒绝**——人类运维走 CLI `--force`，留 force_override 审计事件）、`graph_update_checkpoint`（checkpoint 状态机 + 幂等）、`graph_update_execution_report`（交接单 + `verification` 裁决结论）、`graph_reclaim_node`（回收死认领：running → pending）。`graph_update_node` 的 attempts 重置必须显式 `reset_attempts: true`（改 plan 不再隐式重置，重置必留审计事件）。

**版本**：`graph_snapshot` / `graph_diff` / `graph_rollback`（必须 `confirm: true`；`design_only: true` 只回卷设计、保留执行进度）。

**可靠性设计**：所有参数经 zod schema 校验——缺参、非法枚举返回 `-32602` 协议错误；不存在的节点/边返回 `isError=true` 和可读的错误消息；非法状态转换/门禁/次数上限/passed 硬门禁明确报错。**工具永远不静默失败**。

---

## Web UI（Svelte 5 + D3.js）

```bash
graph serve
# 自动打开默认浏览器访问 http://localhost:8934；CI/无头环境用 `graph serve --no-open`
```

- **力导向图**：缩放 / 平移 / 适应视图（修复版）/ 固定布局开关，按节点状态着色
- **边类型可视化**：7 种边类型不同颜色，悬停高亮，**点击边查看语义与合约**
- **光点流动**：`running` 节点的下游边有光点沿边流动（"血管"隐喻）
- **checkpoint 进度条**：节点下方展示子步骤完成进度；详情面板含**执行报告（交接单 + 裁决徽标）**
- **执行者标签**：`running` 节点旁显示 `assigned_to`
- **分层钻取与搜索**：L0–L5 层级 chips 高亮过滤 + id/label 搜索 + 状态摘要条
- **版本 diff 视图**：快照列表 → 画布上新增（绿）/ 删除（红）/ 修改（黄）着色 + 状态变化明细
- **WebSocket 增量推送**：节点变更推送 `node:updated` 增量（非全量重推）；边变更只更新边层不重排布局；**断线指数退避自动重连**（HTTP 兜底刷新）

---

## 存储结构（Git 友好，人类可读）

```text
.graph/                    # 运行时目录（graph init 生成，已在 .gitignore）
├── graph.yaml             # 图定义：入口/出口/根上下文 + 节点/边引用列表
├── schema.yaml            # 人类可读的 schema 说明（运行时校验在 core/schema.ts）
├── nodes/*.yaml           # 节点文件：plan / checkpoints / expected_outcome / execution_report
├── edges/*.yaml           # 边文件：source / target / type / contract
├── snapshots/<id>/        # 版本快照：manifest + 完整文件副本（graph snapshot）
├── events.jsonl           # append-only 事件日志（graph events 读取；可 gitignore 亦可入库审计）
└── index/                 # 派生索引（graph.json / meta.json / topology.dot，可删可重建）
```

**设计理念：**

- **Git 是唯一真相源** —— 所有数据是文件，可 diff、可回滚、可 review
  > ⚠️ 若以 Git 为真相源（删除 `.graph/` 后可 `git clone` 恢复），**不要**把 `.graph/` 写进 `.gitignore`；本仓库忽略它只因开发期运行时图不入库
- **文件即节点** —— 一个节点一个 YAML，人类可以直接用编辑器修改
- **结构优先于文本** —— YAML schema 约束，拒绝自由 Markdown 的模糊性
- **纯文件系统** —— 无数据库；软删除保留 `.deleted.yaml` 历史

> 仓库里附带了示例拓扑 `.graph-example/`（20 节点 36 边 + `setup-topology.sh` 重建脚本），可以参考它的节点/边写法。

---

## Pi Agent 生态：subagent + skill

项目内置 2 个专用 subagent（`.pi/agents/`）与 2 个阶段化 skill（`.pi/skills/plumber-design/` + `.pi/skills/plumber-execute/`）：

| Agent | 角色 | 职责 |
|-------|------|------|
| `sp-designer` | 拓扑图设计师 | 把需求拆解为结构化拓扑，为每个节点制定 plan 和 definition_of_done |
| `super-mario` | 拓扑主控 | 节点生命周期裁决（checkpoint 聚合 + 输出抽查）、重试管理、状态监测 |

**两阶段 skill 协议**：`plumber-design` 负责**设计期**（需求拆解 → 拓扑图 → `graph validate` + 体检脚本验证无 bug → `graph serve` 打开浏览器预览 → 请求用户审核，审核是硬性 gate）；用户批准后 `plumber-execute` 负责**执行期**（claim → 逐 checkpoint 上报 → execution_report → passed，fan_out/fan_in 结构 + 条件判断决定何时派 subagent 并行，全部 task 节点 passed 后做三层验收：状态层全绿 + 结构层 validate 0 error + 成果层逐条对照 exit 验收标准与真实 artifact）。配套脚本：design 侧 `sp-check-design.mjs`（设计体检），execute 侧 6 个（read/status/claim/checkpoint/report/traverse），保证 agent 按协议操作拓扑图、不越权、不假报进度。

---

## 开发与测试

```bash
# 从源码构建
git clone https://github.com/LUKAWI/super-plumber
cd super-plumber
npm install
npm run build && npm --prefix web-ui run build

# 测试（97 个用例：状态机/拓扑/CLI/MCP 协议）
npm test

# 本地链接全局（开发调试用）
npm link
graph --version
```

---

## 常见问题（FAQ）

| 问题 | 原因与解决 |
|------|-----------|
| `❌ 未找到 .../.graph/graph.yaml，请先运行 graph init` | 当前目录还没有图。先 `graph init`，或 `cd` 到图所在目录 |
| `❌ 端口 8934 已被占用` | 已有 serve 在跑。`graph serve -p 8935` 换端口 |
| `❌ Node x already exists` / `Edge x already exists` | id 重复。工具拒绝覆盖，换一个新 id |
| `❌ Invalid transition: ...` | 跳过了状态机允许的路径。按 `Allowed: [...]` 提示走合法转换 |
| `❌ MCP error -32602: ...` | 调用 MCP 工具缺参数或传了非法枚举，按提示补参数/改枚举 |
| `❌ 节点不存在: x` | 该节点不存在（可能是软删除或 id 写错），用 `graph status` / `graph_search` 确认 |
| `❌ Node x 前置未满足，不能进入 ready/running` | ready 门禁拦截（前驱未全部 passed）。先完成前驱，**不要用 --force**（仅人类运维） |
| `❌ force 仅人类运维通道（CLI…），MCP 拒绝执行` | 设计如此：agent 无法越权。人类运维请走 CLI `graph update-status --force`（写 force_override 审计事件） |
| `❌ Node x already claimed by y` | 并发认领竞争失败（原子保护）。换一个 ready 节点 |
| `❌ Node x 已达最大重试次数` | attempts 用尽。人工介入，或 `graph update-node --plan-desc` 改计划（attempts 自动归零） |
| `❌ Node x 无执行报告，不能标记 passed` | passed 硬门禁：先 `graph update-execution-report` 填交接单（summary 非空）；checkpoint 未聚合或 failed 裁决也会被拒 |
| `❌ Node x 被 N 条边引用` | 删除会留悬挂引用。`--cascade` 或先 `delete-edge` |
| `❌ 节点长时间 running 无进展` | 死认领：`graph reclaim -i <id>` 收回 pending 重新调度（执行 agent 已崩溃时） |
| `❌ schema 校验失败: ...` | 手改 YAML 拼错字段。`graph validate` 逐文件定位修正 |
| 改完代码全局命令没变化 | 全局是发布包的快照。`npm version patch && npm publish && npm i -g @lukawi/super-plumber` |
| `graph serve` 后页面是空图 | 检查 cwd 是否是图所在目录；空图时 UI 会显示空状态引导 |
| UI 断线不更新 | v0.2 起自动重连（指数退避 + HTTP 兜底）；如服务已退出请重新 `graph serve` |

---

## 项目状态

```text
Tests: 270（后端）+ 12（前端）✅ | CLI: 21 命令 | MCP: 19 工具 | 状态机: 7 态 + ready 门禁 + max_attempts + passed 硬门禁 + 事件日志审计 | 边类型: 7 种 | 版本控制: snapshot/diff/rollback（含 design-only）| Web UI: Svelte 5 + D3.js
```

- **npm**: [@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber)
- **GitHub**: [LUKAWI/super-plumber](https://github.com/LUKAWI/super-plumber)
- **架构决策**: `docs/adr/`（拓扑排序忽略运行时边 / 纯文件存储）
- **领域术语**: `CONTEXT.md`

## License

MIT © 2026 Super Plumber contributors
