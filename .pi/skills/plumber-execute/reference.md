# Plumber Execute Reference — 执行工具、状态机、并行细则、验收标准

本文件是 **plumber-execute** skill 的配套参考：执行期的所有工具与规则。流程协议（执行 5 步 + 并行决策 + 三层验收）见 SKILL.md；设计期规范见 plumber-design。

**一句话：工具会校验，错误是信号。绝不绕开校验假成功。**

---

## 1. 访问层——知道每层能干什么

| 层 | 用于 | 不能做 |
|----|------|--------|
| **CLI** `graph` | init、批量建节点/边、status、validate、rebuild、export、serve | claim / checkpoint / execution_report（仅 MCP/脚本） |
| **MCP** `graph_*`（9 工具） | 一切，含 claim 语义，zod 校验 | — |
| **脚本** `scripts/sp-*.mjs` | 无 MCP 客户端时的读/流转/claim/checkpoint/report | — |

> **绝不把 CLI 当 MCP 的替代品。** CLI 是子集——只用 CLI，claim/checkpoint/report 够不着，流程走不动。

## 2. CLI 命令（11）

| 命令 | 用途 | 关键参数 |
|------|------|---------|
| `init` | 建 `.graph/` 骨架 | `-l <label>` |
| `create-node` | 建节点 | `-i -l -t --level --plan-desc --dod(×N) --assigned-to` |
| `add-edge` | 建边 | `-i -s -t --type` |
| `update-status` | 状态机流转 | `-i -s` |
| `update-node` | 编辑 plan/DoD/checkpoints/assignee | `-i --plan-desc --add-dod --add-checkpoint --set-assigned --show` |
| `delete-node` | 软删除 | `-i` |
| `status` | 总览 + topo 检查 | — |
| `validate` | 完整性 + topo 排序 + 环 | — |
| `rebuild` | 重建 `index/` | — |
| `export --mermaid` | Mermaid 输出 | `-o <file>` |
| `serve` | Web UI（默认 8934，贯穿全程不关闭） | `-p <port>` |

**绝不发明参数**——跑 `graph <cmd> --help`。**每次结构改动后必跑 `graph validate`。**

## 3. 状态机（7 态）

```text
pending → ready → running → passed → blocked
                         ↘ failed → pending (retry)
        any state → cancelled (terminal)
        blocked → ready / failed / cancelled
```

| 转换 | 含义 | 记录 |
|------|------|------|
| `ready → running` | **claim**（必须带 `claim_by`） | `assigned_to` + `started_at` |
| `running → passed` | 完成（需先有 execution_report） | `completed_at` |
| `running → failed` | 失败 | `completed_at` |
| `failed → pending` | 重试 | `attempts` +1（到 `max_attempts` 停） |
| `→ cancelled` | 终止（terminal，不可恢复） | — |
| `blocked → ready/failed/cancelled` | 解除阻塞 | — |

被拒绝的转换是状态机在保护你——修正顺序，不要硬来。

## 4. MCP 工具（9）——完整能力面

| 工具 | 用途 | 必填 | 注意 |
|------|------|------|------|
| `graph_get_node` | 读节点 | `id` | — |
| `graph_create_node` | 建节点 | `id, label` | 重复 id → 报错，绝不覆盖 |
| `graph_update_node_status` | 状态流转；**claim = `status:"running"` + `claim_by`** | `id, status` | 必须遵循状态机顺序 |
| `graph_update_checkpoint` | 上报 checkpoint 进度 | `node_id, checkpoint_id, status` | 一次一个，完成即报 |
| `graph_update_execution_report` | 提交交接报告 | `node_id, summary` | + `artifacts, blockers, notes` |
| `graph_delete_node` | 软删除 | `id` | 不存在的 id → 报错，不是假成功 |
| `graph_get_graph` | 全拓扑 + 邻接 | — | 并行决策第一步看结构用它 |
| `graph_traverse` | 遍历邻居 | `node_id` | `direction: downstream\|upstream\|both`，`max_depth` |
| `graph_search` | 过滤节点 | — | `query, status, type, assigned_to` |

**绝不绕过工具手改 YAML 伪造状态。绝不 claim 非 ready 节点。**

## 5. 脚本（6 个，无 MCP 客户端时的执行工具）

