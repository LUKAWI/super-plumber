# Plumber Execute Reference — 执行工具、状态机、并行细则、验收标准

本文件是 **plumber-execute** skill 的配套参考：执行期的所有工具与规则。流程协议（执行 5 步 + 并行决策 + 三层验收）见 SKILL.md；设计期规范见 plumber-design。

**一句话：工具会校验，错误是信号。绝不绕开校验假成功。**

---

## 1. 访问层——知道每层能干什么

| 层 | 用于 | 不能做 |
|----|------|--------|
| **CLI** `graph`（20 命令） | init、批量建节点/边、status、validate、next、verdict、reclaim、snapshot/diff/rollback、export、serve | —（v0.2 起 claim/checkpoint/report 也可用 CLI/脚本） |
| **MCP** `graph_*`（19 工具） | 一切（设计 + 执行 + 裁决 + 版本），zod 校验 | 不得传 `force: true`（仅人类运维） |
| **脚本** `scripts/sp-*.mjs`（7 个） | 无 MCP 客户端时的读/流转/claim/checkpoint/report/遍历 | — |

> 首选 MCP（覆盖最全、校验最强）；无 MCP 客户端时用 CLI + 脚本。

## 2. CLI 命令（20）

| 命令 | 用途 | 关键参数 |
|------|------|---------|
| `init` | 建 `.graph/` 骨架（含 schema.yaml） | `-l <label>` `--force` |
| `create-node` | 建节点（可一次带完整压缩包） | `-i -l -t --level --plan-desc --dod(×N) --assigned-to --max-attempts` |
| `get-node` | 读节点 + 合法转换 + 门禁状态（+ 拓扑邻居） | `-i [--json] [--neighbors up\|down\|none]` |
| `add-edge` | 建边（核心层校验端点存在） | `-i -s -t --type` |
| `update-status` | 状态机流转（含 ready 门禁/max_attempts/passed 硬门禁） | `-i -s [--claim-by <agent>] [--force]` |
| `reclaim` | 回收死认领：running → pending（清空执行者 + 回收记录） | `-i [--by <actor>]` |
| `update-node` | 编辑 plan/DoD/checkpoints/assignee/label/max_attempts | `-i --plan-desc --add-dod --clear-dod --add-checkpoint --set-assigned --label --max-attempts --show` |
| `update-graph` | 编辑图级字段（entry/exit/验收标准），不再手写 graph.yaml | `--entry-desc --exit-desc --add-criteria(×N) --clear-criteria --label --set-context` |
| `delete-node` | 软删除；有引用边时默认拒绝 | `-i [--cascade]` |
| `delete-edge` | 软删除边 | `-i` |
| `status` | 总览 + topo 检查 | `[--json]` |
| `validate` | schema + 引用 + topo + 环（逐文件 schema 校验） | `[--json]` |
| `next` | 调度决策：ready / ready_eligible / blocked / running / stale | `[--stale-ms N] [--json]` |
| `verdict` | 记录裁决结论（Super Mario 用） | `-i --verdict passed|failed|pending [--note]` |
| `snapshot` | 版本快照 | `[-m msg] [--git]` |
| `snapshots` | 快照列表 | `[--json]` |
| `diff` | 差异对比（默认最新快照 vs 当前） | `[--from id] [--to id] [--json]` |
| `rollback` | 回滚（自动备份，必须 --confirm） | `<snapshot-id> [--confirm]` |
| `rebuild` | 重建 index/（graph.json 完整数据 + topology.dot） | — |
| `export --mermaid` | Mermaid 输出 | `-o <file>` |
| `serve` | Web UI（默认 8934，贯穿全程不关闭） | `-p <port>` |

**绝不发明参数**——跑 `graph <cmd> --help`。**每次结构改动后必跑 `graph validate`。**

## 3. 状态机（7 态）+ 三条硬规则

```text
pending → ready → running → passed → blocked
                         ↘ failed → pending (retry)
                         ↘ pending (reclaim 死认领回收，attempts 不变)
        any state → cancelled
        cancelled → pending (重开，attempts 归零)
        blocked → ready / failed / cancelled
```

