# 工作流与话术层（skills/plugin/文档）（ctx-skills-plugin）

负责提示词与文档资产：plumber-design / plumber-execute 两个 SKILL.md 及其插件包双副本、integrations/shared/manual.md 手册、仓库术语表 CONTEXT.md 的维护与话术约定（Phase 0 路由 / quiz / 审核 / 上下文卫生 / 写作规范）。不负责机器语义的实现（归 ctx-tooling，规范落 manual 后由工具层 lint 接线衔接）、不负责版本发布与 ADR 治理（归 ctx-release-ops，经契约边衔接）。

## 术语表

- **工作类（work class）**: 一张图的流程档位（quick / standard / program），决定设计审核、质检与执行协议。关键未知阻止形成可信交付计划时选 program；否则，一个会话能完成并验收选 quick，其余选 standard。跨会话、跨图或跨仓库不单独触发 program。
- **自举（bootstrap）**: 自举是用产品自身的完整流程走一遍真实小图来验收工作流的手段，被验对象是 SP 自己的流程与工具；不是普通用户需求的执行，也不占用工作区既有图。
- **上下文卫生（context hygiene）**: 上下文卫生是执行期会话的上下文管理纪律——一节点一会话为默认、checkpoint=阶段边界、compact 后重读节点全文、stale 是心跳不是事故；不是图结构规则，也不改变状态机语义。
- **写作规范（plan/DoD writing rules）**: 写作规范是出图文案的成文标准——耐久>精确、行为式、可独立验证、显式范围；不是代码风格约束，也不由状态机强制，违者经文案 lint 报 warning。
- **quiz 三问**: quiz 三问是 serve 审核环节的固定自检话术——粒度、阻塞边真门槛、合并或再拆；不是状态机门禁，也不能替代人审本身。
- **加入协议（join protocol）**: plumber-join 的核心——面向新会话/单体 agent 的自主入场循环，不假设任何前文；多会话并行是预期场景。
- **入口动词判据**: 一个用户/agent 可见的入口动词 = 一个 skill；入口数量由「何时需要点名它」决定，不由内容量决定。
- **纪律技能族**: SP 自带的 model-invoked 纪律 skills（tdd/code-review/grilling-lite/diagnosing/prototype），借鉴 MP 风格自建、只服务图中节点、不指向外部技能库。
- **改图协议（amend）**: 执行中改图的三级分流——小修归 execute 上报出口、结构修订归 designer amend 模式（影响评估+增量人审+自动快照）、裁决触发路由回 designer；改图后 review 回置。
- **chart/work 模式**: program 档两模式：chart 画已知骨架、关键未知及当前研究任务；work 逐票研究、核对毕业证据、回写决策。关键未知解决且可信交付计划经增量人审后转 standard。
- **journey prompts**: 每阶段末尾告知用户「下一步是什么、需要你做什么」的话术约定。
- **单真相源**: 正本唯一处（integrations/src/），.pi 与 plugin 全部为构建产物；sha256 断言从同步检查降级为生成完整性检查。
- **附件分层**: SKILL.md 主文档收窄至编排剧本（<100 行），细节按需披露进 attachments/。

> 本文由 `graph export` 从 context 顶点 ctx-skills-plugin 生成（节点即文档，图是真相源）。
