---
name: plumber-review
description: Use when 要交叉复核一个节点的产物（执行者以外的第二双眼）、三层验收成果层要抽查某个 passed 节点、checkpoint 标了 cross_review 要做交叉评审、对节点 artifact 做双轴 review（规格轴 + 惯例轴）。Also use when asked to 复核这个节点、交叉复核、交叉评审、双轴复核、review 这个 artifact。Do NOT use for 图级 serve 人审与决策拷问（用 sp-grilling）、设计新图（用 plumber-design）、节点日常执行与编排（用 plumber-execute）。纪律族技能：model-invoked 自动触发，不发 command（DEC-6）。多工具通用（pi/claude/zcode）。
---

# Plumber Review — 纪律技能：节点产物的双轴交叉复核

## Overview

- **定位**：SP 自带纪律技能族成员（DEC-6，adr_0005）——服务**图中节点**的交叉复核手法，主要供三层验收成果层与 `cross_review` checkpoint 使用：对（通常已 passed 的）节点 artifact 做第二双眼复核。无节点归属的全库审计/自由 code review 不适用本页（防蔓延：纪律技能只服务图中节点）。
- 纪律族不发 command（DEC-6 ②）：触达靠触发语自动命中与节点 plan 指针，无斜杠命令、无入口编排。
- **交叉 = 复核者不是执行者**：同一会话给刚写完的东西盖章不算交叉。复核者是编排方指派的另一 agent/会话。
- **本 skill 零派单权**：`plumber-review` 只定义复核方法，绝不创建、委派或要求 subagent。它无法可靠判定当前会话在代理树中的层级，因此所有调用一律按**叶子复核会话**处理；独立复核的派发只能由本 skill 外持一次性、不可转授 `orchestrator` 授权的用户侧协调者直接完成，且该权限不可经本 skill 推断或继承。该协议消除 review 自身的递归触发；若宿主没有在工具层限制子会话派发，则无法把文档约束伪称为硬安全边界。
- **复核与裁决必须分离**：reviewer 只做双轴取证，**绝不**更新 checkpoint、`verification.verdict` 或节点状态；独立的 Super Mario / 指定裁决者读完 reviewer 的证据后，才可裁决。纯读报告之后若没有独立裁决，就仍是未完成的审核链路。
- 铁律（手册 §8 成果层）：**不信报告信 artifact**——直接读文件核实；execution_report 的 summary 只是线索，不是证据。

## 双轴（并行跑，互不污染）

| 轴 | 输入 | 只回答一个问题 |
|----|------|---------------|
| **规格轴（Spec）** | `graph_get_node` 的 plan + DoD 全文 | 产物是否忠实落实了节点书？逐条 DoD 找可核验佐证；找缺失/走样、**计划外夹带**（干了 plan 没让干的）、看似做了但实现可疑的点 |
| **惯例轴（Standards）** | 节点文件边界、仓库成文纪律（CONTEXT.md 术语、手册红线如「产物禁止手改」「先 verdict 后 passed」、测试基建既有约定） | 产物是否遵守了仓库的成文纪律？违反处引用纪律原文 + 产物位置 |

**并行是外层编排，不是本 skill 的动作**：需要两名独立复核者时，由用户侧协调者/编排器**直接**派两个叶子会话，一人只获派规格轴、一人只获派惯例轴；派单必须明写「叶子复核者：不得调用任何 subagent/delegation 工具」。每个叶子只读取这份 skill 并完成自己的一轴，因此不会再派生下一层。`plumber-review` 自身不因环境存在 subagent 而派人。

**solo / 单轴派单**：没有外层独立派发时，严格在本会话隔离两遍——先只备惯例轴输入跑完并写下结论，再开规格轴跑第二遍，绝不带着一轴的结论看另一轴；若外层明确只派一轴，则只完成该轴。两轴输入都在开工前各自备齐，中途互不互通。**不得为了并行而再派 agent。**

## 结论不合并

两轴结论**分开呈现**：`## 规格轴`、`## 惯例轴` 各列各的发现（每条带引用：DoD/纪律原文 + artifact 文件与引文），末行各给**本轴**最重问题。**不跨轴合并、不再排序、不产出单一总裁决**——一轴全绿另一轴有雷是完全可能的结果，分开报告才不让一轴掩盖另一轴。裁决（放行/打回/改 plan）归裁决方，不归本页。

## 复核者红线

- **不动图状态**：reviewer 不得更新 checkpoint、execution report、`verification.verdict` 或节点状态，也不得代签；绝不触碰执行者已认领的源任务节点、其 checkpoint 或设计字段。发现缺陷或全部通过，都交给独立裁决者。
- **叶子不嵌套**：任何复核会话都不得创建、委派、唤醒或要求另一个 agent 继续复核；只读 artifact、完成获派的一轴并把证据返还上层。需要第二轴时由本 skill 外的协调者直接安排，不能经由复核者转手。
- **检查点归属**：`cross_review` checkpoint 的 passed/failed 由独立裁决者依据 reviewer 报告上报；若源任务需要独立审核状态，由协调者建立 review 节点或提供报告 artifact，不能让 reviewer 越权修改源任务。
- 发现本身要过安检：每条发现给出可复现的核实手法，不凭报告文本断言。
- 修复若涉及新测试/缺陷修复，修复者可参照测试先行纪律——若本环境存在 plumber-tdd 技能，按其约定执行；缺失则静默降级。

## 交接给独立裁决者

完成双轴后，reviewer 交出两段分离的证据，不能自行把审核链路收口：

1. 分别交付 `## 规格轴` 和 `## 惯例轴`，每项都带 DoD/纪律原文、artifact 路径和可复现手法；结论不合并。
2. 明确标记 `awaiting_adjudication`，指出应由谁裁决、哪个 review/checkpoint 节点待处理，以及是否发现 blocker。
3. 由与 reviewer、源任务执行者均不同的 Super Mario / 指定裁决者读取节点全文、双轴报告和 artifact 后，上报对应 checkpoint，写 execution report 与 `verification.verdict`，再按手册 §4.1 / §5.2 流转 `passed` 或 `failed`。**先 verdict 后状态流转**，不得代签。

## 指针惯例（DEC-6）

节点 plan 引用纪律技能的写法是**条件式建议**：「若本环境存在 plumber-review 技能，按其约定执行」。全纪律族同规：**只指 SP 自带技能**（借鉴风格、不做外部运行时依赖，绝不指向外部技能库）；**存在才建议、缺失静默降级**——指针命中不了时按 plan/DoD 与手册 §8 三层验收手法直接干，不另找替代、不阻塞、不报错。本页同理：是复核手法的参照，不是验收的先决条件。

三层验收逐层手法与命令语法 → `Read integrations/shared/manual.md §8、§6、§9`（claude/zcode 插件包环境按手册 §11 寻址约定改为包根相对路径）。
