---
name: plumber-design
description: Use when 接到新需求/任务需要拆解成任务拓扑图、设计或修改 .graph/ 拓扑（节点/边/entry/exit）、验证拓扑设计质量、需要 graph serve 打开浏览器预览拓扑并请求用户审核。Also use when asked to 拆解需求、设计任务拓扑、把需求变成拓扑图、任务分解、sp-designer 设计阶段、graph 预览审核。Do NOT use for 执行已审核通过的拓扑（用 plumber-execute）或纯 todo 列表（图不是附属品）。
---

# Plumber Design — 需求 → 拓扑图 → 预览审核

## Overview

把一条需求拆解成一张**可执行的任务拓扑图**（`.graph/`），验证它无 bug，用 `graph serve` 打开浏览器供用户预览，然后**请求用户审核**。审核是硬性 gate——用户批准之前，绝不进入执行阶段。v0.5 起设计产出还包含**领域结构**：bounded context（节点即文档的术语表）与 ADR（够三判据的架构决策），它们是图中一等公民。

**本 skill 的产出物是"设计定稿的拓扑图（含领域结构）"，不是执行结果。** 审核通过后切换到 plumber-execute。

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
6. **建节点时一次带完整压缩包**：`graph create-node -i <id> -l <label> --plan-desc "..." --dod "..." --dod "..."`，再用 `graph update-node -i <id> --add-checkpoint '{"id":"cp1","label":"..."}'` 补 checkpoints（MCP：`graph_create_node` 直接带 `checkpoints`，或 `graph_batch_create` 一次批量建 20+ 节点/边）。**批量建图每批 ≤200 节点**，大图分段提交；读图用 `graph_get_graph` 默认 summary 模式（紧凑字段），需要完整内容再用 `graph_get_node` 按需解压

**每个节点 MUST 携带三要素**（缺一不可，体检脚本会抓）：

| 要素 | 字段 | 要求 |
|------|------|------|
| 做什么 | `plan.description` | 一句清晰的任务描述 |
| 分几步 | `checkpoints` | ≥1 个子步骤 `{id, label}` |
| 算完成 | `expected_outcome.definition_of_done` | ≥1 条可验证标准 |

### Step 2.5 — 领域建模（v0.5，需求超过一个关注点时必做）

**识别 bounded context 的信号**：职责各自内聚、可各说各话；同一个词在不同块里含义不同（同词异义 = 边界存在的最强信号）。单一关注点的小任务可跳过本步。

1. **建 context 顶点（节点即文档）**：`graph create-node -i ctx_<域名> --type context -l "<中文名>"`，然后填边界与术语表：
   ```bash
   graph update-node -i ctx_ordering --boundary "负责订单生命周期；不负责计费（计费经契约边由 billing 消费）"
   graph update-node -i ctx_ordering --glossary-add '{"term":"订单","definition":"带明细行的购买单据，区别于账单"}'
   ```
   - **术语是 context 的内容字段，不是独立顶点**——绝不为术语单独建节点
   - 同一 context 内术语不重复（validate 警告）；**跨 context 同名术语合法**（DDD 本义，各说各话）
   - 定义要能划界："X 是……，不是……"
2. **归属工作流节点**：`graph create-node ... --context ctx_x`（创建时）或 `graph update-node -i <id> --set-context ctx_x`（事后）。过程节点（测试/发布类）不属于产品域，可不归属。
3. **context 间关系（可选）**：`graph add-edge -i rel_1 -s ctx_a -t ctx_b --type relates --rel-kind "上游-下游"`（仅 context↔context，rel_kind 自由文本，不发明新边类型）。
4. **跨 context 契约边（硬规则）**：任何**两端归属不同 context** 的工作流边 = 契约边，**必须**填 `--contract '{"produces":"...","consumed_by":[...],"validation":{...}}'`——两个上下文间的依赖必须声明产出/消费/验收，未填 validate 警告。

### Step 2.6 — ADR 甄别（v0.5，三判据全满足才建，缺一跳过）

| 判据 | 问自己 |
|------|--------|
| 难以逆转 | 改主意的代价大吗？随手能改的不算 |
| 脱离上下文令人费解 | 未来读者看代码会问"为什么这么搞？"吗 |
| 真实权衡 | 存在过真正的备选项，且为特定理由选了这一个吗 |

```bash
graph adr create -t "<决策标题>" -d "<决策内容>" [-b 背景 -o 备选项 -w 为何 -c 后果]  # 自动编号 adr_NNNN，落 proposed
graph add-edge -i d_1 -s adr_0001 -t <管辖的节点或ctx> --type decides   # 孤儿 ADR 会被 validate 警告
```

- **设计方只 propose 不裁决**：accept/supersede 归 super-mario/人类（提议/裁决分离）
- 不够三判据的决策写进节点 plan 即可，不建 ADR（ADR 膨胀 = 判断力失守）

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

- 明确询问用户："拓扑图已在浏览器打开（端口 X），请审核：任务拆分是否合理？验收标准是否齐全？领域划分与 ADR 是否妥当？是否批准执行？"
- **建议用户切三透镜审阅**（Web UI 左侧 map 勾选器）：**工作流图**（任务拆分与依赖）／**领域图**（context 边界与术语，点开看节点即文档详情）／**叠加图**（簇壳包裹成员、ADR 徽章、契约边高亮——归属是否合理一眼可见）
- 用户**否决/提意见** → 回到 Step 2 修改 → Step 3 重验 → 等待浏览器刷新 → 再次请求审核
- 用户**批准** → 才可进入 `plumber-execute`（建议用户明确说"开始执行"触发）
- **绝不**在未获批准的情况下 claim 节点或改动节点状态；**绝不**自行调用 plumber-execute 或开始执行任何节点——设计完成 ≠ 可以执行

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
| 边类型乱用（如把 fan_out 当 depends_on） | 见 reference.md 的 9 边类型选型表 |
| 为术语单独建节点 | 术语是 context 的内容字段（glossary），不是顶点 |
| 每个决策都建 ADR | 三判据缺一跳过，写进 plan 即可 |
| 跨 context 边不填 contract | 契约边硬规则：produces/consumed_by/validation 必声明 |
| 设计完自链进入执行 | Step 5 硬性 gate：批准前不执行，绝不自己调 plumber-execute |

## Red Flags — STOP and fix

- "entry/exit 先跳过，后面补"（后面永远不会补）
- "节点先建，plan 最后填"（三要素必须在设计期齐备）
- "validate 有 warning，但只是警告"（warning 是可修的，修）
- 体检脚本有 error 就 serve 预览（先修完再预览）
- 用户还没批准就 claim / 改状态（gate 是硬的）
- 需求没理解就建图（Step 1 是地基）
- "领域建模/ADR 最后再说"（它们是设计产出的一部分，和节点同批完成，validate 才能全绿）

---

## 细节与规范

- 设计规范、id 命名、9 边类型选型、质量清单明细 → `reference.md`
- **领域文档书写模板（v0.5.1）**：context 顶点（boundary 划界句式 + glossary 定义句式）与 ADR 顶点（六字段写法）→ `reference.md` §7；格式决策：真相源是 YAML 字段，markdown 只是导出视图（快照时自动导出）
- 体检脚本：`scripts/sp-check-design.mjs`（用法：`node sp-check-design.mjs [--json]`，从含 `.graph/` 的目录运行）
- 读图/改图工具：CLI `graph <cmd>`（建图、status、validate、serve）+ MCP `graph_*`（读图遍历）
