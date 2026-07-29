---
name: topo-graph
description: 拓扑图管理工具操作指南。用于管理工作流拓扑图的节点、边、状态和检查点。包含 CLI 命令和辅助脚本。
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
.pi/skills/topo-graph/scripts/graph-get-node.sh <node_id>
```

### 更新节点状态（含状态机校验）

```bash
.pi/skills/topo-graph/scripts/graph-update-status.sh <node_id> <new_status>
```

脚本会自动校验状态转换的合法性，非法转换会报错。

### 遍历拓扑图

```bash
# 下游遍历（默认）
.pi/skills/topo-graph/scripts/graph-traverse.sh task_001

# 上游遍历
.pi/skills/topo-graph/scripts/graph-traverse.sh task_001 upstream

# 双向遍历，深度 5
.pi/skills/topo-graph/scripts/graph-traverse.sh task_001 both 5
```

## MCP 工具（高级）

如果 `graph-mcp` 服务器正在运行，可以通过 MCP 协议直接调用拓扑工具。MCP 工具的响应速度比 CLI 更快。

```bash
# 启动 MCP 服务器（后台运行）
graph-mcp
```

启动后，agent 可通过 `mcp({ tool: "graph_get_node", args: { id: "..." } })` 等方式调用。

可用 MCP 工具：
| 工具 | 功能 |
|------|------|
| `graph_get_node` | 读取单个节点 |
| `graph_create_node` | 创建节点 |
| `graph_update_node_status` | 更新节点状态 |
| `graph_get_graph` | 获取完整图拓扑 |
| `graph_traverse` | 遍历相邻节点 |
| `graph_search` | 搜索节点 |

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
