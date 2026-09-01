---
name: plumber-execute
description: Use when 拓扑图已设计并审核通过、需要执行 .graph/ 中的节点任务（claim/checkpoint/execution_report/passed）、按依赖顺序跑完整个拓扑、需要决定何时派 subagent 并行执行节点、验证所有节点 passed 与构建成果完整。Also use when asked to 执行拓扑图、跑图、执行任务拓扑、完成任务中的节点、super-mario 执行阶段、节点状态流转。Do NOT use for 设计/预览/审核拓扑（用 plumber-design）或纯 todo 列表。多工具通用（pi/claude/zcode）；无 subagent 时可 solo。
---

# Plumber Execute — 主线程编排剧本：拓扑执行 → 全部 passed → 三层验收

## Overview

按依赖顺序执行每个节点：**CLAIM → WORK → 逐 checkpoint 上报 → execution_report → passed**；全部 passed 后做**三层验收**，验证构建成果真实完整。本页是编排剧本：每步只留一句纪律，全部调用语法、字段含义与报错修法统一看 Operations 手册（寻址约定见手册 §11）。

**产出物 = 全部节点 passed 且验收通过的构建成果**，不是设计。图还没设计/未审核 → 回 `plumber-design`。

---

## When to Use

- 拓扑图已设计并审核通过，开始执行节点任务
- 需要 claim 节点 / 上报 checkpoint / 提交 execution_report / 状态流转
- 需要判断这批节点串行还是派 subagent 并行
- 需要验证全部节点 passed、构建成果完整；节点 failed → 走重试链重新调度

## 衔接关系（subagent 与 skill 已解耦，不再是 REQUIRED SUB-SKILL）

- 执行协议的工具调用语法与并行数据判读法 → 手册 §4；状态机七态与三条硬规则 → 手册 §5——本 skill 只留骨架与纪律，绝不复述语法。
- 图未设计或未审核通过 → `plumber-design`。
- 派 executor subagent → 按「派单模板」；检测不到可用 subagent → 走「solo 分支」。
- 节点状态裁决 / checkpoint 聚合 / 输出抽查 → `super-mario` agent。

---

## 执行协议（每节点 0–5 步，严格按序；各步调用语法统一 → 手册 §4.1）

0. **PLAN** — 每轮决策前先看 `graph_get_next_actions` 五桶；**冷启动第一步从 ready_eligible 拿入口节点**（门禁已满足的 pending/failed 转 ready 即执行），不要拿 get_graph+search 手工拼数据。
1. **CLAIM** — **只 claim ready 节点**（eligible 先 `{status:"ready"}` 再 claim），必带 `claim_by`，拿到 already claimed 就换节点别重试同节点；claim 响应附 `governing_adrs` **必读**——**adr_flags ⚠️ 出现即停**：该节点依据的 ADR 已被接替，先弄清新决策再动手，ADR 状态只能由裁决方（super-mario/人类）改。
2. **WORK** — 执行 `plan.description`，把 checkpoints 当逐条清单完成。
3. **REPORT AS YOU GO** — 每完成一个 checkpoint **立即上报**，绝不攒批——完成的未上报 = 丢失的进度。
4. **HAND OFF** — 干完立刻填 execution_report：artifacts 只写**真实文件路径**（会被存在性核验），绝不编造路径。
5. **passed** — 核心层硬门禁一句话：非空 report + checkpoint 全 passed/skipped + 无 failed 裁决，缺一即拒——铁律**先 verdict 后 passed**。

> 重试链 / attempts 上限 / blocked 解除 / reclaim 细节 → 手册 §4.3 与 §5。

---

## 发现图错的上报出口（改图三级分流）

执行中发现图有问题，按风险三级分流——改自己节点的内容与动图结构，边界要清楚：

1. **小修**（不动结构：本节点 plan/DoD 文案勘误、checkpoint 增删）→ 执行会话内直接修订，并在执行报告注明**「计划已修订」**与改动点。
2. **结构修订**（增删节点/边、雾区毕业、拆分节点、取消子树、ADR supersede 连锁失效）→ **绝不自己动手**：在执行报告写明发现的图错与证据，路由回 `plumber-design` 的 amend 模式处理。
3. **裁决触发**（failed 裁决揭示设计缺陷）→ 同样路由回 `plumber-design`，不由执行侧自行改图补救。

判据一句话：文案级改动自己改完注明即可；凡触及拓扑形状或他人节点，一律上报 designer，修订后按新 plan 重新进入执行。

---

## 上下文卫生（一节点一会话，checkpoint 为收口点）

执行会话的工作内存是易耗品：混装多个节点的 plan/报告/报错会让执行者串线，压缩后的残缺记忆会让人假装在续做。四条卫生纪律：

1. **一节点一会话为默认**：一个执行会话只装载一个节点的上下文；研究/原型类与显式并行为例外。subagent 派单天然如此；solo 分支串行切换节点时同样遵守——A 节点 report→passed 落定后再装载 B 的 plan，不把 A 的执行残迹带进 B 的会话。
2. **checkpoint=阶段边界**：compact、交接、长输出落盘对齐 checkpoint 边界进行，不在 checkpoint 中途做。每报完一个 checkpoint 就是天然收口点；中途交接只会把半截状态留给接手方。
3. **compact 失败模式**：压缩发生后必须重读节点全文（`graph_get_node` 取 plan/DoD/checkpoints）再继续，不凭会话记忆续做。compact 后会话里『节点长这样』的记忆多半已被摘要污染——DoD 漏项、checkpoint 漏报多源于此，重读一次是最便宜的纠偏。
4. **stale 是心跳不是事故**：running 超阈值先视为『可能在干活』，确认执行者不可达后才 reclaim，绝不顺手 cancel。长 checkpoint 本就可能超默认 30 分钟阈值；处置顺序见下文『stale 死认领回收』。