| 转换 | 含义 | 记录 |
|------|------|------|
| `ready → running` | **claim**（必须带 `claim_by`；锁内原子，并发认领只有一个成功） | `assigned_to` + `started_at` |
| `running → passed` | 完成（需先有 execution_report） | `completed_at` |
| `running → failed` | 失败 | `completed_at` |
| `running → pending` | **回收死认领**（`graph reclaim` / `graph_reclaim_node`） | 清空 `assigned_to`，notes 附回收记录 |
| `failed → pending` | 重试；`attempts >= max_attempts(>0)` 时被拦截 | `attempts` +1 |
| `cancelled → pending` | **重开**（修复毒节点，attempts 归零） | — |
| `→ cancelled` | 终止（可重开，但会阻塞下游门禁——不要随手 cancel） | — |
| `blocked → ready/failed/cancelled` | 解除阻塞 | — |

**硬规则 1 — ready 门禁**：`pending → ready` 与 `ready → running` 会校验所有门控入边
（`depends_on` / `validates` / `fan_in` / `fan_out`）的前驱必须全部 `passed`。
不满足时工具报错并点名前驱（如 `Node b 前置未满足: [a(pending, via depends_on)]`）。
这不是 bug——修正依赖顺序。`--force` 仅人类运维可用，**agent 绝不使用**。

**硬规则 2 — max_attempts**：`attempts >= max_attempts(>0)` 后 `failed → pending` 被拦截，
提示人工介入。重置必须显式：CLI `--reset-attempts` / MCP `reset_attempts: true`（写审计事件）；修改 `plan.description` 不再自动重置。
`max_attempts = 0` 表示不限重试。

**硬规则 3 — passed 硬门禁（v0.3）**：`running → passed` 由核心层强制校验：
1. `execution_report.summary` 非空（"无报告标 passed"会被直接拒绝）；
2. 无 `verification.verdict: failed` 裁决；
3. 有 checkpoints 时全部 `passed`/`skipped`（failed 或未完成都会被拒绝）。
`--force` 仅人类运维可用。

**checkpoint 状态机**：`pending → running|passed|failed|skipped`、`running → passed|failed`、
`passed|failed|skipped → pending`（重开）。同状态重复上报幂等成功。

被拒绝的转换是状态机在保护你——修正顺序，不要硬来。

## 4. MCP 工具（19）——完整能力面

**调度首选**：

| 工具 | 用途 | 注意 |
|------|------|------|
| `graph_get_next_actions` | **规划循环首选**：一次返回 ready / **ready_eligible**（门禁已满足的 pending/failed，转 ready 即可执行——冷启动入口）/ blocked(带未满足前驱) / running(带时长) / stale_running | `stale_ms` 默认 30 分钟；每桶 `limit` 默认 100，`truncated: true` 表示还有更多；`assigned_to` 可过滤 running |

**读**：

| 工具 | 用途 | 注意 |
|------|------|------|
| `graph_get_node` | 读节点 + `allowed_transitions` + `checkpoint_aggregate` + `ready_gate` | 一次回答"这节点下一步能干什么"；`include_neighbors: up\|down` 附拓扑邻居 |
| `graph_get_graph` | 图拓扑 + 邻接（索引缓存加速）。默认 **summary 模式**（紧凑节点字段），`mode: full` 返回完整内容 | full 模式用 `offset/limit` 分页（每页默认 200）；大图先 summary 再按需解压 |
| `graph_traverse` | 遍历邻居 | `direction`、`max_depth`、`max_nodes`（默认 200）；返回 `{nodes, truncated}` |
| `graph_search` | 过滤节点 | `query, status, type, assigned_to, level, limit`（默认 50）；返回 `{total, limit, nodes}` 紧凑字段 |

**写（设计期）**：

