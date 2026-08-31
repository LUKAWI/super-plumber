# 0005 — skills 入口策略修订 + 纪律技能族自建（DEC-6）

① join 独立成 skill：新增 plumber-join（0.8.2），职责单一——把任意新会话/单体 agent 变成自给自足的工人（零前文入场 + 认领循环）；plumber-execute 收窄为“单节点工作协议”（被 join 引用，或被编排方直接指派时使用）。② skills 生长判据：一个用户/agent 可见的入口动词 = 一个 skill（design / execute / join / …）；入口数量由“何时需要点名它”决定，不由内容量决定——DEC-4 的“加深不加入口”于 0.8.0 期限内有效，0.8.2 起按本判据生长；skill 内 attachments 分层与正文节俭原则继续有效。command 同判据且更严：只有入口/编排类发命令（design / execute / join / plumber，终态 4 个），纪律族 model-invoked 一律不发——触达靠触发语自动命中与 plan 指针，零认知负载；“总被手动点名”的纪律技能可经一次 DEC 评审升级出命令（防膨胀的阀门与升级通道并存）。③ 去外部依赖定位修正：SP 吸收的是 MP 的风格（小、单职责、触发语、反模式清单、阶段边界、frontier、完成判据），纪律技能自建为 SP 插件自带的 skill 族（SP 版 tdd / code-review / grilling-lite / diagnosing / prototype…，适配图工作流）；节点 plan 的纪律指针只指向 SP 自带技能，条件式（存在才建议）——不依赖、不指向 MP 的安装。④ sp-executor 定义（S09）引用 plumber-join。

**Status：** accepted

**Context：** ① 用户指出计划书“与 MP skills 库的配合方式”一节把“借鉴风格”误写成了“共生依赖”（plan 指针指向 MP 的 tdd、统一入口把用户引向 MP 技能）——这正是要求重构 skills 系统的动机：SP 的 skills 层必须自足；② join 功能需要新增 skill，触发 DEC-4 入口策略重估（“加深不加入口”与“join 为 execute 一节”均需修订）。

**Considered Options：** ① join 塞进 execute（DEC-5 原案）——execute 承担两个入口职责（被指派的节点工人 vs 自主入场循环），违反单职责（否）；② 纪律互通 = 指向外部技能（原 WF07 案）——风格借鉴变成生态绑定，未装 MP 的用户拿到残缺体验（否）；③ 纪律族一次建齐——工作量爆炸、违反小步（否，分期）；④ 本方案：join 独立 + 入口动词判据 + 纪律族分期自建（采纳）。

**Why：** 单职责小 skill 正是 MP 风格的核心（可组合、各治一事、可被路由）；“借鉴”应落在文风与机制层（触发语/frontier/反模式/完成判据/阶段边界），而非运行时依赖；自建纪律 skills 是提示词层资产，不触碰轮子边界（核心仍不依赖 LLM API、不做验证 agent 工具）。

**Consequences：** ① 0.8.2 起 plugin skills 2→3（design/execute/join），plugin.json 注册面变大，S01 单真相源 gen 必须先行（0.9.4）；② WF07 重定义：映射表 + 指针只指 SP 自带技能，纪律族分批到位期间指针条件式降级；③ 纪律族分期：0.9.4 起步 tdd + code-review（高杠杆，直接服务节点执行与三层验收），1.0.0 + grilling-lite（服务统一入口“不画图直接干”路由），1.0.x + diagnosing/prototype；④ subagent 数量评估结论：只 +1（sp-executor）——设计/执行/裁决三角已覆盖，再拆即角色爆炸；⑤ 主文档 <100 行与 attachments 分层继续有效；⑥ command 与 skills 两条曲线解耦：plugin.json skills 注册面 2→8，commands 2→4（design/execute/join/plumber）——skills 扩张是“模型可达面”，commands 克制是“人要背的面”；⑦ 分序判据：0.8.x 工作流/skills 层先行（路由/quiz/join 零工具依赖）→ 0.9.0-0.9.3 MCP/CLI 能力先行、同版本内工作流话术立即跟上 → 0.9.4 承载结构重组收尾 → 纪律族与 commands 扩张只发生在 gen 新结构上（不往旧结构堆债）。

> 本文由 `graph export` 从图顶点 adr_0005 生成；改图不改文，重新导出即覆盖。
