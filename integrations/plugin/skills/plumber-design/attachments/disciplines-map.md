<!-- 附件（0.9.4 S02 分层，adr_0008）：节点类型×默认纪律速查。唯一正本 integrations/src/skills/plumber-design/attachments/；
     .pi 与插件包内同名文件是 gen 产物，手改会被 scripts/sync-integrations.mjs --check 拦截。
     寻址：与 plumber-design/SKILL.md 同目录 attachments/（两渠道同构，相对本文件可解析）。 -->

# Disciplines Map — 节点类型 × 默认纪律（WF07 速查）

何时读：建节点选 type、给节点配 checkpoints/verifier、在节点 plan 里写纪律指针时。状态机与调度语义以手册 §4/§5 为准，本页是与手册 §2.11 对齐的速查——**冲突时以手册 §2.11 为准**（人机介入细分口径见手册 §2.12 正交决策表）。

## 类型速查（与手册 §2.11 表对齐）

| 类型 | 一句话纪律 | verifier 惯例 |
|------|-----------|---------------|
| task | 三要素齐（E4）；完成判定按 task 节点计数 | 常态 `auto`（机械核验，手册 §10.1 自裁项）；含主观裁量的环节落 `human`（§10.2 留人清单）；交叉评审环节用 `cross_review` |
| checkpoint | 阶段验收/检查位：DoD 写通过判据 | 按判据性质在 auto / cross_review / human 三值中选 |
| decision | 流程中途显式决策位：plan 写决策问题与备选，结论落 DoD 可核对项；够 ADR 三判据的方案取舍走 ADR（手册 §2.4），不在 decision 位重复造裁决 | — |
| gate | 硬放行点：DoD = 放行判据；未过即门禁拦下游 | 用户审核类 `human`（批准是人给的）；机械放行判据 `auto` |
| context | 节点即文档：boundary + glossary（含 Avoid 尾注）+ contracts；不配 checkpoints/DoD，状态变更一律拒绝 | —（无状态知识顶点） |
| adr | 六字段；decides 边挂管辖对象防孤儿；accept/supersede 归裁决方（§10.2） | —（proposed → accepted → superseded） |

## 纪律技能族（DEC-6，adr_0005）在册清单

0.9.4 起步两件（随节点实战）：

- **plumber-tdd** — 节点内的测试先行：先约定 seam、三大反模式安检（实现耦合/同义反复/水平切片）、垂直切片红绿循环。
- **plumber-review** — 节点产物的双轴交叉复核：规格轴 + 惯例轴并行（或隔离两遍）跑，结论不合并、分开呈现，裁决归裁决方。

**sp-grilling** 已独立提供需求对齐与设计调整，仅用户主动调用，不纳入执行软路由。后续探索为 diagnosing / prototype；WF07 节点指针用于 plumber-tdd / plumber-review，不自动触发 grilling。

## plan 纪律指针惯例（WF07，条件式）

节点 plan 引用纪律技能的写法是**条件式建议**：「若本环境存在 plumber-tdd 技能，按其约定执行本节点」。两条约束：

1. **只指 SP 自带技能**（DEC-6：借鉴风格、不做外部运行时依赖，绝不指向外部技能库）；
2. **存在才建议、缺失静默降级**——指针命中不了时执行者直接按 plan/DoD 干活，不另找替代、不阻塞、不报错。
