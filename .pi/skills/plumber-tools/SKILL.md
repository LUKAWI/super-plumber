---
name: plumber-tools
description: 拓扑图管理工具操作指南。用于管理工作流拓扑图的节点、边、状态和检查点。包含 CLI 命令、MCP 工具使用、执行 agent 与 Super Mario 的协作协议（claim/checkpoint/execution_report/裁决）。
---

# Topo-Graph：拓扑图管理工具

本技能教您如何高效操作工作流拓扑图工具（`graph` CLI 及辅助脚本）。

## 目录结构

```
.graph/                     # 拓扑图根目录
├── graph.yaml              # 图定义（入口/出口/根上下文）
├── nodes/*.yaml            # 节点文件
└── edges/*.yaml            # 边文件
```

## CLI 命令

```bash
# 初始化新图
graph init -l "项目名称"

# 创建节点
graph create-node --id task_001 --type task --label "节点标签" --level 1

# 添加边
graph add-edge --id e001 --source task_001 --target task_002 --type depends_on

# 查看状态
graph status

# 导出 Mermaid
graph export --mermaid -o topology.mmd
```

## 辅助脚本（推荐）

除了 CLI 外，本 skill 提供了更便捷的脚本，适合快速操作：

### 读取节点

```bash
# 快速读取节点全部内容
.pi/skills/plumber-tools/scripts/graph-get-node.sh <node_id>
```

### 更新节点状态（含状态机校验）

```bash
.pi/skills/plumber-tools/scripts/graph-update-status.sh <node_id> <new_status>
```

脚本会自动校验状态转换的合法性，非法转换会报错。

### 遍历拓扑图

```bash
# 下游遍历（默认）
.pi/skills/plumber-tools/scripts/graph-traverse.sh task_001

# 上游遍历
.pi/skills/plumber-tools/scripts/graph-traverse.sh task_001 upstream

# 双向遍历，深度 5
.pi/skills/plumber-tools/scripts/graph-traverse.sh task_001 both 5
```

## MCP 工具（高级）

如果 `graph-mcp` 服务器正在运行，可以通过 MCP 协议直接调用拓扑工具。MCP 工具自带参数校验，比 CLI 更安全、更快。

```bash
# 启动 MCP 服务器（后台运行，在工作目录启动，作用于该目录的 .graph/）
graph-mcp
```

启动后，agent 通过 MCP 客户端直接调用工具（参数名与 inputSchema 一致）。

可用 MCP 工具（9 个）：
| 工具 | 功能 | 必填参数 |
|------|------|----------|
| `graph_get_node` | 读取单个节点 | id |
| `graph_create_node` | 创建节点 | id, label |
| `graph_update_node_status` | 更新节点状态（claim语义：status=running时传claim_by） | id, status |
| `graph_update_checkpoint` | 执行agent上报checkpoint进度 | node_id, checkpoint_id, status |
| `graph_update_execution_report` | 执行agent填写交接单 | node_id, summary |
| `graph_delete_node` | 软删除节点 | id |
| `graph_get_graph` | 获取完整图拓扑 | — |
| `graph_traverse` | 遍历相邻节点 | node_id |
| `graph_search` | 按条件搜索节点 | — |

### MCP 参数校验行为

所有工具由 zod schema 驱动校验。**非法或缺参调用返回协议错误** `MCP error -32602: Input validation error`（isError=true），LLM 能读到错误并自纠。常见失败：
- 缺必填参数 → `expected string, received undefined at <field>`
- 非法枚举 → 如 status 传了 `bogus`，direction 传了 `sideways`
- 类型错误 → 如 summary 传了数字而非字符串

## 执行 agent 协作协议（claim → checkpoint → report → 裁决）

拓扑工作流由**执行 agent**（干活）和 **Super Mario**（裁决）协作驱动。职责分离：执行 agent 只报进度，Super Mario 裁决节点状态。

```
执行 agent:  claim(ready→running) → 干活 → 逐个报 checkpoint → 填 execution_report
Super Mario: 读取 execution_report → 抽查 artifacts → 裁决 passed/failed/blocked
```

### 执行 agent 的操作序列

1. **认领**：`graph_update_node_status {id, status: "running", claim_by: "<agent名>"}`
   - 自动记录 assigned_to + execution_report.started_at
2. **干活**：按节点 plan / checkpoints 执行任务
3. **报进度**：每个子步骤完成即调用 `graph_update_checkpoint {node_id, checkpoint_id, status}`
   - checkpoint 状态：pending → running → passed/failed/skipped
   - **做完一个就报一个，不要攒到结束**（渐进式同步，防止丢失进度）
4. **填交接单**：`graph_update_execution_report {node_id, summary, artifacts, blockers, notes}`
   - artifacts 列出产物路径（Super Mario 据此抽查）
   - blockers 说明阻塞原因
5. **召唤裁决**：通知 Super Mario 检查 execution_report 并裁决

### Super Mario 的裁决依据

1. checkpoint 聚合：全部 passed 才进入抽查；任一 failed → 节点 failed
2. 输出抽查：检查 `execution_report.artifacts` 中的产物是否真实存在、是否满足 `expected_outcome.definition_of_done`
3. 裁决：passed → 推进下游；failed → 重试管理（attempts < max_attempts 则重试，否则人工介入）

## 节点状态机

```
pending → ready → running → passed → blocked
                         ↘ failed → pending (重试)
                                   → cancelled
        任意状态 → cancelled
        blocked → ready / failed / cancelled
```

## 边类型

| 类型 | 含义 | 参与拓扑排序 |
|------|------|:----------:|
| depends_on | 顺序依赖 | ✅ |
| validates | 验证关系 | ✅ |
| shares_context | 上下文共享 | ❌ |
| fallback | 回退 | ❌ |
| iterates | 迭代优化 | ❌ |
