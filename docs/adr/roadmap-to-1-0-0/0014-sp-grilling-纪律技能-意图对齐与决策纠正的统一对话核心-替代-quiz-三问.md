# 0014 — sp-grilling 纪律技能：意图对齐与决策纠正的统一对话核心（替代 quiz 三问）

新增 SP 自带纪律技能 sp-grilling（0.8.0，model-invoked 无命令）：① 本体移植 mattpocock grilling 面试协议全文（一次一问、每问附推荐答案、事实自查环境/决策归人、共识达成前不动手）为 SP 插件自带资产（.pi/skills/sp-grilling/ + integrations/plugin/ 双副本，不指向外部安装）；② 增 SP 落点附录——访谈结论四路落图：工作类定档 → plumber-design Phase 0 路由表（DEC-2）；设计决策 → graph adr create；改决定（ADR/任务节点/图结构）→ DEC-7 改图协议路由（小修归 execute 上报出口 WF16、结构修订归 designer amend）；审批对话 → approve 凭据话术（DEC-1）；③ plumber-design 的 quiz 三问（评估报告 6-02 固定三问）退役，serve 人审改为对「已画好的图」跑 sp-grilling——三问内容降级为结构决策分支的检查面，不再固定成问卷； ④ sp-grilling 服务全程：开发前需求/方向对齐、开发中决策（是否做 X）、改决定对话、最终成品审核，强度随工作类分档（quick 轻量档）。

**Status：** accepted

**Context：** 用户 2026-08-30 提议：quiz 三问是固定问卷，覆盖不了工作流全程的对齐需求（开发前对齐/开发中决定/改 ADR/改节点/成品审核），应设专门 grilling 技能作为整个工作流的驱动核心与纠正器。MP grilling 本体仅 5 行协议（一次一问、每问附推荐答案、事实自查环境/决策归人、共识达成前不动手）、经实战检验；MP 的 grill-with-docs 已证明「grilling + ADR/术语表落地」组合可行。原计划 grilling-lite 在 1.0.0（adr_0005 分期、v100-disciplines），本决策将核心提前至 0.8.0 并升格为全程对话面。

**Considered Options：** A. 维持 quiz 三问——固定三问窄覆盖、无决策树走法，否。B. MP grilling 原文改名直接搬入零改动——协议可用但结论无落点，访谈完怎么落图靠临场发挥，必漂移，否。C. 本体移植 + SP 落点附录（采纳）——协议是 MP 的长项，落图是 SP 的领地，各取所长。D. 按 adr_0005 原分期等 1.0.0 grilling-lite——价值后置且落点问题照样要答，否。

**Why：** DEC-3 判据：意图对齐是纯流程 → 归 skills；结论落图动作全部由既有工具承载（adr create / update_node / approve / amend 三约束），skill 只持话术与路由，零新工具。DEC-6 ③「自建去外部依赖」指运行时不指向 MP 安装——把 MP 文本移植为 SP 自带资产并加本地化附录正是该判据的落法。DEC-4 0.8.0 入口冻结出现第二个例外（join 之后 sp-grilling），依据用户 2026-08-30 直接指令。

**Consequences：** ① g080-design-skill 范围修订：去 quiz 三问，Phase 0 路由表与 approve 话术保留，serve 人审话术接 sp-grilling 指针；② v100-disciplines 的 grilling-lite 被吸收，1.0.0 减负为路由落点确认；③ plugin skills 注册面 0.8.0 即 2→3（原计划 0.8.2 由 join 触发）；④ 0.8.2 WF16 amend 上报出口与后续成品审核话术消费 sp-grilling；⑤ 命名：用户当场定名 sp-grilling，与 S11 纪律族 plumber-* 前缀分叉，S11 批次复核时统一；⑥ quick 档轻量强度写法实现期定稿。

> 本文由 `graph export` 从图顶点 adr_0014 生成；改图不改文，重新导出即覆盖。
