# Super Plumber 🚰 — 让 AI agent 按拓扑图干活的工具

> 把"任务文档"变成 **agent 能原生理解的拓扑图**：节点是带计划与验收标准的压缩包、边是类型化依赖、
> 状态机管生命周期。CLI / MCP / 星空可视化 Web UI 三层访问，纯 YAML 文件存储——无数据库、无服务端，
> Git 就是版本控制。

[![npm version](https://img.shields.io/npm/v/@lukawi/super-plumber)](https://www.npmjs.com/package/@lukawi/super-plumber)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
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

- **对人类**：一目了然的结构、挂屏级的星空可视化、可提交进 Git 的纯文本文件
- **对 AI agent**：通过 MCP 直接读图、认领任务、上报进度——每个节点是一个"压缩包"，agent 不需要猜

---

## 它与众不同在哪里？

市面上不缺任务管理工具，缺的是**给 agent 用的工作流底座**。Super Plumber 的差异点：

**① 结构优先，不是又一朵 Markdown 云**
Todo 工具给 agent 的是文本，它得猜顺序、猜验收。这里给的是受 schema 约束的图——依赖参与拓扑排序、
`ready` 门禁拦截跳步、`passed` 硬门禁拒绝没有交接单的"我做完了"。agent 想糊弄？状态机先不答应。

**② Agent 是一等用户，人是监督者**
26 个 MCP 工具覆盖设计→执行→裁决全流程：原子认领（并发只有一个成功）、checkpoint 逐步上报、
交接单（summary + artifacts）落盘、死认领回收、设计审批凭据（approve）、审计日志逐条可追查。读接口全面分页——
大图不再撑爆 agent 的上下文窗口。

**③ 独此一家的星空监控台**
`graph serve` 打开不是又一格仪表盘，而是一片**可以挂屏盯一下午的星空**：每个任务是八向棱星、
状态色贴芒呼吸、running 的能量沿边流动、领域是星云、银河带横贯背景。专注模式下 chrome 全部退场——
左上角扫一眼，哪个任务在跑、哪些卡住，一目了然。

**④ 领域建模是一等公民，不是注释**
bounded context 是图里的顶点（边界 + 术语表，节点即文档），ADR 是带三态机的决策顶点——
废弃必带接替者，决策变更沿 decides 边自动传播成"决策依据已过时 ⚠️"警告。`graph export --docs`
从图反向生成领域文档——图是真相源，文档是视图。

**⑤ 多 agent 裁决协议开箱即用**
`sp-designer`（拓扑设计）与 `super-mario`（裁决主控）双 subagent + 两阶段 skill：设计期有审核硬门禁，
执行期有三层验收（状态全绿 + 结构校验 + 成果对照验收标准）。单人单会话？solo 裁决边界有成文规则
——机械核算可自裁，裁量必须留人。

**⑥ 纯文件，Git 就是版本控制**
一个节点一个 YAML，无数据库无服务端。快照/对比/回滚三原语 + append-only 审计日志，
branch/merge 直接交给 Git。

---

## 特性一览

| 能力 | 说明 |
|------|------|
| 🌌 **星空可视化（v0.7.0 深空仪器舱 + v0.8.1 前沿视图）** | 星空画布 + 玻璃 chrome：单排仪器条、浮动玻璃 dock、图库弹层、右缘统一详情抽屉、专注模式挂屏；v0.8.1 增「前沿」一键过滤（ready + 门禁已满足的 pending 合并）、开发分期图例、术语 Avoid 尾注高亮；详见 [Web UI](#web-ui星空观测台svelte-5--d3js) |
| 🗂️ **多图工作区（v0.5.2）** | 一个 `.graph/` 管多张命名图：类 git branch 的 `graph switch`（工作区默认 + MCP 进程内 active 双层语义）、`graph init <内容名>`/`list`/`rename-graph`/`delete-graph`（.trash 软删除）、全部命令支持 `--graph` 参数与 `SUPER_PLUMBER_GRAPH`；旧仓库零迁移兼容（建第二图时锁内一次性迁移）；每图独立锁/索引/事件/快照 |
| 🧭 **类型化拓扑** | 9 种边类型：`depends_on` / `validates` 参与拓扑排序，`shares_context` / `fan_out` / `fan_in` / `fallback` / `iterates` 表达运行时控制流，`decides` / `relates`（v0.5）承载领域知识边 |
| 🏛️ **领域语义（v0.5）** | **bounded context 与 ADR 是图中一等公民**：context 顶点"节点即文档"（boundary+术语表 glossary），节点归属（`--context`）派生工作流/领域两张 map；**ADR 三态机** proposed→accepted→superseded（废弃必带接替者、提议/裁决分离）；`graph adr` 命令组 + MCP `graph_create_adr`；决策变更沿 decides 边传播（claim 注入 `governing_adrs` 指针、调度条目打 `adr_flags` ⚠️）；跨 context 工作流边为契约边（必填 contract）；`graph export --docs` 按图分树导出 docs/<图名>/adr + docs/<图名>/CONTEXT-MAP.md + docs/<图名>/contexts/ + DECISIONS.md 决议一行索引（v0.8.1：passed task + accepted/superseded ADR；图为真相源，md 是视图） |
| 🔄 **状态机强制** | 7 态 + 三条硬规则：ready 门禁（门控前驱必须 passed）、max_attempts 上限、**passed 硬门禁**（无执行报告 / checkpoint 未聚合 / failed 裁决 → 拒绝 passed）；并发认领锁内原子；attempts 重置必须显式 `--reset-attempts`（写审计事件，改 plan 不再自动重置）；知识顶点豁免状态机（context 无状态、adr 走三态机） |
| 🛡️ **Schema 校验** | 读入层逐文件校验 YAML（枚举/类型/必填），手改拼错即时报可读错误，`graph validate` 逐文件定位 + 六条领域规则（悬空归属=error、同 context 术语重复=warning、跨 context 缺契约=warning、relates 端点=error、孤儿 ADR=warning、decides 来源=error） |
| 🗂️ **版本控制** | `snapshot` / `diff` / `rollback` 三原语（回滚自动备份、必须确认；**design-only 回滚**保留执行进度只回卷设计），Branch/Merge 由 Git 承担 |
| 🧾 **事件日志** | `.graph/events.jsonl` append-only 审计：谁在何时创建/删除/流转/claim/越权/重置/回滚/ADR 生命周期（adr_created/accepted/superseded），`graph events` 一键追查 |
| 🤖 **MCP 原生接入** | 26 个 `graph_*` 工具：设计期（批量建图/建边/编辑 entry-exit/**graph_create_adr**/**graph_approve 审批凭据**/**graph_graduate_fog 雾区毕业**）、执行期（原子 claim 附管辖 ADR 指针/checkpoint/report/**reclaim 回收死认领**）、裁决（verdict）、版本（snapshot/diff/rollback）、自检（**graph_validate** 结构+领域规则+引用漂移）、审计（**graph_events** 事件回溯）全流程覆盖，zod 参数校验 |
| 🎯 **调度决策** | `graph next` / `graph_get_next_actions` 一屏返回可认领 / **可转 ready（ready_eligible，冷启动入口）** / 等依赖 / 执行中 / 疑似卡住，每桶分页 + truncated 标记，ready/ready_eligible 按节点 `priority` 排序，stale 判据=最后活动时间（上报即心跳），条目可含 `adr_flags`（决策依据已过时 ⚠️），知识顶点永不进调度桶，agent 规划循环首选 |
| 📉 **上下文经济** | MCP 读接口全面分页：`graph_get_graph` 默认 summary 模式（紧凑字段）+ full 分页、`graph_search` limit、`graph_traverse` max_nodes、`graph_get_node` 可附拓扑邻居——大图不再 token 爆炸；ADR 只注入标题级指针，永不全文推送 |
| ⚡ **大图热路径** | 索引两级缓存（内存 + 磁盘 graph.json）：门禁/调度从"每次全图扫描"（10k 图 ~9s）降为查表 + 单文件读；调度 O(N+M)；**写路径主动失效缓存**（不赌文件系统 mtime，长驻进程写后读一致） |
| 📁 **纯文件存储** | 每个节点/边一个 YAML 文件，Git 是唯一真相源，人类可直接编辑，无数据库 |
| 🧩 **agent 协作协议** | 内置 `plumber-design`（拓扑设计+领域建模+ADR 甄别+预览审核闸门）与 `plumber-execute`（拓扑执行+三层验收+管辖 ADR 纪律）双阶段 skill，加纪律技能 `sp-grilling`（v0.8.0：意图对齐与决策纠正的对话核心）+ 2 个专用 subagent（拆解 / 裁决） |

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
graph --version     # 输出版本号即成功
graph --help        # 查看全部 29 个命令
which graph         # 确认命令位置（Windows: where graph）
```

### 3. 找个空目录试一下

```bash
mkdir ~/my-first-graph && cd ~/my-first-graph
graph init my-first-graph -l "我的第一个拓扑图"
```

看到 `✅ 已创建图 "my-first-graph" 并设为工作区默认` 就成功了。此时目录里多了一个 `.graph/` 文件夹，你的图数据在 `.graph/my-first-graph/` 里。

---

## 快速开始（2 分钟建一张图）

```bash
# 1. 初始化（v0.5.2 起新仓库必须带图名，内容命名）
graph init user-registration -l "用户注册模块"

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
graph init user-registration -l "用户注册模块"
```

一张图有且仅有一个**入口**（entry，表达需求）和一个**出口**（exit，表达验收标准），都在 level 0。用 `graph update-graph` 填写（不再手写 graph.yaml）：

```bash
graph update-graph \
  --entry-desc "开发用户注册模块，支持邮箱+密码注册与登录" \
  --exit-desc "可用的注册/登录功能，全部测试通过" \
  --add-criteria "注册接口可用" --add-criteria "登录后能保持会话"
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

### 第 3 步：连接边（7 种工作流边 + 2 种知识边）

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
| `decides` | ADR → 任意顶点：决策管辖，ADR 废弃时沿此传播 adr_flags（v0.5 知识边） | ❌ |
| `relates` | context ↔ context：领域关系，`--rel-kind` 自由标注（v0.5 知识边） | ❌ |

> `depends_on` / `validates` 参与拓扑排序；其余工作流边表达运行时控制流，排序自动忽略（如 `fallback` 的逆向引用不会误报成环）；知识边（`decides` / `relates`）不参与排序与门禁。

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
📊 结果: 0 错误, 0 警告
```

> **故意制造一个环试试**：`graph add-edge -i e_cycle -s l1_login -t l1_register --type depends_on`
> validate 会明确报出 `检测到循环依赖: l1_register → l1_login → l1_register`——工具不会让你带着环上路。

### 第 5 步：执行（状态机驱动，agent 或人认领）

```bash
# 状态机：pending → ready → running → passed
graph update-status -i l1_register -s ready      # 前置完成，进入待执行
graph update-status -i l1_register -s running    # 认领（claim）：记录开始时间（`--claim-by <agent>` 记录执行者）
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
graph export --mermaid -o flow.mmd    # 导出 Mermaid 流程图（知识顶点形状/配色 + 边样式区分，文件头含 entry/exit 与图例）
graph serve                           # 打开 http://localhost:8934 看星空拓扑
```

---

## CLI 命令参考（29 个）

| 命令 | 功能 | 常用参数 |
|------|------|----------|
| `graph init` | 初始化：新仓库必须带图名建图（v0.5.2）；旧仓库带名 init = 迁移 + 建图 | `<名>` 图名（新仓库必填，如 refactor-auth）；`-l <label>` 显示名；`--force` 同名图软删重建 / 旧式单图强制重置 |
| `graph switch` | 切换工作区默认图（写 `.graph/active`）；无参显示当前图（含来源） | `[<名>]`；切换时提示原图 running 在途 |
| `graph list` | 列举工作区全部图（或查指定图详情） | `[<名>]`；`--json` |
| `graph rename-graph` | 重命名图（目录随迁 + active 修正 + 审计）；仅 CLI 人类通道 | `-o <旧名>` `-n <新名>` |
| `graph delete-graph` | 删除图（软删除至 `.trash/`，可手工救回；拒删最后一张/默认图）；仅 CLI 人类通道 | `-i <名>` `--confirm` |
| `graph create-node` | 创建节点（可带计划与完成标准；checkpoint 用 `update-node` 补） | `-i <id>` `-l <label>` `-t <type>`（task/checkpoint/decision/gate/context/adr）`--level <n>` `--priority <n>`（越小越先）`--context <ctx_id>`（v0.5 归属）`--plan-desc <text>` `--dod <item>`（可多次）`--assigned-to <agent>` |
| `graph get-node` | 读取节点 + 合法转换 + 门禁状态（可附拓扑邻居） | `-i <id>`；`--json` 稳定输出；`--neighbors up\|down\|none` |
| `graph add-edge` | 添加边（核心层校验端点存在） | `-i <id>` `-s <source>` `-t <target>` `--type <9种之一>`；`--contract '<json>'` 跨 context 契约边；`--rel-kind <text>` relates 标注 |
| `graph update-status` | 状态流转（状态机 + ready 门禁 + max_attempts + passed 硬门禁） | `-i <id>` `-s <status>`；`--claim-by <agent>` 认领；`--force` 仅人类运维 |
| `graph reclaim` | 回收死认领：running → pending（清空执行者 + 回收记录） | `-i <id>`；`--by <actor>` |
| `graph update-node` | 更新节点详情 | `-i <id>` `--plan-desc` `--add-dod <item>`（可多次）`--clear-dod` `--add-checkpoint '<JSON>'`（可多次）`--set-assigned <agent>` `--label <text>` `--max-attempts <n>` `--set-priority <n>` `--set-context <ctx_id>` `--boundary <text>` `--glossary-add '<JSON>'`（可多次）`--reset-attempts`（显式归零，写审计事件）`--show` |
| `graph update-graph` | 编辑 entry/exit/验收标准/图名/雾区/工作类（不再手写 graph.yaml） | `--entry-desc` `--exit-desc` `--add-criteria <item>`（可多次）`--clear-criteria` `--label` `--set-context '<json>'` `--set-fog '<json>'`（v0.9.0：`{"id","description","graduation","ignited[]"}` 整体 upsert）`--class quick\|standard\|program` |
| `graph approve` | 写入设计审批凭据（v0.8.0：review 字段 + design_approved 事件；仅记录零门禁，quick 档自签；v0.9.2：`--level` 分层凭据，program 类图审一层批一层） | `--by <名>`（必填）；`--status approved\|self`（默认 approved）；`--level <层标>`（v0.9.2：追加 review.layers 分批记录，缺省=整图凭据） |
| `graph graduate-fog` | 雾区毕业（v0.9.0：清除图级 fog + fog_graduated 专用事件，复用 DEC-7 改图守卫；validate 对有雾图只提示不阻止） | `--produced <id,id>` 毕业产物；`--reason <text>` 结论摘要；无雾报错 |
| `graph adr` | ADR 生命周期命令组（v0.5）：create 即落 proposed，accept/supersede 归裁决方 | `create -t <标题> -d <决策>`；`accept -i <id>`；`supersede -i <id> --by <id>`；`list [-s <状态>]` |
| `graph delete-node` | 软删除节点；有引用边默认拒绝；拒绝理由作审计凭据（v0.8.1：进 .deleted.yaml 与 node_deleted 事件，缺省行为不变） | `-i <id>`；`--cascade` 连同引用边一起删；`--reason <text>` |
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
| `graph export` | 导出 Mermaid 流程图（context 胶囊 teal 无状态行、ADR 六边形三态色、边样式按类型区分，文件头注释含 entry/exit 与图例；v0.8.1 默认按 level 分期带 subgraph 分组，`--levels` 裁剪、`--band-name` 命名）；`--docs` 导出领域文档视图 + DECISIONS.md 决议一行索引（v0.8.1；图为真相源，md 是视图） | `--mermaid -o <file>`；`--docs`（多图按图分树：ADR→docs/<图名>/adr/，context→docs/<图名>/CONTEXT-MAP.md + docs/<图名>/contexts/，可 `--adr-dir`/`--ctx-dir`） |
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
| `graph reclaim` | `graph rc` | `graph switch` | `graph sw` |
| `graph list` | `graph ls` | `graph rename-graph` | `graph rg` |
| `graph delete-graph` | `graph dg` | | |

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

### 接入配置（全局配一次，所有项目通用）

**推荐做法：全局安装 + 全局配置，不需要填任何路径/`--root`。**
服务会在每次工具调用时自动定位当前项目的图（解析链见下），换项目、开新会话都不用改配置。

```bash
npm install -g @lukawi/super-plumber
```

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

**通用 npx 形式**（免全局安装，任何支持 MCP 的客户端）：

```json
{
  "mcpServers": {
    "super-plumber": {
      "command": "npx",
      "args": ["-y", "-p", "@lukawi/super-plumber", "graph-mcp"]
    }
  }
}
```

> v0.4.1 起全局安装还会多注册一个与包名同名的 `super-plumber` 命令（同样启动 MCP server），
> npx 形式可简写为 `npx -y @lukawi/super-plumber`。

**图目录自动定位**（每次工具调用时求值，优先级从高到低）：

1. `--root <dir>` 启动参数 / `SUPER_PLUMBER_ROOT` 环境变量——**仅在**你想把服务固定到某个图时才需要；
2. **MCP workspace roots**：客户端通过 MCP 协议上报当前打开的项目根，取第一个含 `.graph/` 的；
3. 服务进程工作目录**向上逐级查找** `.graph/` 目录（agent 在项目子目录里也能命中）；
4. 以上都失败 → 报可读错误（"图目录未初始化…请 graph init 或 --root 指定"），**绝不静默返回空图**。

> 定位到工作区后，多图再按链解析当前图（v0.5.2）：`SUPER_PLUMBER_GRAPH` 环境变量 > 进程内 active（`graph_switch` 设置，仅 MCP）> `.graph/active` 工作区默认 > default 兜底；MCP 进程内用 `graph_switch` 切图，不改写工作区默认（CLI 数据命令另有最前置的 `--graph` 参数）。
>
> 单一固定图/测试场景才需要显式指定：`"command": "graph-mcp", "args": ["--root", "/path/to/graph"]`。

### 26 个工具

**调度**：`graph_get_next_actions` — 一次返回可认领（ready）/ **可转 ready（ready_eligible，门禁已满足的 pending/failed——冷启动入口）** / 等依赖（blocked，附未满足前驱）/ 执行中（running，附时长）/ 疑似卡住（stale_running），每桶分页（`limit` + `truncated`），条目可含 `adr_flags`（决策依据已过时 ⚠️），是 agent 规划循环的首选。

**多图（v0.5.2）**：`graph_switch`（进程内切换当前图：带名切换+摘要 / 无参查当前，重启回落工作区默认）、`graph_list_graphs`（列全部图含 is_current / 查单图详情）；**全部 26 个工具响应统一附 graph 名回显**；跨图智能纠错（当前图缺失的节点/边 id → 报错附『它存在于图 X，请先 graph_switch』，提示绝不代切）。

**读取**：`graph_get_node`（节点 + 合法转换 + checkpoint 聚合 + 门禁状态 + **governing_adrs 管辖 ADR 指针**，可附拓扑邻居）、`graph_get_graph`（默认 summary 紧凑模式，`mode=full` + `offset/limit` 分页）、`graph_traverse`（`max_nodes` 上限）、`graph_search`（`limit` 上限 + 紧凑结果，可按 `--type adr/context` 查知识顶点）。

**设计期写入**：`graph_create_node`（一次带 plan/DoD/checkpoints 完整压缩包，支持 `type=context/adr` 与 `context` 归属）、`graph_create_adr`（**v0.5**：自动编号 adr_NNNN + 落 proposed——提议/裁决分离，accept/supersede 归 Super Mario/人类）、`graph_batch_create`（批量 nodes+edges，先全量预校验报全部冲突）、`graph_add_edge`（含 `decides`/`relates` 知识边与 `contract`/`rel_kind`）、`graph_update_node`（含领域字段 `set_context`/`boundary`/`glossary_add`/`superseded_by`）、`graph_update_graph`（entry/exit/验收标准）、`graph_approve`（**v0.8.0**：设计审批凭据——review 字段 + design_approved 事件，仅记录零门禁；未审核图调度与 claim 附 review_flag 提示）、`graph_delete_node`（有引用边默认拒绝，`cascade` 连删；`reason` 写审计凭据，v0.8.1）、`graph_delete_edge`。

**执行期写入**：`graph_update_node_status`（`status=running` 传 `claim_by` 完成**原子认领**，并发只有第一个成功，**响应附 governing_adrs 指针**；**force 在 MCP 通道被协议级拒绝**——人类运维走 CLI `--force`，留 force_override 审计事件；ADR 三态机经此工具流转，superseded 两步法=先 `graph_update_node {superseded_by}` 再置状态）、`graph_update_checkpoint`（checkpoint 状态机 + 幂等）、`graph_update_execution_report`（交接单 + `verification` 裁决结论）、`graph_reclaim_node`（回收死认领：running → pending）。`graph_update_node` 的 attempts 重置必须显式 `reset_attempts: true`（改 plan 不再隐式重置，重置必留审计事件）。

**版本**：`graph_snapshot` / `graph_diff` / `graph_rollback`（必须 `confirm: true`；`design_only: true` 只回卷设计、保留执行进度）。

**自检与审计（v0.6.0）**：`graph_validate`（环/幽灵边/schema/六条领域规则/引用列表双向漂移汇总，ok/errors/warnings 结构化返回，批量创建与 crash recovery 后的自检手段）、`graph_events`（事件日志回溯，`node`/`kind` 过滤 + `last` 截尾，claim/force_override/attempts_reset 可追查）。

**可靠性设计**：所有参数经 zod schema 校验——缺参、非法枚举返回 `-32602` 协议错误；不存在的节点/边返回 `isError=true` 和可读的错误消息；非法状态转换/门禁/次数上限/passed 硬门禁明确报错。**工具永远不静默失败**。

---

## Web UI（星空观测台，Svelte 5 + D3.js）

```bash
graph serve
# 自动打开默认浏览器访问 http://localhost:8934；CI/无头环境用 `graph serve --no-open`
```

一片挂在开发者屏幕上的**星空**：每个任务是八向棱星，状态色贴芒呼吸，领域是星云，银河带横贯背景。chrome 是悬浮其上的磨砂仪器玻璃——这就是 v0.7.0 的「深空仪器舱」设计。

- **星空画布**：V4 八向棱星（白炽主芒 + 色差残像）+ 状态贴芒 halo + 闪烁相位按 id 哈希；`running` 节点呼吸 + 下游边琥珀能量流；边两端渐隐溶入星晕，契约边虚线区分；银河带与微尘是屏幕固定氛围层
- **map 透镜**：dock 勾选**工作流图 / 领域图**任意子集——叠加视图（星体 + 按上下文着色的星云 + 契约边虚线）、单独领域视图（星体 + 星云、无连线）；星云配色必配左下**簇色图例**
- **单排仪器条**：品牌 + 状态过滤（计数即图例，点击即过滤）+ 层级 + 搜索 + n/e 统计一条不叠栏；**计数所见即所计**（只数画布上真实存在的工作流星体与可渲染边）
- **浮动玻璃 dock**：图库（切图弹层）/ 决策文档（ADR 目录弹层：三态点色、superseded 划线 + 接替链）/ map 透镜 / 版本对比 / 缩放×3 / 固定布局 / 专注模式；Tab 在 dock 内循环
- **统一详情抽屉**：点星体/边/context 云心/ADR 目录项，右侧浮起同一玻璃抽屉——节点（计划/完成标准/检查点/执行报告，全 Markdown 渲染）、上下文（边界/术语表/成员，节点即文档）、决策文档（决策/背景/备选/理由/后果 + 管辖范围双向跳转 + 接替链）、边（语义/端点/契约）；**面板互斥**，Esc 逐层退出
- **版本对比**：dock 打开快照列表 → 选中即在画布上以形状编码新增/删除/修改（加粗实线/虚线/点划线，不劫持状态色）+ 顶部对比模式徽章 + 逐文件/逐状态差异明细
- **专注模式**：chrome 全部退场，纯黑星空 + running 呼吸 + 能量流——挂屏盯一下午的形态；右下角常驻退出钮（Esc 同效）
- **键盘完整可达**：星体/云心 Tab 分组循环（星体在星体间、云心在云心间、dock 在 dock 内）、Enter/Space 选中、Esc 按 面板→对比→专注→浮层 逐层退出、搜索 Enter 定位、`0` 适配全图；focus 焦点环全链路可见
- **所见即所计与纯只读**：状态七色是画布唯一彩色语义；UI 不发任何写命令（裁决走 CLI/MCP 人类通道）；WebSocket 增量推送 + 断线指数退避自动重连
- **无障碍**：正文对比度 ≥ AA、prefers-reduced-motion 全链路降级（呼吸/流点/入场动画全停）

---

## 存储结构（Git 友好，人类可读）

```text
.graph/                    # 工作区目录（graph init 生成，已在 .gitignore）
├── active                 # 工作区默认图名（graph switch 改写）
├── schema.yaml            # 人类可读的 schema 说明（运行时校验在 core/schema.ts）
├── workspace-events.jsonl # 工作区级审计（init/switch/migrate/rename/delete）
├── <图名>/                # 每图一个一级目录（v0.5.2；每图独立锁/索引/事件/快照）
│   ├── graph.yaml         # 图定义：入口/出口/根上下文 + 节点/边引用列表
│   ├── nodes/*.yaml       # 节点文件：plan / checkpoints / expected_outcome / execution_report
│   ├── edges/*.yaml       # 边文件：source / target / type / contract
│   ├── snapshots/<id>/    # 版本快照：manifest + 完整文件副本（graph snapshot）
│   ├── events.jsonl       # 图内 append-only 事件日志（graph events 读取；可 gitignore 亦可入库审计）
│   └── index/             # 派生索引（graph.json / meta.json / topology.dot，可删可重建）
└── .trash/                # delete-graph 软删除回收站（可手工救回）
```

> 旧仓库零迁移兼容：`.graph/graph.yaml` 直接在根的老布局原地识别为 `default` 图；建第二张图时在工作区级锁内一次性迁入 `.graph/default/`。

**设计理念：**

- **Git 是唯一真相源** —— 所有数据是文件，可 diff、可回滚、可 review
  > ⚠️ 若以 Git 为真相源（删除 `.graph/` 后可 `git clone` 恢复），**不要**把 `.graph/` 写进 `.gitignore`；本仓库忽略它只因开发期运行时图不入库
- **文件即节点** —— 一个节点一个 YAML，人类可以直接用编辑器修改
- **结构优先于文本** —— YAML schema 约束，拒绝自由 Markdown 的模糊性
- **纯文件系统** —— 无数据库；软删除保留 `.deleted.yaml` 历史

> 仓库里附带了示例拓扑 `.graph-example/`（20 节点 36 边 + `setup-topology.sh` 重建脚本），可以参考它的节点/边写法。

---

## Pi Agent 生态：subagent + skill

项目内置 2 个专用 subagent（`.pi/agents/`）与 4 个 skill（`.pi/skills/plumber-design/` + `.pi/skills/plumber-execute/` + `.pi/skills/plumber-join/` 冷启动加入协议（v0.8.2 起）+ `.pi/skills/sp-grilling/` 纪律技能，v0.8.0 起）：

| Agent | 角色 | 职责 |
|-------|------|------|
| `sp-designer` | 拓扑图设计师 | 把需求拆解为结构化拓扑，为每个节点制定 plan 和 definition_of_done |
| `super-mario` | 拓扑主控 | 节点生命周期裁决（checkpoint 聚合 + 输出抽查）、重试管理、状态监测 |

**两阶段 skill 协议**：`plumber-design` 负责**设计期**（需求拆解 → 拓扑图 → `graph validate` + 体检脚本验证无 bug → `graph serve` 打开浏览器预览 → 请求用户审核，审核是硬性 gate）；用户批准后 `plumber-execute` 负责**执行期**（claim → 逐 checkpoint 上报 → execution_report → passed，fan_out/fan_in 结构 + 条件判断决定何时派 subagent 并行，全部 task 节点 passed 后做三层验收：状态层全绿 + 结构层 validate 0 error + 成果层逐条对照 exit 验收标准与真实 artifact）。配套脚本：design 侧 `sp-check-design.mjs`（设计体检），execute 侧 6 个（read/status/claim/checkpoint/report/traverse），保证 agent 按协议操作拓扑图、不越权、不假报进度。

---

## 多工具接入（v0.6.1）

同一套工作流资产（角色提示词 / 阶段 skill / 执行脚本 / Operations 手册）提供两种接入形态，按你使用的 agent 工具任选：

| 接入路径 | 接入方法 |
|----------|----------|
| **pi**（仓库直用） | 仓库内直接使用根目录 `.pi/`；带到其他项目：把 `.pi/` 整个目录拷贝到项目根 |
| **Claude Code**（插件 `super-plumber`） | `/plugin marketplace add lukawi/super-plumber` 添加市场，然后安装 `super-plumber`；本地路径预览在仓库根执行 `claude plugin marketplace add ./` |
| **ZCode**（同一插件） | 设置 → 插件管理 → 发现 → 添加市场源 `lukawi/super-plumber`（或本地目录），然后安装 `super-plumber` |

> Claude Code 与 ZCode 安装的是**同一个插件包**（`integrations/plugin/`，以 `.claude-plugin` 清单承载；zcode 经 `.claude-plugin` 兼容回退装载，agents 走包内约定目录自动发现）——一次封装，两工具通用。

装好后你会得到：

- **4 个斜杠命令**：`/plumber-design`——设计期编排（需求拆解 → 拓扑建图 → validate/doctor 双绿 → 浏览器预览 → 请求用户审核）；`/plumber-execute`——执行期编排（claim → 逐 checkpoint 上报 → 交接单 → 三层验收）；`/plumber-join`（v0.8.2）——冷启动加入（新会话/单体 agent 零前文自主入场：list/switch → status → next → claim → 干活到 passed → 回队列）；`/plumber-class`（v0.9.1）——档位凭据（用户直发设定/变更工作类 quick|standard|program，agent 代发必带 `--by user` 落 class_changed 审计血统）。pi 无斜杠命令，由 `.pi/skills/` 的 skill 直接驱动同一流程。另含纪律技能 `sp-grilling`（v0.8.0）：model-invoked、无命令，按触发语自动进入（grill/拷问/对齐/深挖）。
- **2 个 subagent**：`sp-designer`（拓扑设计师）与 `super-mario`（裁决主控），由 skill 按派单模板调度；检测不到 subagent 时走 skill 内 solo 分支。
- **Operations 手册**：操作语法唯一正本。pi 侧读仓库根 `integrations/shared/manual.md`，插件用户读插件包内 `manual.md`（构建期同步的正本拷贝）；提示词/skill 写「Read 手册 §N」时按此寻址（约定见手册 §11）。

### solo 模式（单人单会话，无独立裁决方）

主线程原地扮演设计与执行角色时，裁决边界有成文规则（手册 §10）：**机械核算可自裁**——checkpoint 聚合、artifact 存在性、状态层/结构层验收，读数说话，核对后在 notes 留证据；**裁量与裁决必须留人**——DoD 主观质量、ADR accept/supersede、用户审核 gate、force 类动作，停下列单呈报，不得代签。

### npm 兜底（访问不了市场源时）

npm 包随包分发集成资产（`package.json` 的 `files` 含 `integrations/` 与 `.pi/`）。安装后从 `node_modules/@lukawi/super-plumber/` 把 `integrations/plugin/` 拷出（Claude Code / ZCode 指向该目录安装即可），或把 `.pi/` 拷到项目根——无需访问 GitHub。

### ZCode 免装插件路径

亦可不装插件，仅把 agents 定义 md 复制到 `~/.zcode/agents/`（用户级），即被 ZCode 发现。若放在项目级 `<repo>/.zcode/agents/`：frontmatter 的 `permissionMode` 会被强制剥离（权限字段仅用户级定义生效），且保留名 `general-purpose`、`Explore` 不可占用。

---

## 开发与测试

```bash
# 从源码构建
git clone https://github.com/LUKAWI/super-plumber
cd super-plumber
npm install
npm run build && npm --prefix web-ui run build

# 测试（后端 534 例 + 前端 68 例：状态机/拓扑/CLI/MCP 协议/多图迁移与性能/并发加固/转义/渲染冒烟）
npm test

# 本地链接全局（开发调试用）
npm link
graph --version
```

---

## 发版清单（Release Checklist）

每次发版按序过一遍（IL-016 教训：版本面只改 package.json 一处、漏同步 manifest 会被审出）：

1. **版本面同步**：把 version 逐个改齐、一处不漏——`package.json`、`.claude-plugin/marketplace.json`（`plugins[].version`）、`integrations/plugin/.claude-plugin/plugin.json`（0.9.5 起再加 `.codex-plugin/plugin.json` 与 `.agents/plugins/marketplace.json`）；
2. 跑 `node scripts/sync-integrations.mjs --check`：版本面一致性断言 + 共享件 sha256 断言必须全绿（exit 0）——它也是 `prepublishOnly` 的第一道门禁，版本面漏改会在这里被拦下；
3. 更新 `CHANGELOG.md`：新增版本条目（含「发布动作」行）；
4. `npm test && npm run build && npm --prefix web-ui run build`（`prepublishOnly` 发布时还会自动再跑一遍）；
5. `npm publish` + 打 GitHub tag。

---

## 常见问题（FAQ）

| 问题 | 原因与解决 |
|------|-----------|
| `❌ 未找到图（.../.graph 无 graph.yaml），请先运行 graph init <内容名>` | 当前目录还没有图。先 `graph init <内容名>`，或 `cd` 到图所在目录 |
| MCP 报"图目录未初始化：定位到 X，但 .graph/ 下没有任何图" | MCP server 没定位到你的项目：确认项目里跑过 `graph init <内容名>`；客户端支持 workspace roots 时会自动跟随项目，否则在该项目目录重启客户端（server 以项目为 cwd 拉起），或设 `SUPER_PLUMBER_ROOT` |
| **升级包之后 MCP 工具表现还是旧版本**（如对 context/adr 顶点报 schema 错误） | 已连接的 MCP server 进程内存里还是旧代码。**重启 MCP server**（重连客户端或 `npm i -g @lukawi/super-plumber` 后重启客户端）即可加载新构建——升级不会热替换已运行的进程 |
| `❌ 端口 8934 已被占用` | 已有 serve 在跑。`graph serve -p 8935` 换端口 |
| `❌ Node x already exists` / `Edge x already exists` | id 重复。工具拒绝覆盖，换一个新 id |
| `❌ Invalid transition: ...` | 跳过了状态机允许的路径。按 `Allowed: [...]` 提示走合法转换 |
| `❌ MCP error -32602: ...` | 调用 MCP 工具缺参数或传了非法枚举，按提示补参数/改枚举 |
| `❌ 节点不存在: x` | 该节点不存在（可能是软删除或 id 写错），用 `graph status` / `graph_search` 确认 |
| `❌ Node x 前置未满足，不能进入 ready/running` | ready 门禁拦截（前驱未全部 passed）。先完成前驱，**不要用 --force**（仅人类运维） |
| `❌ force 仅人类运维通道（CLI…），MCP 拒绝执行` | 设计如此：agent 无法越权。人类运维请走 CLI `graph update-status --force`（写 force_override 审计事件） |
| `❌ Node x already claimed by y` | 并发认领竞争失败（原子保护）。换一个 ready 节点 |
| `❌ Node x 已达最大重试次数` | attempts 用尽。人工介入，或 `graph update-node --reset-attempts` 显式归零（写审计事件；改 plan 不再自动重置） |
| `❌ Node x 无执行报告，不能标记 passed` | passed 硬门禁：先填交接单（MCP `graph_update_execution_report` 或 skill 脚本 `sp-report.mjs`，summary 非空）；checkpoint 未聚合或 failed 裁决也会被拒 |
| `❌ Node x 被 N 条边引用` | 删除会留悬挂引用。`--cascade` 或先 `delete-edge` |
| `❌ 节点长时间 running 无进展` | 死认领：`graph reclaim -i <id>` 收回 pending 重新调度（执行 agent 已崩溃时） |
| `❌ schema 校验失败: ...` | 手改 YAML 拼错字段。`graph validate` 逐文件定位修正 |
| 改完代码全局命令没变化 | 全局是发布包的快照。`npm version patch && npm publish && npm i -g @lukawi/super-plumber` |
| `graph serve` 后页面是空图 | 检查 cwd 是否是图所在目录；空图时 UI 会显示空状态引导 |
| UI 断线不更新 | v0.2 起自动重连（指数退避 + HTTP 兜底）；如服务已退出请重新 `graph serve` |

---

## 项目状态

```text
Tests: 764（后端）+ 109（前端）✅ | CLI: 29 命令 | MCP: 26 工具 | 斜杠命令: 4 | 状态机: 7 态 + ready 门禁 + max_attempts + passed 硬门禁 + 事件日志审计 + ADR 三态机（知识顶点豁免）+ 设计审批凭据（v0.8.0）+ 删除拒绝理由凭据与 DECISIONS.md 决议索引（v0.8.1）+ 人机分工进调度：requires_human 派生/等真人标记/human stale 4h + 档位凭据 /plumber-class 与 class_changed 事件（v0.9.1） | 边类型: 9 种 | 版本控制: snapshot/diff/rollback（含 design-only）| Web UI: Svelte 5 + D3.js 星空观测台（v0.7.0 深空仪器舱 + v0.8.1 前沿一键视图/分期图例/Avoid 呈现）
```

- **npm**: [@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber)
- **GitHub**: [LUKAWI/super-plumber](https://github.com/LUKAWI/super-plumber)
- **架构决策**: `docs/<图名>/adr/`（按图分树；早期已废弃决策归档于 `docs/adr/.retired/`：拓扑排序忽略运行时边 / 纯文件存储）
- **领域术语**: `CONTEXT.md`

## License

MIT © 2026 Super Plumber contributors
