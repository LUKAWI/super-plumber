# 0016 — 档位凭据命令 /plumber-class：用户直发 class + class_changed 凭据 + 方向性请示纪律

新增单命令 /plumber-class quick|standard|program（claude/zcode 斜杠命令，pi 侧以对话约定同款效力），用户调用即 class 凭据落 graph.yaml（持久化复用 0.9.0 class 字段，零新 schema）；update_graph 变更 class 时追加 class_changed 审计事件（from/to/by，provenance 由事件推导，不加字段）；agent 自主升降档须用户批准、降档向（→quick）从严，毕业附带的 to-standard 交棒沿用毕业时增量人审不重复请示；用户未设档维持现状（designer Phase 0 判档自设）。

**Status：** accepted

**Context：** 0.9.0 class 字段落地后为纯标注：agent 判档无凭据血统（缝隙①），雾/档矛盾提示无法区分用户明知故选与 agent 误判，class 变更（如 to-standard 交棒）在审计日志中无声。用户 2026-09-02 评估 /class-quick|standard|program 三命令提案后拍板收敛为单命令形态。

**Considered Options：** 三命令 /class-quick|standard|program：同一动词三入口，超 S07 commands 终态 4 预算、违 DEC-6 入口动词判据（否）；强版参数传递：命令行为按 class 门禁分叉，违零硬门禁红线且 0.9.2 F08 前无消费方（否）；本方案：单命令 + 事件凭据 + 方向性纪律（采纳）。

**Why：** 用户直发凭据高于 agent 猜测（与 approve 同血统）；provenance 让矛盾 nudge 只纠 agent 误判、不骚扰用户明知的选择；单命令保住命令面预算；行为零门禁（DEC-1/DEC-3 红线不破）。

**Consequences：** class 从纯标注升级为带血统凭据；节点 v091-class-command（0.9.1）实现命令三通道/事件/矛盾提示 nudge；F08（0.9.2 仅 program）到站时获得体面的用户入口；pi 通道以对话约定形态成文。

> 本文由 `graph export` 从图顶点 adr_0016 生成；改图不改文，重新导出即覆盖。