---

## 并行决策（两步走，两条都过才并行）

### 第一步 · 看拓扑结构（数据怎么读 → 手册 §4.2）

- ready 列表直接可认领；blocked 带未满足前驱清单，补齐后自然放行。
- **fan_out 批**（同一上游发散的无依赖节点）= 天然并行候选。
- **fan_in 汇聚点**必须等**全部**上游 passed 且报告齐备才能动工（门禁会拦截提前 claim）。
- 主链（depends_on/validates 串行段）无并行空间，逐个来。

### 第二步 · 叠加条件（全部满足才派 subagent）

| 条件 | 判据 |
|------|------|
| ≥2 个 `ready` 节点 | 且相互之间**无依赖边**（含 fan_out 批、shares_context 组） |
| 工作量值得 | 每个节点够一个 subagent 干；小而快的自己串行干 |
| 不共享冲突上下文 | 不同时编辑同一文件/占用同一端口（共享只读输入 OK，共享写目标是冲突） |
| 并行数 ≤ 3 | 多于 3 个分批，主 agent 验收不过来 |

任一不满足 → 串行（自己 claim→work→report 逐个走）。

### 并行实现方式

每个 subagent **独立 CLAIM 自己的节点**（claim_by 各不相同）、各自 checkpoint/report；主 agent 在**汇合点**统一 verify 后才放行下游。subagent 类型读 `{{executor-agent-types}}` 占位符就地取值——**pi 语境 = hephaestus / sisyphus-junior / explore**（claude/zcode 插件包组装时各自本地化），按节点性质选。

### stale 死认领回收（绝不 cancel）

`stale_running` 出现不要干等：

1. 确认该节点长时无 checkpoint 更新（默认阈值 30 分钟）且执行 agent 已不可达；
2. `graph_reclaim_node {id, by:"<你的agent名>"}` 收回 pending——attempts 不变、清空 assigned_to、notes 附回收记录；
3. 节点重回调度池，可被任何 agent 重新认领。

**绝不直接 cancel 一个可以回收的节点**——cancelled 会阻塞其所有下游汇合点。

---

## 结束验收（三层，全过才报告完成）

1. **状态层**：所有 task 节点 passed，无 failed/blocked/pending 残留；
2. **结构层**：`graph validate` 0 error（执行期可能动过图，收尾必重验）；
3. **成果层**：exit 的 acceptance_criteria 逐条对照真实 artifact——**不信报告信 artifact**（报告里写了 ≠ 文件真实存在）。

任何一层不过 → 继续修，不宣告完成。逐层命令手法与通过标准 → 手册 §8。

---

## 派单模板（给 executor subagent 的标准提示词骨架）

1. **任务目标一句话**：认领并完成 `<node_id>`（plan.description 要旨），一路 REPORT 到 passed。
2. **显式文件边界**：只允许读写本节点 plan 列出的产出路径，以及经 graph CLI/MCP 维护的 `.graph/`；**不得 claim 或触碰他人已认领节点**（assigned_to 不是你的节点一律绕行）；**汇合点必须等齐 fan_in 上游全部 passed** 才能动工，等不齐就停下如实上报，不得 cancel 上游抢跑。
3. 首行固定指引：`Read ./manual.md §4、§6`（claude/zcode 插件包环境按手册 §11 寻址约定改为包根相对路径）。
4. **信息优先级声明**：任务派单 ＞ 角色提示词 / 手册 ＞ skill 正文；冲突时上位胜出。
5. **产物交付要求**：artifacts 写明真实输出文件路径，summary 说清做了什么，blockers 如实填。

## solo 分支（检测不到可用 subagent 时）

主线程无人可派时自行逐节点推进：对每个节点亲自走满 0–5 步协议（以 PLAN 桶序为优先级逐一处理）。收尾验收时裁定权按手册切分：**机械核对项**（checkpoint_aggregate 计数、artifact 存在性核验、状态层/结构层读数）按手册 §10.1 自裁并在 notes 留证据；**主观项**（DoD 质量裁量、任何 ADR accept/supersede、max_attempts 耗尽后的处置）按手册 §10.2 汇总成清单呈人拍板，不得代签。

---

## 纪律红线（每个都真实发生过，不重犯）

| 红线 | 正确姿势 |
|------|---------|
| checkpoint 攒到结尾批量报 | 报一个过一个，进度不丢 |
| 先标 passed、报告后补 | passed 硬门禁当场拒，先 report 再流转 |
| 传 force 绕门禁/次数上限 | MCP 协议级拒绝——agent 没有 force 后门 |
| 明明可并行却串行（或反之） | 并行决策两步走：结构 + 条件 |
| fan_in 汇聚点不等齐上游 | 等全部上游 passed + 报告齐备 |
| stale 节点直接 cancel | 走 reclaim 回收（cancel 会毒死下游汇合点） |
| 只跑 validate 就宣告完成 | 三层验收，成果层查真实 artifact |

工具类报错（Invalid transition / 前置未满足 / already claimed / pending→running 一步到位 / attempts 用尽 / 参数枚举错的含义与修法）→ 手册 §9 大表。"CLI 就够了"是错觉——checkpoint/report 只有 MCP 与脚本通道，CLI 无子命令（手册 §6.1/§7）。**绝不忽略错误继续假装成功**。
