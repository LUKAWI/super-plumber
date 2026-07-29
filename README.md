# TopoGraph — 工作流拓扑图管理工具

> 将任务文档和工作流重构为 agent 可原生理解的拓扑结构。  
> CLI + MCP Server + Web UI 三层访问。

```bash
npm install -g topological-tool
```

---

## 快速开始

```bash
# 在当前项目初始化拓扑图
graph init -l "我的项目"

# 创建节点
graph create-node --id task_001 --type task --label "调研需求" --level 1

# 添加依赖边
graph add-edge --id e001 --source task_001 --target task_002 --type depends_on

# 查看状态
graph status

# 启动 Web 可视化界面
graph serve
# 打开 http://localhost:8934
```

---

## CLI 命令

| 命令 | 功能 |
|------|------|
| `init` | 初始化 `.graph/` 目录结构 |
| `create-node` | 创建新节点 |
| `add-edge` | 在节点之间添加边 |
| `update-status` | 更新节点状态（状态机校验） |
| `delete-node` | 软删除节点（保留 `.deleted.yaml` 历史） |
| `status` | 显示拓扑图状态概览 |
| `validate` | 校验图结构完整性 |
| `rebuild` | 从源文件重建 `index/` 派生索引 |
| `export --mermaid` | 导出 Mermaid 流程图 |
| `serve` | 启动 Web UI 可视化服务（端口 8934） |

### 节点状态机

```
pending → ready → running → passed → blocked
                         ↘ failed → pending (重试)
                                   → cancelled
        任意状态 → cancelled
        blocked → ready / failed / cancelled
```

### 边类型

| 类型 | 含义 |
|------|------|
| `depends_on` | 顺序依赖（参与拓扑排序） |
| `validates` | 验证关系（参与拓扑排序） |
| `shares_context` | 上下文共享 |
| `fan_out` | 并行分发 |
| `fan_in` | 扇入合并 |
| `fallback` | 回退 |
| `iterates` | 迭代优化 |

---

## MCP Server（Agent 访问）

启动 MCP 服务器供 coding agent 调用：

```bash
graph-mcp
```

Agent 通过 MCP 协议调用以下工具：

| 工具 | 功能 |
|------|------|
| `graph_get_node` | 读取节点全部内容 |
| `graph_create_node` | 创建节点 |
| `graph_update_node_status` | 更新节点状态 |
| `graph_delete_node` | 软删除节点 |
| `graph_get_graph` | 获取完整图拓扑 |
| `graph_traverse` | 遍历相邻节点 |
| `graph_search` | 按条件搜索节点 |

### MCP 配置

**Claude Code (`claude.json`):**
```json
{
  "mcpServers": {
    "topological-tool": {
      "command": "graph-mcp"
    }
  }
}
```

**Pi Agent:** 安装 `topological-tool` 后，MCP 工具自动可用。

---

## 存储结构

```
.graph/
├── graph.yaml         # 图定义（入口/出口/根上下文）
├── nodes/*.yaml       # 节点文件
├── edges/*.yaml       # 边文件
└── index/             # 派生索引（可重建）
    ├── graph.json
    └── meta.json
```

**设计原则：**
- **Git 是唯一真相源** — 所有数据以文件形式存在 Git 仓库
- **文件即节点** — 每个节点对应一个 YAML 文件
- **结构优先于文本** — YAML Schema 约束，拒绝自由 Markdown
- **纯文件系统** — 无需数据库

---

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 测试
npm test

# 开发模式
npm run dev
```

---

## Subagents（Pi Agent 专用）

项目内置 4 个专用 subagents，位于 `.pi/agents/`：

| Agent | 角色 | 用法 |
|-------|------|------|
| `graph-designer` | 拓扑图设计师 | `Use graph-designer to design a topology for: ...` |
| `graph-watchman` | 工作流监测员 | `Use graph-watchman to check workflow status` |
| `graph-steward` | 进度管家 | 更新节点状态和检查点 |
| `mario-verifier` | 验证员 | 校验节点输出是否符合预期 |

以及 `topo-graph` skill（`.pi/skills/topo-graph/`），加载后可通过脚本快捷操作。

---

## 项目状态

```
Tests:  54/54 ✅  |  CLI: 11 命令  |  MCP: 7 工具  |  Web UI: Svelte 5 + D3.js
```

## 许可

MIT
