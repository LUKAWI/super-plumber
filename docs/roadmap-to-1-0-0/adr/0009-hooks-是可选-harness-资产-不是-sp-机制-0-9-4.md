# 0009 — hooks 是可选 harness 资产，不是 SP 机制（0.9.4）

hooks 只作为插件分发可选资产——git-guardrails（危险 git 命令拦截）+ session-brief（会话开始注入一行图状态，数据源 F18 status --oneline），全部默认关闭、README 写明取舍；核心层不加 hook 事件总线。

**Status：** proposed（待裁决）

**Context：** 纯文件存储仓库对 git 护栏价值极高，但 DEC-3 判据下核心已有强制力的不需 hook 重复、nudge 已内嵌工具响应。

**Considered Options：** 核心加事件总线（重框架化，否）；不做 hooks（放弃高价值护栏，否）；本方案（采纳）。

**Why：** 「用户选择的额外护栏」与「SP 的新机制」必须可区分——默认关闭+文档定位就是防重框架化的机制设计。

**Consequences：** 零默认行为变化；本 ADR 于 0.9.4 实践后裁决（v094-gov accept）。

> 本文由 `graph export` 从图顶点 adr_0009 生成；改图不改文，重新导出即覆盖。
