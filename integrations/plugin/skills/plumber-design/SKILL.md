---
name: plumber-design
description: Use when 接到新需求/任务需要拆解成任务拓扑图、设计或修改 .graph/ 拓扑（节点/边/entry/exit）、验证拓扑设计质量、需要 graph serve 打开浏览器预览拓扑并请求用户审核。Also use when asked to 拆解需求、设计任务拓扑、把需求变成拓扑图、任务分解、sp-designer 设计阶段、graph 预览审核。Do NOT use for 执行已审核通过的拓扑（用 plumber-execute）或纯 todo 列表（图不是附属品）。多工具通用（pi/claude/zcode）；无 subagent 时可 solo。
---

# Plumber Design — 主线程编排剧本：需求 → 拓扑图 → 预览审核

## Overview

- **产出物 = 用户审核通过的拓扑图**（v0.5 起含领域结构：bounded context 与 ADR 是图中一等公民），不是执行结果。
- 本页是**编排剧本**：建图与验证的操作语法在 Operations 手册，设计判断力（九边选型、领域建模方法、ADR 甄别）在 sp-designer agent，此处只管阶段推进与硬 gate；细则按需读 `attachments/`（与本文件同目录，两渠道同构可解析）：workflow-classes / review-brief / disciplines-map / wayfinder-mode / amend-mode。

**审核是硬性 gate**：用户批准之前绝不进入执行阶段；审核通过后切换 `plumber-execute`。

**代理层级边界**：skill 文本和“有 subagent 工具”都不能可靠识别代理深度，故每个会话默认**无派单权**，不得从能力存在推断授权。只有直接承接用户需求的外层协调者可持一次性、不可转授的 `orchestrator` 授权直接派 `sp-designer`；授权在派发时耗尽，子任务只收到 `leaf` 约束，绝不可向下复制。缺授权一律走 solo。当前通用宿主未向 skill 暴露可验证的签名层级令牌，因此这是行为协议而非硬隔离：需要强保证的宿主还必须在工具层移除子 agent 的派发能力。

## When to Use / 衔接关系（subagent 与 skill 已解耦）

- Use：接到新需求需拆解为 3–20 个有依赖关系的任务；设计或修改 `.graph/` 拓扑（entry/exit、节点、边）；验证拓扑质量；serve 预览并请求用户审核；审核后提修改意见 → 回本 skill（改图 → 重验 → 重预览 → 再审）。Do NOT：执行已审核通过的拓扑（用 plumber-execute）；纯 todo 列表。
- 设计专业协议的唯一载体是角色提示词：本插件包内 `./agents/sp-designer.md`（pi 渠道为 `.pi/agents/sp-designer.md`；建图序列纪律、九边选型判断力、领域建模细则、ADR 三判据、节点三要素）——本 skill 引用它，绝不复述。
- 外层协调者持未使用的 `orchestrator` 授权且需要专职设计 → 按「派单模板」直接派一个叶子 `sp-designer`；未持授权或检测不到可用 subagent → 走「solo 分支」主线程扮演。被派会话一律不得再派。
- 用户审核通过 → 进入 `plumber-execute`（建议用户明确说"开始执行"）；节点状态裁决 / checkpoint 聚合 / 重试管理 → `super-mario` agent。

## 流程（Phase 0 定档 + 5 步，严格按序，绝不跳步）

### Phase 0 — 路由决策表（两问定档，先于 Step 1；DEC-2）

对需求问两问：**① 有雾吗**（存在说不出精确问题的未知区）？**② 一个会话装得下吗**？——**quick**（无雾+装得下：单节点图，entry/exit 各一句话，跳过 serve 人审与 doctor、只跑 `graph validate`，执行协议减为 claim→report→passed，init 后 `graph approve --by <agent 名> --status self` 自签）/ **standard**（无雾+装不下：Step 1–5 一项不减）/ **program**（有雾/跨会话/跨图：切 chart 模式）。三级路由细则与档位凭据纪律（adr_0016）→ `attachments/workflow-classes.md`；定档拿不准时升档执行（存疑按 standard 走），定档后冒出雾 → 回本节重定档。

### Step 1 — 理解需求

向用户确认：目标是什么？交付物是什么？边界（不做什么）？**有歧义就问，不要猜**——需求不清，图必错。

### Step 2 — 派发设计（先 entry/exit 后 L1-Ln 是铁律）

- 两条铁律写进派单：**entry 和 exit 永远第一个定义**（先图级字段后 L1-Ln 分层动脉）；需求跨多个关注点 → **领域建模与 ADR 甄别是 designer 必做项**（bounded context 划界/术语表/跨 context 契约边、够三判据的 ADR），点名不可裁剪。节点类型×默认纪律与 plan 纪律指针写法（WF07）→ `attachments/disciplines-map.md`。
- 建图必须走完整 designer 协议并通过体检，协议细节与命令语法以 designer 提示词 + 手册 §2 为准。**置层准则（IL-001）**：level 表达少数有意义的分层带（与分期/领域结构对齐），**不把依赖深度编码进 level**，层数建议 ≤5、避免单节点层；designer 出图前先声明置层方案（分几带、每带含义），声明与图不符按设计缺陷返工——细则 → 手册 §2.9。
- **查历史拒绝理由（WF05，出图/改图前必做）**：看软删归档（`ls .graph/*/nodes/*.deleted*.yaml`，读 `deleted_reason` 等顶层键）→ `graph events -k node_deleted --json` 补全旧档理由 → 待建/待改节点命中已删方案时，设计报告逐一回应删除理由（换道，或给出理由已失效的依据），无回应 = 重蹈已否决方案，按设计缺陷返工。有 subagent 时主线程先筛、命中结果随派单交付 designer；solo 分支动笔前自跑。
- **有未使用的 `orchestrator` 授权且需要专职设计**：按「派单模板」直接派出一个叶子 sp-designer，等待其交付 `.graph/` 与设计报告；**无授权、无 subagent 或当前已经被派** → 走「solo 分支」。

