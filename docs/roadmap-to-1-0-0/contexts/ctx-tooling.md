# 工具与协议层（MCP/CLI/core）（ctx-tooling）

负责 super-plumber 的机器面：core 引擎（src/core/）、CLI 命令（src/cli/）、MCP 工具（src/mcp/）及其测试——图 schema、审计事件、调度桶、状态机、文案 lint 的实现与端到端验收。不负责流程话术与 skill 文案（归 ctx-skills-plugin，经其 skill/manual 节点产出衔接）、不负责版本发布与 ADR 治理（归 ctx-release-ops，经契约边衔接）。

## 术语表

- **审批凭据（review receipt）**: 图级 review 字段 + design_approved 事件，记录“该图的设计经谁在何时审核通过”；仅记录，不强制。
- **提示旗标（review flag）**: 调度与认领响应中对未审核图的 one-line 提示，机制同 adr_flags。
- **双通道（dual channel）**: 双通道是同一面向 agent 的能力在 MCP 工具与 CLI 命令两层同步交付的交付纪律（如 graph_approve 与 graph approve 同批落地）；不是两层各自演化的重复实现，缺任一通道须写明理由。
- **nudge**: nudge 是工具在决定时刻（调度桶条目、claim 响应等）注入的一行级提示，机制同 adr_flags——提醒纪律而不拦截动作；不是状态机拒绝规则，也不在 skill 正文复述（no-op 原则）。
- **雾区（fog）**: graph 级可选字段（id/描述/毕业条件），承载「说不出精确问题的未知区」，毕业即雾转节点；validate 只提示不阻止。
- **渐进审批**: approve --level 按层分批准入，仅 program 类可选；只改 approve 粒度，不加拒绝规则。
- **requires_human**: 从 checkpoint verifier:human 派生的读面标注（不加 schema 字段），让调度五桶可见「含真人环节」。
- **跨图聚合（next --all）**: 多图工作区的只读前沿聚合，带图名标签，不引入跨图写耦合。
- **图体检（survey）**: 多图工作区巡检（长期 blocked/stale 频发/ADR 冲突计划），报告落临时目录，挑选产生新 entry。
- **模板库（init --template）**: 垂直切片/expand–contract/研究-决策-构建/加固四型预设。
- **单行状态（status --oneline）**: 一行图状态摘要，hooks 与旅程提示的数据源。
- **纸面边**: fallback/iterates 这类当前无运行时语义的文档性标注；0.9.3 决定最小语义或降级出枚举。

> 本文由 `graph export` 从 context 顶点 ctx-tooling 生成（节点即文档，图是真相源）。
