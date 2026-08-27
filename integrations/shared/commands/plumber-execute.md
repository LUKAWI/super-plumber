---
description: 按依赖顺序执行已审核拓扑图中的节点（claim→checkpoint→report→passed），支持 subagent 并行与 solo 模式，直到三层验收完成
---
<!--
super-plumber 斜杠命令正本 · v0.6.1（plumber-execute）
正本唯一性：本文件是 /plumber-execute 文案的唯一权威源，改文案只改这里。
构建期同步约定（scripts/sync-integrations.mjs 消费）：
  - 拷贝目标：integrations/plugin/commands/plumber-execute.md
               plumber-execute.md    两件拷贝与本正本内容一致、sha256 一致；禁止手改拷贝件。
  - pi 集成无 slash-command 机制，本正本不向 .pi/ 拷贝。
三包路径约定以 docs/multitool-v061/integration-blueprint.md §3 映射表为准。

# /plumber-execute

**定位**：接管一张已审核通过的拓扑图，按五步协议循环推进到全部节点 passed 的入口命令。

**使用时机**：
- 图已通过审核闸门，用户下令开始/继续执行；
- 用户要求"跑图 / 推进这张图 / 完成剩余节点"；
- 不适用：还没有经审核的设计稿（先走 /plumber-design）、只想看进度汇报（查 events/serve 即可）。

**执行指令**：加载并按 **plumber-execute 技能**的编排剧本执行本次请求——认领 CLAIM → checkpoint 随做随报 → REPORT AS YOU GO → 并行派单 → HAND OFF 聚合三层验收。
**硬门禁提醒**：passed 是硬门禁——checkpoint 全部聚合且 artifacts 存在性核验通过才允许置 passed，validate 全绿只是结构关不是完成关；stale 节点用 reclaim 回收，绝不 cancel 伪造完成。
**深读指引**：细节与操作语法见 integrations/shared/manual.md §4（execute-ops）与 §5（状态机）；插件包内按寻址约定 `Read ./manual.md §4`、`Read ./manual.md §5`。

**参数位说明**：$ARGUMENTS 原样透传，作为本次执行的图名或范围限定说明，不做模板展开。
