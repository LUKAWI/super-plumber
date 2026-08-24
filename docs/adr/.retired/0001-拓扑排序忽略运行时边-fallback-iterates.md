# 0001 — 拓扑排序忽略运行时边（fallback/iterates）

拓扑排序和循环检测仅对 depends_on 和 validates 边类型执行；fallback、iterates 和 shares_context 等边被视为运行时控制流，不参与静态排序。

**Status：** accepted

**Context：** 图中存在多种边类型，其中 fallback（回退上游）和 iterates（双向迭代）天然构成反向或循环引用。如果所有边参与拓扑排序，任何含循环边的图都无法通过 DAG 检测，但实际上这些循环是可接受的运行时控制流，并非静态死锁。

**Considered Options：** 所有边参与排序→复杂图永远有环，不可用; 忽略运行时边←选中; 按 level 字段 BFS 分层替代全局拓扑排序→丢失 depends_on 的有序性

**Consequences：** runtime 边仍存储在 edges/*.yaml 中，执行层需自行理解其语义；validate 的拓扑排序与循环检测均只作用于 depends_on/validates（悬挂边自动忽略）；graph sort --strict 未实现，如未来需要可经 validate 扩展

> 本文由 `graph export` 从图顶点 adr_0001 生成；改图不改文，重新导出即覆盖。