| 工具 | 用途 | 注意 |
|------|------|------|
| `graph_create_node` | 建节点，**一次可带 plan/DoD/checkpoints 完整压缩包** | 重复 id 报错，绝不覆盖 |
| `graph_batch_create` | 批量建 nodes+edges（先全量预校验报全部冲突，再写盘） | **每批 ≤200 个节点**，大图分段；写盘中途崩溃 → 重跑报冲突清单 |
| `graph_add_edge` | 建边（核心层校验端点存在） | — |
| `graph_update_node` | 编辑 plan/DoD/checkpoints/assignee/label/max_attempts | `reset_attempts: true` 显式重置（写审计事件），改 plan 不重置 |
| `graph_update_graph` | 编辑 entry/exit/验收标准/root_context | 不再手写 graph.yaml |
| `graph_delete_node` | 软删除；有引用边默认拒绝 | `cascade: true` 连边一起删 |
| `graph_delete_edge` | 软删除边 | — |

**写（执行期）**：

| 工具 | 用途 | 注意 |
|------|------|------|
| `graph_update_node_status` | 状态流转；**claim = `status:"running"` + `claim_by`**；并发认领原子，败者收到"已被认领" | `force` 仅人类运维，agent 禁用 |
| `graph_update_checkpoint` | 上报一个 checkpoint（checkpoint 状态机校验，幂等） | 完成即报，绝不攒到最后 |
| `graph_update_execution_report` | 交接单；可选 `verification:{verdict,note}` 写裁决结论 | `artifacts` 填真实路径；**verdict 写在 passed 之前** |
| `graph_reclaim_node` | 回收死认领：running → pending（清空 assigned_to + 回收记录） | stale 且执行者不可达时使用；只有 running 节点可回收 |

**版本控制**：

| 工具 | 用途 | 注意 |
|------|------|------|
| `graph_snapshot` | 创建快照 | `message` 建议填写 |
| `graph_diff` | 差异对比（默认最新快照 vs 当前） | 返回增删改文件 + 状态变化 |
| `graph_rollback` | 回滚（自动备份当前状态） | 必须 `confirm: true` |

**绝不绕过工具手改 YAML 伪造状态。绝不 claim 非 ready 节点。绝不传 force。**

## 5. 脚本（7 个，无 MCP 客户端时的执行工具）

路径：`.pi/skills/plumber-execute/scripts/`（全局版 `~/.pi/agent/skills/plumber-execute/scripts/`）。
全部是核心引擎的薄包装（`sp-core.mjs` 统一加载公开 API），跨平台（Windows/macOS/Linux），
状态机/门禁/次数上限在核心层强制。

| 脚本 | 用法 | 说明 |
|------|------|------|
| `sp-claim.mjs` | `node sp-claim.mjs <node_id> <claim_by>` | ready→running 原子认领；非 ready 被状态机拦截 |
| `sp-checkpoint.mjs` | `node sp-checkpoint.mjs <node_id> <cp_id> <status>` | 上报一个 checkpoint（幂等） |
| `sp-report.mjs` | `node sp-report.mjs <node_id> <summary> [artifacts.csv] [blockers.csv] [notes]` | 提交 execution_report |
| `sp-get-node.mjs` | `node sp-get-node.mjs <node_id>` | 输出节点完整 JSON |
| `sp-update-status.mjs` | `node sp-update-status.mjs <node_id> <status> [--force]` | 状态流转（含门禁） |
| `sp-traverse.mjs` | `node sp-traverse.mjs <node_id> [downstream\|upstream\|both] [depth]` | 遍历邻居 |

## 6. 并行决策细则

### 6.1 结构判读（`graph_get_next_actions` / `graph_get_graph` 的结果怎么看）

- **ready 列表** → 可认领（门禁已由核心层验证，直接 claim）
- **ready_eligible 列表** → 门禁已满足的 pending/failed 节点，转 ready 即可执行（冷启动第一步从这里拿入口节点）
- **blocked 列表** → 每个节点附 `unmet`（未满足前驱 + 当前状态），补齐后自然放行
- **fan_out 批**：一个节点有多条 fan_out 出边 → 这些目标节点并行候选（前驱 passed 后全部 ready）
- **fan_in 汇聚**：汇聚节点必须等全部上游 passed（核心层门禁强制执行）
- **主链**：depends_on/validates 串行段，逐个执行

