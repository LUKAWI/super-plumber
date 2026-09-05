<!-- 附件（0.9.4 S02 分层，adr_0008）：chart/work 两模式细则。唯一正本 integrations/src/skills/plumber-design/attachments/；
     .pi 与插件包内同名文件是 gen 产物，手改会被 scripts/sync-integrations.mjs --check 拦截。
     寻址：与 plumber-design/SKILL.md 同目录 attachments/（两渠道同构，相对本文件可解析；
     跨 skill 引用以 skills/ 层为基准，pi 与插件包两渠道同构可解析）。 -->

# Wayfinder Mode — chart / work 两模式（program 档分工会话）

何时读：Phase 0 定档 program（关键未知阻止形成可信交付计划）之后。已有 fog 的图先按 `workflow-classes.md` 核对未知对计划的影响；不能仅凭 fog 字段存在自动定档。chart 会话只画图不解题，work 会话逐票解雾——两模式共用一张图，靠雾区与 research 票分工。

## chart the graph（design 会话：绘图会话只画图不解题）

Phase 0 定档 program → plumber-design 切 chart 模式：说得清的骨架照画（entry/exit、已知节点与边、领域结构），阻止形成可信交付计划的关键未知登记为**雾区**，把「想清楚」本身拆成 research 型票交给 work 会话——本会话不解题、不冒充精确。

1. **登记雾区**（图级字段，单一真相源；不做雾节点载体）：CLI `graph update-graph --set-fog '{"id":"ra","description":"哪里模糊","graduation":"怎样算想清楚","ignited":["r1"]}' --class program`；MCP `graph_update_graph` 同名字段（`fog:{id,description,graduation,ignited?}` 整体 upsert；`class` 标 quick|standard|program）。`description` 同时说明未知及其影响的后续决定，`graduation` 写可验证的解决证据；参数全集 → 手册 §2.2。
2. **点火 research 票，绝不建边**：research 票 = 普通 task + plan 自述调研目标；fan_out 点火关系由雾侧 `ignited` 字段（或票 plan 自述）承载，**绝不建 depends_on 边**——雾不是票、无状态机，fog→票 边会把票永久锁死在 ready 门禁外（试跑实证死锁，不存在合法边能表达点火）。
3. **一次会话一张票**：research/原型节点按单票范式登记——一票 = 一个会话装得下的调研量；chart 端按此拆票，work 端按此解题（拆票与产出物范式 → `../../plumber-execute/attachments/prototype-research.md`）。
4. **收尾照旧**：validate 照跑（图有雾只提示不阻止，F17）、serve 人审照走；审核对象为当前阶段的研究计划、毕业条件及已明确部分；人审通过后交棒 `plumber-execute` 的 work 模式逐票解雾，雾毕业前图不宣告「精确」。

## work the graph（execute 会话：工作会话解雾）

图已定 program，且关键未知仍阻止形成可信交付计划 → plumber-execute 切 work 模式：不跑整图，按「取前沿 → 解一张 → 毕业雾 → 决议回写 → 交棒」循环——解票是为了把雾想清楚，不是为了清桶赶进度。

1. **取前沿**：`graph_get_next_actions` 五桶（CLI `graph next`）里挑一张 research 票（雾 `ignited` 点过火、或 plan 自述调研目标）；票照常 claim——票与雾之间**没有边**，点火关系在雾字段与 plan 文字里，不在拓扑上。
2. **解一张**：一次会话只解一张票，走满 0–5 步协议（claim→report 全循环）；调研产物落真实 artifact，结论写进执行报告（范式 → `../../plumber-execute/attachments/prototype-research.md`）。
3. **毕业雾**：核对实际研究证据，确认毕业条件达成；研究票全部 passed 不等于未知已解决。条件达成 → CLI `graph graduate-fog --produced <票id,票id> --reason "<结论摘要>"`；MCP `graph_graduate_fog {produced, reason}`。毕业 = 清除 fog + fog_graduated 事件，无雾时报错（毕业是事实陈述，不是清理操作）。**毕业属结构修订，按 amend 协议执行**（→ `amend-mode.md` 与手册 §2.2；命令自带守卫：自动快照、graph_amended 事件、review 回置 unreviewed）。
4. **决议回写**：结论够 ADR 三判据 → `graph adr create`（MCP `graph_create_adr`）落 proposed，accept/supersede 归裁决方（super-mario/人）；术语沉淀进所属 context 顶点 glossary。
5. **to-standard 交棒**：关键未知已解决、目标/范围/验收明确、主要任务与关键依赖可列出，可信交付计划经增量人审后 → `graph update-graph --class standard`，图回常规档；不能仅因研究票全部 passed 或 fog 清空而转档。若证据揭示新的关键未知，登记雾区并审核下一阶段研究计划，继续 program；其余节点回归 plumber-execute 标准执行协议（0–5 步 + 三层验收）。

**档位例外**：第 5 步毕业附带的 to-standard 交棒沿用毕业时对可信交付计划的增量人审，不重复请示（升降档总则与凭据纪律 → `workflow-classes.md`）。
