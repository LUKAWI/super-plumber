# 0008 — 单真相源重组：正本唯一化 integrations/src/，双视图变构建产物（0.9.4）

skill/agent/命令/手册/脚本正本收拢 integrations/src/ 一处；.pi/ 与 integrations/plugin/ 全部变 gen 构建产物，gen+比对入 CI，prepublishOnly 门禁改为生成完整性检查；sp-*.mjs 七脚本收敛 sp.mjs 薄封装（语义 ≡ CLI）；subagent 定义瘦身、SKILL.md 主文档 <100 行 + attachments/ 七件分层；纪律族与 commands 扩张只发生在 gen 新结构上。

**Status：** accepted

**Context：** 0.6.1 重构保证「几份一致」但不解决「为什么有几份」；三语义面改一处记三处；B1 实证 SKILL 双副本静默漂移。

**Considered Options：** 维持多正本+sha256 同步（漂移面恒在，否）；只收拢 skill 不动脚本（不彻底，否）；本方案一次落地（采纳）。

**Why：** 漂移面归零是上下文经济（Q4/Q7）与 B1 根治的唯一彻底解；发布链风险以「0.9.4 单独 minor 不夹带语义变更、gen 后跑现有 e2e、先稳定迁移清单」隔离。

**Consequences：** 旧 sha256 同步断言退役换新检查；sp.mjs 零依赖保 pi 场景；B1 根治落点。

> 本文由 `graph export` 从图顶点 adr_0008 生成；改图不改文，重新导出即覆盖。
