---
description: 把一条新需求拆解为可执行的任务拓扑图（.graph/，含领域结构与 ADR），走设计→双关卡体检→serve 预览→用户审核闸门
---
<!--
super-plumber 斜杠命令正本 · v0.6.1（plumber-design）
正本唯一性：本文件是 /plumber-design 文案的唯一权威源，改文案只改这里。
构建期同步约定（scripts/sync-integrations.mjs 消费）：
  - 拷贝目标：integrations/plugin/commands/plumber-design.md
               plumber-design.md    两件拷贝与本正本内容一致、sha256 一致；禁止手改拷贝件。
  - pi 集成无 slash-command 机制，本正本不向 .pi/ 拷贝。
三包路径约定以 docs/multitool-v061/integration-blueprint.md §3 映射表为准。

# /plumber-design

**定位**：把一段需求经 plumber-design 技能变成拓扑图并停在用户审核闸门的入口命令。

**使用时机**：
- 用户提出可拆解为多步骤的任务，想先规划成图再执行；
- 用户明确要求"设计任务拓扑 / 拆解需求出一张图"；
- 不适用：已审核通过的图要执行（用 /plumber-execute）、单点小改动或纯问答（直接做，不建图）。

**执行指令**：加载并按 **plumber-design 技能**的编排剧本执行本次请求——理解需求 → 设计建图 → validate + doctor 双绿 → serve 预览 → 停在审核硬 gate。
**硬 gate 提醒**：审核闸门未获用户明确批准前绝不执行任何节点，绝不自链进入 plumber-execute。
**深读指引**：细节与操作语法见 integrations/shared/manual.md §2（design-ops）；插件包内按寻址约定 `Read ./manual.md §2`。

**参数位说明**：$ARGUMENTS 原样透传，作为本次待设计的需求描述，不做模板展开。