路径：`.pi/skills/plumber-execute/scripts/`（全局版 `~/.pi/agent/skills/plumber-execute/scripts/`）。全部是核心引擎的薄包装，状态机在核心层强制。

| 脚本 | 用法 | 说明 |
|------|------|------|
| `sp-claim.mjs` | `node sp-claim.mjs <node_id> <claim_by>` | ready→running，记录 assigned_to + started_at；非 ready 被状态机拦截 |
| `sp-checkpoint.mjs` | `node sp-checkpoint.mjs <node_id> <cp_id> <status>` | 上报一个 checkpoint（pending/running/passed/failed/skipped） |
| `sp-report.mjs` | `node sp-report.mjs <node_id> <summary> [artifacts.csv] [blockers.csv] [notes]` | 提交 execution_report；artifacts 逗号分隔真实路径 |
| `sp-update-status.sh` | `./sp-update-status.sh <node_id> <status>` | 状态机校验的状态流转 |
| `sp-get-node.sh` | `./sp-get-node.sh <node_id>` | 输出一个节点的完整 YAML |
| `sp-traverse.sh` | `./sp-traverse.sh <node_id> [upstream\|both] [depth]` | 遍历邻居（默认下游） |

## 6. 并行决策细则

### 6.1 结构判读（graph_get_graph 的结果怎么看）

- **fan_out 批**：一个节点有多条出边指向不同节点（type=fan_out）→ 这些目标节点并行候选
- **fan_in 汇聚**：一个节点有多条入边来自不同节点（type=fan_in）→ 汇聚节点必须等全部上游 passed
- **shares_context 组**：共享上下文、可并行的节点组
- **主链**：depends_on/validates 串行段，逐个执行

### 6.2 联合条件（全部满足才并行）

1. ≥2 个 `ready` 且互无依赖边
2. 工作量值得（每个节点 > 几轮工具调用）
3. 不共享冲突上下文（同文件/同端口的写操作 = 冲突；共享只读输入 OK）
4. 并行数 ≤ 3

### 6.3 并行执行方式

- 每 subagent 独立 claim（claim_by 区分）→ 独立 checkpoint/report
- 主 agent 在 fan_in 汇合点统一 verify：上游全 passed + 报告齐备 → 才 claim 汇聚节点
- 并行中任何节点 failed → 主 agent 收回处理（重试或上报用户）

## 7. 三层验收细则

| 层 | 命令/手段 | 通过标准 |
|----|-----------|---------|
| 状态层 | `graph status` / `graph_search {status: passed}` | 所有 **task 节点** passed；无 failed/blocked/pending 残留（entry/exit 虚拟节点不执行，保持 pending 正常） |
| 结构层 | `graph validate` | 0 error（0 warning 更佳） |
| 成果层 | 逐条核对 `exit.acceptance_criteria` | 每条有**真实 artifact** 佐证：文件存在、内容匹配（用 `ls`/`read` 抽查，不信报告文本） |

**成果层是验收的灵魂**：execution_report 的 summary 是自述，artifact 是可核验的事实。报告里写"已完成 X"但 X 文件不存在 = 未完成。

## 8. 错误处理——读错误，再行动

| 报错 | 含义 | 修法 |
|------|------|------|
| `MCP error -32602: Input validation error` + `expected string, received undefined` | 缺必填参数 | 补上字段 |
| `-32602 ... expected one of "pending"\|"ready"\|...` | 非法枚举 | 用表内值 |
| `Invalid transition: X → Y. Allowed: [...]` | 状态机顺序违反 | 走允许路径 |
| `ENOENT ... .graph/graph.yaml` | 未 init（或 cwd 不对） | `graph init` / cd 到正确目录 |
| `Node X not found` | id 不存在 | `graph_search` 查 |
| `Node X already exists` / `Edge X already exists` | 重复 id | 换新 id |
| 脚本 `npm root -g` 定位失败 | 全局未装 super-plumber | `npm install -g @lukawi/super-plumber` |

**绝不忽略工具错误继续假装成功。** 安静的假成功比响亮的失败更糟。

## 9. 红线——STOP

- 只用 CLI 跑流程（claim/report 够不着）
- 手改 YAML 跳过状态机
- validate 失败继续走
- 编造工具名/参数（读表或 `--help`）
- fan_in 汇聚点未等齐上游
- 并行数超 3 且无验收计划
