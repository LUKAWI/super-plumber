# 0017 — fallback 最小读语义 + iterates 维持文档性标注（F09 纸面边清偿）

fallback 边获得最小运行时读语义：调度面（graph next / graph_get_next_actions）对「failed 且重试预算耗尽（max_attempts>0 且 attempts≥max_attempts）」的死节点条目就地标注 attempts_exhausted，并沿出向 fallback 边就地列出替代路线（fallback_routes，条件缺省，仅在有边时出现）；零新增拒绝规则、不进 GATE_EDGE_TYPES、不进拓扑排序。iterates 维持文档性标注：其名义语义（重试/迭代）已被内建 attempts 重试链覆盖，无独立最小语义可做；validate 的 per-edge「无运行时语义」警告收窄为 iterates 单型。降级出枚举案否决。

**Status：** accepted

**Context：** roadmap F09（0.9.3 段）：fallback/iterates 自引入起是文档性标注（validate 自警告，设计文档 P2-15），§4 待拍板 3 明示两案皆自洽、需按 DEC-3（adr_0003）判据拍板。事实面：schema 的 EDGE_TYPES 直接派生自 EdgeType 枚举（降级出枚举 = 存量图 fallback 边全部变 schema 错误）；死节点判定已有机器口径（failed 且 max_attempts>0 且 attempts≥max_attempts，state-machine 在 failed→pending 重试处拦截）；v0.8.0 设计文档明文引用 fallback/iterates 的「先留标注、后升语义」为审批凭据升级通道的哲学先例。

**Considered Options：** ① fallback 最小读语义（采纳）：死节点条目就地标注 attempts_exhausted + fallback_routes，与 adr_flags/review_flag/requires_human 的 nudge 家族同构，零新拒绝规则；② 降级出枚举（否决）：破坏存量图、拆掉 v0.8.0 引用过的升级通道先例、设计者表达意图的信息损失真实；③ iterates 同做最小语义（否决）：与内建 attempts 重试链重复，强做即重复机制；④ iterates 一并降级（否决）：同②破坏性问题且标注仍有表达价值。

**Why：** DEC-3 判据 (b)：fallback 缺位的伤害集中在「节点已死接下来怎么办」这一时刻——设计者写 fallback 边表达替代意图，但调度面看不到，编排 agent 只能全图扫边自找；工具在关键时刻亮出已有数据即可，无需任何强制，DEC-1 红线（零新拒绝规则）天然满足。降级出枚举则同时踩破坏性变更与拆升级先例两条红线。ADR 三判据全中：难逆转（双向）、脱离上下文令人费解（为何同类边一个有读面一个没有）、真实权衡（token 面 vs 信息保留 vs 兼容性）。

**Consequences：** next 响应形状新增条件缺省字段（CLI/MCP 双通道一致，渠道只渲染）；validate 警告口径收窄（fallback 不再警告，iterates 保留）；MCP 工具描述与 init 模板注释同步改口径；manual/README 文档面随 v093-release 传导；存量图完全向后兼容（纯增量读面）。

> 本文由 `graph export` 从图顶点 adr_0017 生成；改图不改文，重新导出即覆盖。
