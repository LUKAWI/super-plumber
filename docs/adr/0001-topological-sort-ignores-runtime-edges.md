# 0001 — 拓扑排序忽略运行时边（fallback/iterates）

拓扑排序和循环检测仅对 `depends_on` 和 `validates` 边类型执行；`fallback`、`iterates` 和 `shares_context` 等边被视为运行时控制流，不参与静态排序。

**Context：** 图中存在多种边类型，其中 `fallback`（回退上游）和 `iterates`（双向迭代）天然构成反向或循环引用。如果所有边参与拓扑排序，任何含循环边的图都无法通过 DAG 检测，但实际上这些循环是可接受的运行时控制流——`fallback` 表示"失败了回到上游重试"，`iterates` 表示"反复优化直到满意"，并非静态死锁。

**Considered Options：**（1）所有边参与排序 → 复杂图永远有环，不可用；（2）忽略运行时边 ← 选中的方案；（3）按 `level` 字段 BFS 分层替代全局拓扑排序 → 丢失了 `depends_on` 的有序性。

**Consequences：** runtime 边仍存储在 `edges/*.yaml` 中，执行层（后续的 Mario agent 或执行引擎）需要自行理解这些边的语义。工具提供 `graph sort --strict` 选项在需要时覆盖此行为。
