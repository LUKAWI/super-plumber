---
description: 冷启动加入一张已审核拓扑图：零前文自主入场（list/switch→status→next→claim），认领节点干到 passed，循环认领直到无前沿
---
<!--
super-plumber 斜杠命令正本 · v0.8.2（plumber-join）
正本唯一性：本文件是 /plumber-join 文案的唯一权威源，改文案只改这里。
构建期同步约定（scripts/sync-integrations.mjs 消费）：
  - 拷贝目标：integrations/plugin/commands/plumber-join.md
               plumber-join.md    两件拷贝与本正本内容一致、sha256 一致；禁止手改拷贝件。
  - pi 集成无 slash-command 机制，本正本不向 .pi/ 拷贝。
三包路径约定以 docs/multitool-v061/integration-blueprint.md §3 映射表为准。

# /plumber-join

**定位**：让一个全新会话/单体 agent 零前文加入一张已在执行期的拓扑图，自主认领节点干到 passed 的入口命令。

**使用时机**：
- 新开的会话/新派的 agent 没有任何前文，要直接加入执行（自主入场认领）；
- 用户要求"加入这张图 / 认领节点干活 / 多开几个会话并行推进"；
- 不适用：还没有经审核的设计稿（先走 /plumber-design）、整图编排派单与收尾三层验收（用 /plumber-execute）。

**执行指令**：加载并按 **plumber-join 技能**的冷启动加入协议执行本次请求——graph list/switch → status → next（前沿五桶按 priority 挑）→ claim_by=<自己>（响应附 governing_adrs 必读、adr_flags ⚠️ 即停）→ 按节点协议干活 → checkpoint/report → verdict → passed → 回 next 循环，直到无前沿。单节点工作协议见 plumber-execute 技能，本命令不复制。
**硬门禁提醒**：只 claim ready 节点且必带 claim_by；先 verdict 后 passed；stale 走 reclaim 绝不 cancel——多会话原子认领互斥是预期场景，already claimed 就换节点。
**深读指引**：细节与操作语法见 integrations/shared/manual.md §4（execute-ops）与 §5（状态机）；插件包内按寻址约定 `Read ./manual.md §4`、`Read ./manual.md §5`。

**参数位说明**：$ARGUMENTS 原样透传，作为目标图名或范围限定说明，不做模板展开。
