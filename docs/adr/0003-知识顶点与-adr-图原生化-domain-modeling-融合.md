# 0003 — 知识顶点与 ADR 图原生化（domain-modeling 融合）

bounded context（含术语表，节点即文档）与 ADR 成为图中一等公民（知识顶点）：与工作流顶点同图共存、map 透镜分镜呈现、decides/relates 知识边挂接、变更沿拓扑传播（adr_flags/governing_adrs）；图 YAML 是唯一真相源，docs/adr 与 CONTEXT-MAP/CONTEXT.md 是可重生成视图。

**Status：** accepted

**Context：** domain-modeling skill 的约定（CONTEXT.md/docs/adr）只活在仓库纪律层，工具无法消费：决策变更不能沿拓扑传播、术语不能被调度注入。纯文件 ADR 无法回答哪些任务受它管辖。

**Considered Options：** 引用锚（ADR 留在 md、节点加 adrs 引用字段）→引用校验新代码路径且无传播能力; 混合骨架节点→双真相源; 一等顶点+导出视图←选中

**Why：** agent 的全部操作面是节点工具——一等顶点让 agent 零新 API 即可提议/追溯 ADR；图能给而文件给不了的唯一东西是变更沿拓扑传播；CRUD/事件/锁/快照全部白拿现成机制。

**Consequences：** 知识顶点需要调度豁免与独立状态机（adr 三态/context 无状态）；关联边必须有运行时语义（防装饰边回潮）；Web UI 需要 map 过滤架构。

> 本文由 `graph export` 从图顶点 adr_0003 生成；改图不改文，重新导出即覆盖。