### 6.2 联合条件（全部满足才并行）

1. ≥2 个 `ready` 且互无依赖边
2. 工作量值得（每个节点 > 几轮工具调用）
3. 不共享冲突上下文（同文件/同端口的写操作 = 冲突；共享只读输入 OK）
4. 并行数 ≤ 3

### 6.3 并行执行方式

- 每 subagent 独立 claim（claim_by 区分）→ 独立 checkpoint/report
- **并发认领是原子的**：同一节点只有第一个 claim 成功，其余收到"already claimed by X"
- 主 agent 在 fan_in 汇合点统一 verify：上游全 passed + 报告齐备 → 才 claim 汇聚节点
- 并行中任何节点 failed → 主 agent 收回处理（重试或上报用户）

## 7. 三层验收细则

| 层 | 命令/手段 | 通过标准 |
|----|-----------|---------|
| 状态层 | `graph next --json` / `graph status --json` | 所有 **task 节点** passed；无 failed/blocked/pending 残留 |
| 结构层 | `graph validate` | 0 error（0 warning 更佳；schema 拼错也会被抓出） |
| 成果层 | 逐条核对 `exit.acceptance_criteria` | 每条有**真实 artifact** 佐证：文件存在、内容匹配（用 `ls`/`read` 抽查，不信报告文本） |

**成果层是验收的灵魂**：execution_report 的 summary 是自述，artifact 是可核验的事实。报告里写"已完成 X"但 X 文件不存在 = 未完成。

## 8. 错误处理——读错误，再行动

| 报错 | 含义 | 修法 |
|------|------|------|
| `MCP error -32602: Input validation error` | 缺必填参数 | 补上字段 |
| `-32602 ... expected one of ...` | 非法枚举 | 用表内值 |
| `Invalid transition: X → Y. Allowed: [...]` | 状态机顺序违反 | 走允许路径 |
| `Node X 前置未满足，不能进入 ready/running: [...]` | ready 门禁拦截 | 先完成前驱；**不要用 force** |
| `Node X already claimed by Y` | 并发认领竞争失败（原子保护） | 换一个 ready 节点认领 |
| `Node X 已达最大重试次数` | attempts 用尽 | 人工介入；或改 plan（attempts 自动归零） |
| `Node X 无执行报告，不能标记 passed` | passed 硬门禁（规则 3） | 先填 execution_report；force 仅人类 |
| `Node X 存在未完成 checkpoint，不能标记 passed` | passed 硬门禁（规则 3） | 补完 checkpoint 再 passed |
| `Node X 已有 failed 裁决，不能标记 passed` | passed 硬门禁（规则 3） | 修复缺陷，重新 verdict 后 passed |
| `Node X 当前状态为 Y，只有 running 节点可回收` | reclaim 目标错误 | 只对 running 节点用 `graph reclaim` |
| `Node X 被 N 条边引用` | 删除会留悬挂引用 | `--cascade` 或先删边 |
| `schema 校验失败: ...` | 手改 YAML 拼错字段 | 按提示修正；`graph validate` 定位文件 |
| `ENOENT ... .graph/graph.yaml` | 未 init（或 cwd 不对） | `graph init` / cd 到正确目录 |
| `Node X not found` / `Edge X not found` | id 不存在 | `graph_search` 查 |
| `already exists` | 重复 id | 换新 id |
| 脚本无法定位核心 | 未安装 super-plumber | `npm install -g @lukawi/super-plumber` |

**绝不忽略工具错误继续假装成功。** 安静的假成功比响亮的失败更糟。

## 9. 红线——STOP

- 手改 YAML 跳过状态机/门禁
- 使用 `force` 绕开门禁或 max_attempts（仅人类运维可用）
- validate 失败继续走
- 编造工具名/参数（读表或 `--help`）
- fan_in 汇聚点未等齐上游
- 并行数超 3 且无验收计划
- 只跑 validate 就宣告完成（必须三层验收，成果层抽查真实 artifact）
