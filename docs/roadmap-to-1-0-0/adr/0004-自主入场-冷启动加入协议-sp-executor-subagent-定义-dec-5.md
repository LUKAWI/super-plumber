# 0004 — 自主入场：冷启动加入协议 + sp-executor subagent 定义（DEC-5）

两件配套资产，把“认领方法”从主 agent 的 prompt 转述固化为自举资产：① 冷启动加入协议（join protocol，WF15/S10）：新增独立 skill plumber-join（0.8.2；原计划为 plumber-execute 的一节，经 DEC-6 按入口动词判据独立成口），开宗明义面向“被派来执行的新会话/单体 agent，不假设任何前文”，固定序列 graph list/switch → status → next（前沿五桶按 priority 挑）→ claim_by=<自己>（响应附 governing_adrs 必读、adr_flags ⚠️ 即停）→ 按节点协议干活 → checkpoint/report → verdict → passed；写明多会话并行是预期场景（原子认领互斥、stale 是心跳不是事故）。② sp-executor subagent 定义（S09）：角色边界 + “先调 plumber-join 冷启动协议，自主认领直到无前沿”，协议单真相源仍在 skill，定义不内嵌全文。hooks 不承载流程——仅 SessionStart 注入一行状态（F18 session-brief，已在计划）。

**Status：** accepted

**Context：** 2026-08-29 side 讨论确认：SP 状态层已支持跨会话认领（原子 claim_by、图级锁、reclaim 均强于 MP 的 assign 约定），缺的是知识自举——认领流程靠主 agent 在 prompt 里转述；executor 角色无 subagent 定义（designer/mario 有）；plumber-execute 假设从 designer 续接、无冷启动节；脚本路径是隐性知识。平行开多会话时新会话无法自主入场。对照：wayfinder 用“skill 即规范 + tracker 即协调者”实现任何会话零提示入场（认领 = 对共享工件的第一次写入），SP 状态机更强但入场程序缺失。

**Considered Options：** ① 现状：主 agent 每次 prompt 转述认领方法——知识不沉淀、逐次漂移（否）；② hook 注入流程——按 DEC-3 流程归 skills，hook 注入的内容缺“为什么”的上下文（否，仅保留 session-brief 一行状态）；③ 重量级 executor 定义（协议全文内嵌）——双份真相、漂移面 +1（否）；④ 本方案：冷启动协议进 skill + 轻量 executor 定义引用之（采纳）。

**Why：** DEC-3 判据：认领流程是纯流程编排 → 归 skills（pull 模型，规范随入口自带；MP 实践证明 pull 比 push 可靠）；机器侧约束（必须 ready、必须 claim_by、原子性）核心状态机已强制，无需新增。分两期：协议是纯文档、零新工具依赖（graph list/status/next/claim 现有工具已够），可立即解除多会话自主执行的痛点（0.8.2）；executor 定义触及 DEC-4 入口冻结（0.8.0 期限）且与 0.9.4 subagent 定义批次同做最省（0.9.4）。

**Consequences：** ① 多会话/多机并行执行成为一等场景，SP 原子 claim 强于 MP assign 的优势被用满；② DEC-4 的入口冻结出现首个例外（0.9.4 +1 subagent 定义）——把每次 prompt 转述固化为资产是认知负载的净削减；③ 冷启动协议与 journey prompts（WF10）互补：一个管会话入场、一个管阶段出场；④ 协议引用 review_flag（0.8.0 实现后语义完整）与 F18 oneline（0.9.4，加速器非依赖）。

> 本文由 `graph export` 从图顶点 adr_0004 生成；改图不改文，重新导出即覆盖。
