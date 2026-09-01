---
name: plumber-join
description: Use when 一个全新会话/单体 agent 要冷启动加入一张已存在的拓扑图、零前文自主入场并认领节点干活、多会话并行推进同一张图、不知道下一步该认领哪个节点、被派来当节点工人但没有收到任何背景转述。Also use when asked to 加入执行、join 这张图、自主认领、接着跑图、把剩余节点跑完。Do NOT use for 设计新图（用 plumber-design）或整图编排/派 subagent/三层验收（用 plumber-execute）。多工具通用（pi/claude/zcode）。
---

# Plumber Join — 冷启动加入协议：零前文入场 → 自主认领循环

## Overview

本页假设你**没有任何前文**：没人给你转述背景，你只知道（或自己查出）工作区里有一张处于执行期的拓扑图。你要做的是自己入场、认领节点、干到 passed，然后回到队列继续认领，直到无前沿。固定序列：

**list/switch → status → next → claim → WORK（checkpoint 随做随报）→ report → verdict → passed → 回 next**

多会话并行是**预期场景**：认领原子互斥，谁抢到谁干；stale 是心跳不是事故。工具调用语法、状态机与报错修法的唯一权威是 Operations 手册（三访问层 CLI/MCP/脚本，本页只留序列与纪律）。

---

## 入场序列（严格按序；三通道语法 → 手册 §4.1）

0. **先取手册**：`Read ./manual.md §4、§6`（claude/zcode 插件包环境按手册 §11 寻址约定改为包根相对路径）——后面每一步的参数与报错修法都查它。
1. **list** — `graph_list_graphs`（CLI `graph list --json`）：看工作区有哪些图、哪张有 running/passed 活动。派单指名了图就用它；没指名挑在跑的那张。
2. **switch** — 把目标图设为当前图：CLI `graph switch <图名>`（写 `.graph/active`）；MCP `graph_switch` 只切本进程。之后一切调用都落在该图上。
3. **status** — `graph status --json`：确认这张图确在执行期（有 pending/ready/running），而不是设计期。已全部 passed → 图已收口，如实报告后收工。
4. **next** — `graph_get_next_actions {}`（CLI `graph next --json`）：一次返回五桶 ready / ready_eligible / blocked / running / stale_running。**按 priority 挑**（数值越小越先）：ready 桶取 priority 最小者；ready 空则对 ready_eligible 先 `{status:"ready"}`（门禁复校）再认领。条目带 `adr_flags` ⚠️ → 该节点依据的 ADR 已被接替，**停下弄清新决策再动工**。
5. **claim** — `graph_update_node_status {id, status:"running", claim_by:"<你的agent名>"}`（CLI `graph update-status -i <id> -s running --claim-by <名>`；脚本 `sp-claim.mjs`）。agent 名自取且当前未占用（如 `join-<后缀>`）；**绝不 claim 非 ready 节点**。claim 响应附 `governing_adrs` **必读**。收到 `already claimed by X` → 别重试同节点，回第 4 步换下一个。

## 干活与收口（单节点工作协议 → plumber-execute，本页不复制）

6. **WORK** — `graph_get_node {id}` 取 plan/checkpoints/DoD 全文，按 `plan.description` 干活。节点内部的完整纪律（REPORT AS YOU GO、上下文卫生、重试链、fan_in 等齐上游）→ **plumber-execute 技能**。
7. **checkpoint 随做随报** — 每完成一个立即 `graph_update_checkpoint`（无 MCP 时脚本 `sp-checkpoint.mjs`），绝不攒批。
8. **report → verdict → passed** — `graph_update_execution_report`（无 MCP 时 `sp-report.mjs`；artifacts 只写真实文件路径，会被存在性核验）；先写 `verification:{verdict:"passed"}` 再 `{status:"passed"}`——**先 verdict 后 passed** 是铁律。

一个节点 passed 后**回第 4 步**继续认领；五桶再无前沿（ready/ready_eligible 空、无自己可回收的 stale）→ 入场使命完成，报告收工。整图收尾的三层验收归编排方（plumber-execute），不在本协议内。

---

## 多会话并行（预期场景，不是事故）

| 现象 | 解读 | 动作 |
|------|------|------|
| `already claimed by X` | 原子认领互斥生效 | 换节点，不重试 |
| running 桶里有别人的节点 | 正常并行 | assigned_to 不是你的节点一律绕行 |
| stale_running 出现 | 心跳：可能只是节点大跑得久 | 先确认执行者不可达，才 `graph_reclaim_node {id, by:"<你>"}` |
| 前沿空但 running 非空 | 有人在干 | 停手收工，不抢收尾 |

**绝不 cancel 一个可以 reclaim 的节点**——cancelled 会阻塞其所有下游汇合点。

## 红线

- 只碰自己 claim 的节点；不手改 `.graph/` YAML、不传 force（MCP 协议级拒绝）、fan_in 汇聚点不等齐上游绝不动工。
- 图还在设计期/未审核 → 不属于执行期，回 `plumber-design`；需要编排整图或验收 → `plumber-execute`。
- 报错先查手册 §9 大表；**绝不忽略错误继续假装成功**。
