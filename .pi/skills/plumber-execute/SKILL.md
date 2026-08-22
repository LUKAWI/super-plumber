---
name: plumber-execute
description: Use when 拓扑图已设计并审核通过、需要执行 .graph/ 中的节点任务（claim/checkpoint/execution_report/passed）、按依赖顺序跑完整个拓扑、需要决定何时派 subagent 并行执行节点、验证所有节点 passed 与构建成果完整。Also use when asked to 执行拓扑图、跑图、执行任务拓扑、完成任务中的节点、super-mario 执行阶段、节点状态流转。Do NOT use for 设计/预览/审核拓扑（用 plumber-design）或纯 todo 列表。
---

# Plumber Execute — 拓扑执行 → 全部 passed → 三层验收

## Overview

按拓扑图的依赖顺序执行每个节点：**CLAIM → WORK → 逐 checkpoint 上报 → execution_report → passed**。所有节点 passed 后做**三层验收**，验证构建成果真实完整。

**本 skill 的产出物是"全部节点 passed 且验收通过的构建成果"，不是设计。** 图还没设计/未审核 → 回 plumber-execute 的上游 skill `plumber-design`。

---

## When to Use

- 拓扑图已设计并审核通过，开始执行节点任务
- 需要 claim 节点 / 上报 checkpoint / 提交 execution_report / 标记状态
- 需要判断：这批节点是串行还是派 subagent 并行
- 需要验证所有节点 passed、构建成果完整
- 节点 failed → 走重试（pending → ready → 重新 claim）

**REQUIRED SUB-SKILL:** 图未设计或用户未审核通过 → `plumber-design`。
**REQUIRED SUB-SKILL:** 节点状态裁决 / checkpoint 聚合 / 输出抽查 → `super-mario` agent。

---

## 执行协议（每个节点，严格按序）

0. **PLAN** — 每轮决策前先 `graph_get_next_actions`（或 CLI `graph next --json`）：一次拿到 ready（可认领）/ ready_eligible（门禁已满足的 pending/failed，**转 ready 即可执行——冷启动第一步就从这里拿入口节点**）/ blocked(带未满足前驱) / running(带时长) / 疑似卡住清单，不要用 graph_get_graph + graph_search 手工拼。每个桶默认最多 100 条，`truncated: true` 时用 `limit` 参数翻页。
1. **CLAIM** — 挑一个 `ready` 节点：`graph_update_node_status {id, status: "running", claim_by: "<你的agent名>"}`。原子记录 `assigned_to` + `started_at`。
   - 没有 ready 节点但有 `ready_eligible` → 对可执行节点 `graph_update_node_status {id, status: "ready"}`（核心层会再次校验门禁），然后 claim。
   - **绝不 claim 非 ready 节点**——状态机/门禁会拒绝（`Invalid transition` 或 `前置未满足`），先用 `graph_get_next_actions` 确认 ready。
   - 并发 claim 是原子的：拿到 `already claimed by X` 说明别的 agent 抢先了——换节点，别重试同节点。
   - `force` 在 MCP 通道被**协议级拒绝**（v0.4 起）——传了直接报错；人类运维走 CLI `--force` 并留审计事件。
   - **v0.5 claim 响应附 `governing_adrs`（管辖 ADR 标题级指针）——必读**：所依据的架构决策（decides 指向该节点或其 context、且非 superseded 的 ADR）。觉得相关再用 `graph_get_node` 取全文；指针为空则无此纪律。**adr_flags ⚠️ 出现（决策依据已过时）→ 停下重审**：该节点依据的 ADR 已被接替，先弄清新决策再动手；ADR 状态只能由裁决方（super-mario/人类）改，执行 agent 不改。
2. **WORK** — 执行 `plan.description`；把 `checkpoints` 当你的清单逐条完成。
3. **REPORT AS YOU GO** — **每完成一个 checkpoint 立即上报** `graph_update_checkpoint {node_id, checkpoint_id, status}`。**绝不攒到结尾**——完成的未上报 = 丢失的进度。（checkpoint 状态机：pending→running→passed 等；同状态重复上报幂等）
4. **HAND OFF** — 干完立刻 `graph_update_execution_report {node_id, summary, artifacts, blockers, notes}`。artifacts 填**真实文件路径**（验收时会抽查）。
5. **passed** — **核心层硬门禁**：有 execution_report（summary 非空）+ checkpoint 全部 passed/skipped + 无 failed 裁决，才能标 `passed`。**无报告标 passed 会被核心拒绝**——这不是可选的礼仪，是状态机规则。

> 状态流转：`failed` → `pending` 重试（attempts 自动 +1，到 `max_attempts` 被拦截；重置必须显式——CLI `--reset-attempts` / MCP `reset_attempts: true`，写 attempts_reset 审计事件；修改 plan.description **不再**自动归零）。`blocked` → 等依赖解除转 `ready`。见 reference.md 状态机全表。

---

## 并行决策（重点：何时派 subagent，何时不派）

**两步决策：先看结构，再叠加条件。两条都过才并行。**

### 第一步 · 看拓扑结构（`graph_get_next_actions` 直读；fan_out 批 = 并行候选，fan_in 汇聚 = 强制汇合）

