# 0006 — 改图协议 amend：三级分流 + 三条轻机器约束，不新增 skill（DEC-7）

执行中更改已画拓扑按风险三级分流，不新增第 9 个 skill：小修（plan/DoD 文案、checkpoint 增删）在 plumber-execute「发现图错的上报出口」节内完成并报告注明；结构修订（增删节点/边、雾区毕业、拆分节点、取消子树、ADR supersede 连锁）走 designer amend 模式（增量 validate + 影响评估 + 增量人审 + 自动快照）；failed 裁决触发路由回 designer。配套三条轻机器约束（F21，DEC-1 nudge 哲学，不加拒绝规则）：结构修订落图前自动 snapshot；graph_amended 事件 + review 回置（review_flag 重新亮起）；改 passed/blocked 节点 plan 响应提示「计划已变更，是否重开/重验」。

**Status：** accepted

**Context：** 工具面齐全但改图「无声」——执行者发现图错无上报出口、结构修订无影响评估与凭据、改 passed 节点 plan 静默通过致报告失配；与 0.9.0 雾区毕业同机制。

**Considered Options：** 新增 plumber-amend skill（被入口动词判据否决）；维持现状谁想改谁直接调工具（否）；本方案（采纳）。

**Why：** 改图两形态分属 execute/designer 职责延伸，复用优于新设；三条约束全为凭据/nudge 类。

**Consequences：** execute/designer 各加一节/一附件主文档零增长；F21 双通道小改；0.8.2 落地实践，本 ADR 于 0.8.2 实践检验后裁决（v082-adr 节点 accept）。

> 本文由 `graph export` 从图顶点 adr_0006 生成；改图不改文，重新导出即覆盖。
