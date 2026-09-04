---
name: sp-grilling
description: Use when 需求或方向要与用户对齐、serve 人审时对已画好的图做质检、开发中决策拿不准要拷问、要改已有决定（ADR/任务节点/图结构）、成品要审核，或用户说出 grill/拷问/拷问我/追问/深挖/对齐/压力测试 等触发语。Also use when asked to 拷问这个方案、深挖这个决策、帮我确认想法、审这个成品、对齐一下需求。Do NOT use for 从零建图（用 plumber-design，建图过程可回本技能做对齐）或执行拓扑节点（用 plumber-execute）。纪律族技能：model-invoked 自动触发，不发 command（DEC-6）。多工具通用（pi/claude/zcode）。
---

# SP Grilling — 纪律技能：一次一问的意图对齐与决策拷问

## Overview

- **定位**：SP 自带纪律技能族成员（DEC-6 ③，adr_0014 的 skill 面）——MP grilling 本体的忠实移植 + SP 落点附录。工作流全周期的统一对话核心：需求与方向对齐、serve 人审对图质检、开发中决策、改决定、成品审核。
- 纪律族不发 command（DEC-6 ②）：触达靠触发语自动命中，无斜杠命令、无入口编排。
- 本页结构：本体协议（忠实移植，勿改）→ 强度分档 → SP 落点附录（共识后的结论如何落图）。

## 本体协议（一次一问，直到共识）

1. **无情访谈到共识**：就当前的计划/决策/想法的每一个方面对我无情追问，直到我们达成共识的理解。沿决策树的每个分支走下去，把决策之间的依赖逐一解开。**每个问题都附上你的推荐答案**。
2. **一次一问**：一次只问一个问题，等我给出反馈后再继续。一次抛出多个问题令人不知所措。
3. **事实自查，决策归人**：凡是能通过探查环境查到的**事实**（文件系统、graph CLI/MCP 工具、代码、图内状态），自己查，不要问我；**决策**是我的——把每一个决策摆到我面前，等我的答复。
   - SP 语境对照——事实：某节点当前状态、某 ADR 是否已 superseded、validate 是否 0 error、某文件是否存在；决策：节点该拆还是该合、ADR 够不够三判据、任务定 quick 还是 standard、方案选哪条。
4. **共识前不动手**：在我确认我们已达成共识之前，不要动手执行任何落图/改图/施工动作。

## 强度分档

| 档位 | 何时用 | 深挖强度 |
|------|--------|----------|
| quick 轻量档 | 经 plumber-design Phase 0 路由定档为 quick 的任务 | 少轮次：只对齐**目标**与**验收**各一问（附推荐答案），不逐分支深挖；两问得到答复即共识 |
| standard / program | 其余全部（含路由不明的任务） | 全量深挖：本体协议逐条走满——决策树逐支、依赖逐一、每问附推荐答案，直到共识闭合 |

档位不明确时按高档执行：宁可多问，不可漏问。

**雾区豁免（IL-026；依据 adr_0007：雾区只提示不阻止）**：对图上登记了雾区（fog）的点位，只拷问一问——**「毕业条件（graduation）是否可验证/可观测」**，不按 standard 档粒度逐支深挖：认知未到处不假装精确，雾区内部的问题留待 research 解雾后再拷。话术互指：雾区在 web-ui serve 的 chart 模式可见，毕业走 `graph graduate-fog`（手册 §2.2）。

## SP 落点附录：访谈结论四路落图

本体协议跑完、共识达成之后，把结论按性质路由到 SP 资产落位。路由只在共识后追加落图动作，不改变本体协议本身：

1. **工作类定档**（这个活是什么量级）→ 回 plumber-design **Phase 0 路由表**两问定档 quick / standard / program（DEC-2）：{{#pi}}`.pi/skills/plumber-design/SKILL.md`。{{/pi}}{{#plugin}}本插件包 `./skills/plumber-design/SKILL.md`（pi 渠道为 `.pi/skills/plumber-design/SKILL.md`）。{{/plugin}}
2. **设计决策**（难逆转 + 脱离上下文令人费解 + 真实权衡，ADR 三判据全满足）→ `graph adr create` 落 ADR 顶点（状态 proposed，accept/supersede 裁决归 Super Mario/人类），再以 decides 边挂到管辖的节点/context。
3. **改决定**（图已画好要改）→ 按 DEC-7 改图协议分流：
   - **小修**（不动结构：节点 plan/DoD 文案、checkpoint 增删）→ 归 plumber-execute 上报出口（WF16）：worker 提议、执行报告注明"计划已修订"；
   - **结构修订**（增删节点/边、拆分节点、取消子树、ADR supersede 连锁失效）→ 归 designer amend 模式（增量 validate + 影响评估 + 增量人审）；执行者不自己改结构。
4. **审批对话**（serve 人审中或审核结论）→ DEC-1 凭据话术：用户批准后由 designer 调一次 `graph approve --by <审核者>` 落审批凭据（quick 档 init 后自签）；对话本身仍按本体协议走，凭据是落点不是替代。

命令语法与错误处理 → `Read {{manual}} §2、§6`（claude/zcode 插件包环境按手册 §11 寻址约定改为包根相对路径）。

本体纪律在本附录不复述、不修改；两者冲突时以本体协议为准。