- **ready 列表** → 可认领（核心层已验证门禁，直接 claim）
- **ready_eligible 列表** → 门禁已满足的 pending/failed 节点，转 ready 即可执行（含冷启动入口）
- **blocked 列表** → 带未满足前驱清单；补齐后自然放行
- **fan_out 之后的一批节点**（同一上游发散出的多个子任务）→ 天然并行候选——它们互相无依赖，顺序无所谓
- **fan_in 汇聚点**（多个节点汇入一个下游）→ 必须等**全部**上游 passed 且 execution_report 齐备才能执行汇聚节点——并行后的汇合门，不满足就等（核心层门禁会拦截提前 claim）
- 主链（depends_on/validates 串行段）→ 无并行空间，逐个来

### 第二步 · 叠加并行条件（全部满足才派 subagent）

| 条件 | 判据 |
|------|------|
| ≥2 个 `ready` 节点 | 且相互之间**无依赖边**（含 fan_out 批、shares_context 组） |
| 工作量值得 | 每个节点够一个 subagent 干（> 几轮工具调用）；小而快的节点自己串行干 |
| 不共享冲突上下文 | 不编辑同一文件/不占同一服务端口（共享只读输入是 OK 的，共享写目标是冲突） |
| 并行数 ≤ 3 | 多于 3 个分批，主 agent 验收不过来 |

**任一条件不满足 → 串行**（自己 claim→work→report 逐个走）。

### 并行实现方式

- 每个 subagent **独立 CLAIM 自己的节点**（claim_by 各不相同）→ 状态互不干扰
- 各 subagent 自己 checkpoint / execution_report（各自节点归属清楚）
- 主 agent 在**汇合点**统一 verify：所有并行节点 passed + 报告齐备，才允许下游
- 并行 subagent 类型参考：`explore`/`hephaestus`/`sisyphus-junior` 等，按节点性质选

### 死认领回收（stale_running 处理）

`stale_running` 出现时不要干等：

1. 确认该节点长时间无 checkpoint 更新（阈值默认 30 分钟）且执行 agent 已不可达；
2. 用 `graph_reclaim_node {id, by: "<你的agent名>"}`（CLI：`graph reclaim -i <id>`）把节点收回 `pending`——attempts 不变、`assigned_to` 清空、notes 附回收记录；
3. 回收后节点回到调度池，可被任何 agent 重新执行。

**绝不直接 cancel 一个可以回收的节点**——cancelled 会阻塞其所有下游汇合点。

### 示例判读（pi-extension/subagents/.graph 结构）

```text
entry → l1_discover → l1_extract ──fan_out×10──→ (10个 l2_*) ──fan_in×10──→ l1_convert → l1_review → l1_deploy → exit
```

- `l1_extract` 完成后：10 个 l2_* 全 ready 且互无依赖 → **分 3+3+3+1 批并行**
- `l1_convert`（fan_in 汇聚）→ **必须等 10 个 l2_* 全部 passed** 才 claim
- `l1_review` / `l1_deploy`（主链串行）→ 逐个执行

---

## 结束验收（三层，全过才报告完成）

1. **状态层**：`graph status` → 所有 **task 节点** `passed`，无 failed/blocked/pending 残留（entry/exit 是图级定义节点，不执行、保持 pending 属正常；cancelled 需用户知情）
2. **结构层**：`graph validate` → 0 error（执行期可能动过图，收尾必须重验）
3. **成果层**：exit 的 `acceptance_criteria` **逐条对照真实 artifact**——产物文件真实存在、内容匹配，不是只读 execution_report 的 summary 文本

**三层全过 = 完成。** 任何一层不过，继续修，不宣告完成。

---

## 常见错误（每个都真实发生过）

| 错误 | 修正 |
|------|------|
| claim 非 ready 节点 | 先 graph_get_next_actions 确认 ready 再 claim |
| 冷启动找不到第一个节点 | 看 `ready_eligible` 桶：门禁已满足的 pending 节点转 ready 即可执行 |
| pending → running 一步到位 | 状态机拒绝。先 ready 再 running |
| 用 force 绕开门禁/次数上限 | MCP 直接拒绝（协议错误）；CLI force 仅人类运维 |
| 拿到 already claimed 还重试同节点 | 原子认领保护，换节点 |
| checkpoint 攒到结尾批量报 | 每完成一个立即上报 |
| 无 execution_report 标 passed | 核心层会拒绝（passed 硬门禁），先填报告再 passed |
| stale 节点直接 cancel | 先 `graph_reclaim_node` 回收（cancel 会毒死下游汇合点） |
| 明明可并行却串行（或反之） | 并行决策两步走：结构 + 条件 |
| fan_in 汇聚点不等齐上游 | 等全部上游 passed + 报告齐备 |
| 并行数超过 3 | 分批，主 agent 验收不过来 |
| 只跑 validate 就宣告完成 | 三层验收，成果层抽查 artifact |

## Red Flags — STOP and fix

- "CLI 就够了"（claim/checkpoint/report 只有 MCP/脚本有）
- "checkpoint 最后一起报"（报一个过一个，进度不丢）
- "先标 passed，报告后补"（passed 需要 report 当场）
- "所有节点都是 depends_on 串行"（没看 fan_out/fan_in 结构）
- "汇合点还没等齐就开工"（fan_in 必须等全部上游）
- "validate 有 warning，先交付"（warning 可修，修完再报）
- "报告里写了就算成果存在"（成果层要抽查真实 artifact）

---

## 细节与工具

- 状态机全表、MCP 工具表、脚本用法、错误处理 → `reference.md`
- 脚本：`scripts/sp-*.mjs`（claim/checkpoint/report/status/get-node/traverse）——无 MCP 客户端时的执行工具
- 读图：`graph status` / `graph_get_graph` / `graph_traverse` / `graph_search`
