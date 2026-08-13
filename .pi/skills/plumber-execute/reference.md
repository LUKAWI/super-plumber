# Plumber Execute Reference — 执行工具、状态机、并行细则、验收标准

本文件是 **plumber-execute** skill 的配套参考：执行期的所有工具与规则。流程协议（执行 5 步 + 并行决策 + 三层验收）见 SKILL.md；设计期规范见 plumber-design。

**一句话：工具会校验，错误是信号。绝不绕开校验假成功。**

---

## 1. 访问层——知道每层能干什么

| 层 | 用于 | 不能做 |
|----|------|--------|
| **CLI** `graph`（19 命令） | init、批量建节点/边、status、validate、next、verdict、snapshot/diff/rollback、export、serve | —（v0.2 起 claim/checkpoint/report 也可用 CLI/脚本） |
| **MCP** `graph_*`（18 工具） | 一切（设计 + 执行 + 裁决 + 版本），zod 校验 | 不得传 `force: true`（仅人类运维） |
| **脚本** `scripts/sp-*.mjs`（7 个） | 无 MCP 客户端时的读/流转/claim/checkpoint/report/遍历 | — |

> 首选 MCP（覆盖最全、校验最强）；无 MCP 客户端时用 CLI + 脚本。

## 2. CLI 命令（19）

| 命令 | 用途 | 关键参数 |
|------|------|---------|
| `init` | 建 `.graph/` 骨架（含 schema.yaml） | `-l <label>` `--force` |
| `create-node` | 建节点（可一次带完整压缩包） | `-i -l -t --level --plan-desc --dod(×N) --assigned-to --max-attempts` |
| `get-node` | 读节点 + 合法转换 + 门禁状态 | `-i [--json]` |
| `add-edge` | 建边（核心层校验端点存在） | `-i -s -t --type` |
| `update-status` | 状态机流转（含 ready 门禁/max_attempts） | `-i -s [--claim-by <agent>] [--force]` |
| `update-node` | 编辑 plan/DoD/checkpoints/assignee/label/max_attempts | `-i --plan-desc --add-dod --clear-dod --add-checkpoint --set-assigned --label --max-attempts --show` |
| `update-graph` | 编辑图级字段（entry/exit/验收标准），不再手写 graph.yaml | `--entry-desc --exit-desc --add-criteria(×N) --clear-criteria --label --set-context` |
| `delete-node` | 软删除；有引用边时默认拒绝 | `-i [--cascade]` |
| `delete-edge` | 软删除边 | `-i` |
| `status` | 总览 + topo 检查 | `[--json]` |
| `validate` | schema + 引用 + topo + 环（逐文件 schema 校验） | `[--json]` |
| `next` | 调度决策：可认领/等依赖/执行中/疑似卡住 | `[--stale-ms N] [--json]` |
| `verdict` | 记录裁决结论（Super Mario 用） | `-i --verdict passed|failed|pending [--note]` |
| `snapshot` | 版本快照 | `[-m msg] [--git]` |
| `snapshots` | 快照列表 | `[--json]` |
| `diff` | 差异对比（默认最新快照 vs 当前） | `[--from id] [--to id] [--json]` |
| `rollback` | 回滚（自动备份，必须 --confirm） | `<snapshot-id> [--confirm]` |
| `rebuild` | 重建 index/（graph.json 完整数据 + topology.dot） | — |
| `export --mermaid` | Mermaid 输出 | `-o <file>` |
| `serve` | Web UI（默认 8934，贯穿全程不关闭） | `-p <port>` |

**绝不发明参数**——跑 `graph <cmd> --help`。**每次结构改动后必跑 `graph validate`。**

## 3. 状态机（7 态）+ 两条硬规则

```text
pending → ready → running → passed → blocked
                         ↘ failed → pending (retry)
        any state → cancelled (terminal)
        blocked → ready / failed / cancelled
```

