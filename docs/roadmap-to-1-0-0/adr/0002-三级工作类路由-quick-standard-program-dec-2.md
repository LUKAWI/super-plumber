# 0002 — 三级工作类路由：quick / standard / program（DEC-2）

plumber-design 的 Phase 0 增加路由决策表，两问定档：① 有雾吗（存在说不出精确问题的未知区）？② 一个会话装得下吗？→ quick（无雾 + 装得下）：单节点图——entry=任务一句话、exit=验收一句话；跳过 serve 人审与 doctor 质检，只跑 graph validate；执行协议减为 claim → report → passed，checkpoint 可选；init 时自动自签审批。standard（无雾 + 装不下）：现状全流程。program（有雾 / 跨会话 / 跨图）：现状 + 雾区渐进出图 + 渐进审批（可选，见 §4）。graph.yaml 可选 class 字段让 execute 阶段识别协议档位。

**Status：** accepted

**Context：** 一刀切粒度缺陷：固定仪式（init → entry/exit → designer → validate/doctor → serve 人审 → 执行协议 → 三层验收）成本是常数，与任务大小无关——五分钟的修复也走全套，仪式开销反过来惩罚小任务。节点 level（L1/L2/L3）只是图内粒度，不是工作流粒度。mattpocock 侧的对照：无雾则不需要地图（wayfinder）、小活 grill + implement 直接干。

**Considered Options：** ① 三级路由（采纳）；② 二分支（Matt 式：装得下直接干 / 装不下画图）——丢失 standard 档，标准任务也被迫在“不画图”与“全套流程”间二选一；③ 图外 quick 模式（临时图用完即弃/不落 .graph）——破坏“一切都是图、Git 是唯一真相源”的产品不变量，放弃。

**Why：** “建图资格检验”（评估报告 6-01）的二分支推广为三分支后，每个任务落在成本匹配的档位；实现几乎纯 skill 层（serve 人审与协议细节本就在 skill 文本中），工具侧改动仅一个可选字段。

**Consequences：** ① designer skill 的 Phase 0 增加 ~10 行路由表（skill 正文唯一一处有意的常驻增长，因为它改变流程走向而非复述工具行为）；② quick 类的存在是对“所有活都该画图”的自觉纠正，也是对“重框架”批评的最好回应；③ program 档的雾区渐进（评估报告 R1 完整版）与渐进审批是否进 0.8.0 见 §4。

> 本文由 `graph export` 从图顶点 adr_0002 生成；改图不改文，重新导出即覆盖。
