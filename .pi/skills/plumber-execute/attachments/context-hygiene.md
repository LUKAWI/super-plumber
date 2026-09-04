<!-- 附件（0.9.4 S02 分层，adr_0008）：上下文卫生四纪律。唯一正本 integrations/src/skills/plumber-execute/attachments/；
     .pi 与插件包内同名文件是 gen 产物，手改会被 scripts/sync-integrations.mjs --check 拦截。
     寻址：与 plumber-execute/SKILL.md 同目录 attachments/（两渠道同构，相对本文件可解析）。 -->

# Context Hygiene — 上下文卫生（一节点一会话，checkpoint 为收口点）

何时读：派 subagent 执行节点、跨节点切换、compact 之后继续干活、看到 stale_running 条目时（手册 §4.4 为同源手册面，名目一致；本页是 skill 面，含 solo/subagent 分支细则）。

执行会话的工作内存是易耗品：混装多个节点的 plan/报告/报错会让执行者串线，压缩后的残缺记忆会让人假装在续做。四条卫生纪律：

1. **一节点一会话为默认**：一个执行会话只装载一个节点的上下文；研究/原型类与显式并行为例外（→ `prototype-research.md`）。subagent 派单天然如此；solo 分支串行切换节点时同样遵守——A 节点 report→passed 落定后再装载 B 的 plan，不把 A 的执行残迹带进 B 的会话。
2. **checkpoint=阶段边界**：compact、交接、长输出落盘对齐 checkpoint 边界进行，不在 checkpoint 中途做。每报完一个 checkpoint 就是天然收口点；中途交接只会把半截状态留给接手方。
3. **compact 失败模式**：压缩发生后必须重读节点全文（`graph_get_node` 取 plan/DoD/checkpoints）再继续，不凭会话记忆续做。compact 后会话里『节点长这样』的记忆多半已被摘要污染——DoD 漏项、checkpoint 漏报多源于此，重读一次是最便宜的纠偏。
4. **stale 是心跳不是事故**：running 超阈值先视为『可能在干活』，确认执行者不可达后才 reclaim，绝不顺手 cancel。长 checkpoint 本就可能超默认 30 分钟阈值；处置顺序 → 手册 §4.3 与主文档「并行决策 · stale 死认领回收」。