| 转换 | 含义 | 记录 |
|------|------|------|
| `ready → running` | **claim**（必须带 `claim_by`；锁内原子，并发认领只有一个成功） | `assigned_to` + `started_at` |
| `running → passed` | 完成（需先有 execution_report） | `completed_at` |
| `running → failed` | 失败 | `completed_at` |
| `failed → pending` | 重试；`attempts >= max_attempts(>0)` 时被拦截 | `attempts` +1 |
| `→ cancelled` | 终止（terminal，不可恢复） | — |
| `blocked → ready/failed/cancelled` | 解除阻塞 | — |

**硬规则 1 — ready 门禁**：`pending → ready` 与 `ready → running` 会校验所有门控入边
（`depends_on` / `validates` / `fan_in` / `fan_out`）的前驱必须全部 `passed`。
不满足时工具报错并点名前驱（如 `Node b 前置未满足: [a(pending, via depends_on)]`）。
这不是 bug——修正依赖顺序。`--force` 仅人类运维可用，**agent 绝不使用**。

**硬规则 2 — max_attempts**：`attempts >= max_attempts(>0)` 后 `failed → pending` 被拦截，
提示人工介入。修改 `plan.description` 会自动把 attempts 重置为 0（CONTEXT 规则）。
`max_attempts = 0` 表示不限重试。

**checkpoint 状态机**：`pending → running|passed|failed|skipped`、`running → passed|failed`、
`passed|failed|skipped → pending`（重开）。同状态重复上报幂等成功。

被拒绝的转换是状态机在保护你——修正顺序，不要硬来。

## 4. MCP 工具（18）——完整能力面

**调度首选**：

| 工具 | 用途 | 注意 |
|------|------|------|
| `graph_get_next_actions` | **规划循环首选**：一次返回 ready / blocked(带未满足前驱) / running(带时长) / stale_running | `stale_ms` 默认 30 分钟 |

**读**：

| 工具 | 用途 | 注意 |
|------|------|------|
| `graph_get_node` | 读节点 + `allowed_transitions` + `checkpoint_aggregate` + `ready_gate` | 一次回答"这节点下一步能干什么" |
| `graph_get_graph` | 全拓扑 + 邻接（可命中 index 缓存） | 看 fan_out/fan_in 结构 |
| `graph_traverse` | 遍历邻居 | `direction: downstream\|upstream\|both`，`max_depth` |
| `graph_search` | 过滤节点 | `query, status, type, assigned_to, level` |

**写（设计期）**：

| 工具 | 用途 | 注意 |
|------|------|------|
| `graph_create_node` | 建节点，**一次可带 plan/DoD/checkpoints 完整压缩包** | 重复 id 报错，绝不覆盖 |
| `graph_batch_create` | 批量建 nodes+edges（先全量预校验报全部冲突，再写盘） | 写盘中途崩溃 → 重跑报冲突清单 |
| `graph_add_edge` | 建边（核心层校验端点存在） | — |
| `graph_update_node` | 编辑 plan/DoD/checkpoints/assignee/label/max_attempts | 改 plan 会重置 attempts |
| `graph_update_graph` | 编辑 entry/exit/验收标准/root_context | 不再手写 graph.yaml |
| `graph_delete_node` | 软删除；有引用边默认拒绝 | `cascade: true` 连边一起删 |
| `graph_delete_edge` | 软删除边 | — |

**写（执行期）**：

| 工具 | 用途 | 注意 |
|------|------|------|
| `graph_update_node_status` | 状态流转；**claim = `status:"running"` + `claim_by`**；并发认领原子，败者收到"已被认领" | `force` 仅人类运维，agent 禁用 |
| `graph_update_checkpoint` | 上报一个 checkpoint（checkpoint 状态机校验，幂等） | 完成即报，绝不攒到最后 |
| `graph_update_execution_report` | 交接单；可选 `verification:{verdict,note}` 写裁决结论 | `artifacts` 填真实路径 |

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