### Step 3 — 双关卡验证门禁

`graph validate`（结构关）+ doctor 体检脚本（质量关）**双 0 error 才允许进入预览**；warning 是可修的，看懂并修掉再走，不允许带 error 进预览。体检判据明细（E1-E10/W1-W6）、命令参数与失败修法 → 手册 §2.6。

### Step 4 — serve 预览，贯穿全程不关闭（quick 档不进 serve，见 Phase 0）

`graph serve` 启动后**保持运行**：watcher 实时推送改动，用户提意见 → 你改图 → 浏览器自动刷新，所见即所得。**不要关闭 serve**——它贯穿整个 workflow 直到用户明确说全部结束；已在运行不重复启动、先确认端口（端口参数 → 手册 §2.7）。

### Step 5 — 请求用户审核（硬性 gate）

- 开场告知"拓扑图已在浏览器打开（端口 X），可以开始审核"；此后人审对话**接 sp-grilling 质检**（quiz 三问、三透镜审阅、approve 凭据与分层批准、旅程告知 WF10 等对话细则 → `attachments/review-brief.md`）；事实自查（读图、validate 结果自己查），决策归用户。
- 用户**否决/提意见** → 回 Step 2 修改 → Step 3 重验 → 浏览器刷新后再次请求审核；用户**批准** → designer 调一次 `graph approve --by <审核者>` 落审批凭据（DEC-1：凭据只记录、不替代审核对话），随后才可进入 `plumber-execute`（建议用户明确说"开始执行"触发）。
- **绝不**在未获批准时 claim 节点或改动节点状态；**绝不**自行调用 plumber-execute 开始执行任何节点——**设计完成 ≠ 可以执行**。

## chart the graph 模式（program 档：绘图会话只画图不解题）

骨架照画（entry/exit、已知节点与边、领域结构），说不出精确问题的未知区登记为**雾区**，把「想清楚」本身拆成 research 型票交 work 会话解——雾区登记语法、点火不建边、一次会话一张票、收尾交棒全程细则 → `attachments/wayfinder-mode.md`（chart/work 两模式）。

## 派单模板（给 sp-designer subagent 的标准提示词骨架）

1. **任务目标一句话**：把"<需求>"设计成可执行的 `.graph/` 任务拓扑图，含领域结构（bounded context 与 ADR）。
2. **显式文件边界**：只允许读写 `<仓库根>/.graph/` 下经 graph CLI/MCP 维护的图文件；禁止改动源代码、`.pi/agents/`、`.pi/skills/`、`integrations/`、`docs/` 及一切未列举路径。
3. 首行固定指引：`Read ./manual.md §2、§6`（claude/zcode 插件包环境按手册 §11 寻址约定改为包根相对路径）。
4. **信息优先级声明**：任务派单 ＞ 角色提示词（sp-designer.md）/ 手册 ＞ skill 正文；冲突时上位胜出。
5. **叶子约束**：你是被直接派出的设计工人；本任务不携带 `orchestrator` 授权，不得使用任何 subagent/delegation 工具，也不得把设计任务继续转派；在本会话交付完整设计报告。
6. **产物交付要求**：交付物 = `<仓库根>/.graph/` 中可通过 validate 的图，附设计报告（L1 清单、context 与 ADR 计数、体检结果）；报告只作陈述，图本身是真相源。
7. **派发前合规自查（五条缺一不派发，C1 防线）**：① 存在本轮用户请求授予且尚未使用的 `orchestrator` 授权；② 任务目标含领域结构要求（对应第 1 条）；③ 首行含 Read 手册 §2、§6 指引（对应第 3 条，路径按渠道寻址约定）；④ 含信息优先级声明（对应第 4 条）；⑤ 含叶子约束（对应第 5 条）。授权不可复制进子任务；任一缺失即派单不合规，补齐后才允许派发。

## solo 分支（检测不到可用 subagent 时）

主线程 `Read ./agents/sp-designer.md`（pi 渠道读 `.pi/agents/sp-designer.md`）**原地扮演设计师**走完全程（从需求分析到设计报告，等用户 serve 审核的环节不变，必做项不减配）。收尾裁定权按手册切分：**机械核对项**（validate/doctor 0 error、三要素计数、可达性读数）按手册 §10.1 自裁并在 notes 留证据；**主观项**（DoD 质量裁量、ADR accept/supersede、用户审核 gate）按手册 §10.2 汇总成清单呈人拍板——自批即违规。
