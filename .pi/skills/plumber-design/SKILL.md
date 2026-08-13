---
name: plumber-design
description: Use when 接到新需求/任务需要拆解成任务拓扑图、设计或修改 .graph/ 拓扑（节点/边/entry/exit）、验证拓扑设计质量、需要 graph serve 打开浏览器预览拓扑并请求用户审核。Also use when asked to 拆解需求、设计任务拓扑、把需求变成拓扑图、任务分解、sp-designer 设计阶段、graph 预览审核。Do NOT use for 执行已审核通过的拓扑（用 plumber-execute）或纯 todo 列表（图不是附属品）。
---

# Plumber Design — 需求 → 拓扑图 → 预览审核

## Overview

把一条需求拆解成一张**可执行的任务拓扑图**（`.graph/`），验证它无 bug，用 `graph serve` 打开浏览器供用户预览，然后**请求用户审核**。审核是硬性 gate——用户批准之前，绝不进入执行阶段。

**本 skill 的产出物是"设计定稿的拓扑图"，不是执行结果。** 审核通过后切换到 plumber-execute。

---

## When to Use

- 接到新需求/任务，需要拆解为 3–20 个有依赖关系的任务
- 需要设计或修改 `.graph/` 拓扑（entry/exit、节点、边）
- 需要验证拓扑质量（`graph validate` + 设计体检脚本）
- 需要启动 `graph serve` 打开浏览器预览并请求用户审核
- 用户审核后提出修改意见 → **回到本 skill** 修改 → 重新验证 → 重新预览 → 再次请求审核

**REQUIRED SUB-SKILL:** 用户审核通过、开始执行节点任务时 → `plumber-execute`（本 skill 的 reference 覆盖设计规范与质量清单；执行协议在 plumber-execute）。

**REQUIRED SUB-SKILL:** 节点状态裁决 / checkpoint 聚合 / 重试管理 → `super-mario` agent。

---

## 流程（5 步，严格按序，绝不跳步）

### Step 1 — 理解需求

- 向用户确认：目标是什么？交付物是什么？边界（不做什么）？
- 有歧义就问，不要猜。需求不清 → 图必错。

### Step 2 — 设计拓扑（先骨架后细节）

**顺序铁律：entry 和 exit 永远第一个定义。**

1. **定义 entry/exit 图级字段**：`graph update-graph --entry-desc "<需求>" --exit-desc "<交付>" --add-criteria "<验收标准>"`（v0.2 起有专用命令，**不再手写 graph.yaml**；MCP 用 `graph_update_graph`）
2. **L1 动脉**：3–6 个一级任务，`id: l1_*`
3. **L2 毛细血管**：挂在 L1 下的子任务，`id: l2_*`（一个 L1 有 2–5 个 L2 更佳）
4. **L3，L4，L5......** :树状延伸的子任务，`id: l3_*，l4_*，l5_*`，按需分层次设计，若上层还可分则启用下一层，一般不超过5层
5. **边**：先连 topo 边（`depends_on`/`validates`——决定执行顺序），再加运行时边（`fan_out`/`fan_in` 等——并行/汇聚语义）
6. **建节点时一次带完整压缩包**：`graph create-node -i <id> -l <label> --plan-desc "..." --dod "..." --dod "..."`，再用 `graph update-node -i <id> --add-checkpoint '{"id":"cp1","label":"..."}'` 补 checkpoints（MCP：`graph_create_node` 直接带 `checkpoints`，或 `graph_batch_create` 一次批量建 20+ 节点/边）

**每个节点 MUST 携带三要素**（缺一不可，体检脚本会抓）：

| 要素 | 字段 | 要求 |
|------|------|------|
| 做什么 | `plan.description` | 一句清晰的任务描述 |
| 分几步 | `checkpoints` | ≥1 个子步骤 `{id, label}` |
| 算完成 | `expected_outcome.definition_of_done` | ≥1 条可验证标准 |

### Step 3 — 验证无 bug（两关，都过才算）

1. **结构关**：`graph validate` → **必须 0 error**。任何 warning 都要看懂并处理（warning 是可修的，修掉再走）。
2. **质量关**：`node scripts/sp-check-design.mjs`（体检脚本）→ **0 error**。它自动扫：entry/exit 是否定义、节点三要素是否齐备、孤立节点、entry→exit 双向可达性、topo 环、边引用完整性。

> 手动自查清单见 `reference.md`。**体检脚本报的 error 必须全部修完，不允许带着 error 进入预览。**

### Step 4 — serve 预览（贯穿全程，不关闭）

- 首次预览：`graph serve`（默认端口 8934；被占用用 `-p <port>` 换）
- 服务启动后**保持运行**：watcher 实时推送改动，用户提意见 → 你改图 → 浏览器自动刷新，用户所见即所得
- **不要关闭 serve**——它贯穿整个 workflow（执行阶段的状态变化也会实时可视化），直到用户明确说全部结束
- 若 serve 已在运行（之前启动过），不要重复启动，直接确认端口可用

### Step 5 — 请求用户审核（硬性 gate）

- 明确询问用户："拓扑图已在浏览器打开（端口 X），请审核：任务拆分是否合理？验收标准是否齐全？是否批准执行？"
- 用户**否决/提意见** → 回到 Step 2 修改 → Step 3 重验 → 等待浏览器刷新 → 再次请求审核
- 用户**批准** → 才可进入 `plumber-execute`
- **绝不**在未获批准的情况下 claim 节点或改动节点状态

---

## 常见错误（每个都真实发生过，不要重犯）

| 错误 | 修正 |
|------|------|
| 跳过 entry/exit 直接建 L1 | Step 2 铁律：entry/exit 第一，永远 |
| 裸节点（无 plan/checkpoints/dod） | 三要素齐备，体检脚本验证 |
| validate 有 warning 就放行 | warning 可修，修完 0 error 再走 |
| 用 CLI 建图但没有验证入口可达性 | 体检脚本自动查双向可达 |
| 审核没过就偷偷开始执行 | 硬性 gate：批准前不执行 |
| 忘了 serve 在跑，重复启动 | 先确认端口，serve 贯穿全程不重复启 |
| 边类型乱用（如把 fan_out 当 depends_on） | 见 reference.md 的 7 边类型选型表 |

## Red Flags — STOP and fix

- "entry/exit 先跳过，后面补"（后面永远不会补）
- "节点先建，plan 最后填"（三要素必须在设计期齐备）
- "validate 有 warning，但只是警告"（warning 是可修的，修）
- 体检脚本有 error 就 serve 预览（先修完再预览）
- 用户还没批准就 claim / 改状态（gate 是硬的）
- 需求没理解就建图（Step 1 是地基）

---

## 细节与规范

- 设计规范、id 命名、7 边类型选型、质量清单明细 → `reference.md`
- 体检脚本：`scripts/sp-check-design.mjs`（用法：`node sp-check-design.mjs [--json]`，从含 `.graph/` 的目录运行）
- 读图/改图工具：CLI `graph <cmd>`（建图、status、validate、serve）+ MCP `graph_*`（读图遍历）
