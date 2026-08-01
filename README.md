# TopoGraph — 工作流拓扑图管理工具

> 将任务文档和工作流重构为 agent 可原生理解的拓扑结构（节点/边/状态机）。
> CLI + MCP Server + Web UI 三层访问，纯 YAML 文件存储（无数据库）。
>
> **English:** [README.en.md](README.en.md)

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

## CLI 命令（11 个）

| 命令 | 功能 |
|------|------|
| `init` | 初始化 `.graph/` 目录结构 |
| `create-node` | 创建新节点 |
| `add-edge` | 在节点之间添加边 |
| `update-status` | 更新节点状态（状态机校验） |
| `update-node` | 更新节点详细内容（plan / expected_outcome / checkpoints） |
| `delete-node` | 软删除节点（保留 `.deleted.yaml` 历史） |
| `status` | 显示拓扑图状态概览 |
| `validate` | 校验图结构完整性（引用完整性 + 拓扑排序 + 循环检测） |
| `rebuild` | 从源文件重建 `index/` 派生索引 |
| `export --mermaid` | 导出 Mermaid 流程图 |
| `serve` | 启动 Web UI 可视化服务（端口 8934） |

### 节点状态机

```text
pending → ready → running → passed → blocked
                         ↘ failed → pending (重试)
                任意状态 → cancelled（终止态）
        blocked → ready / failed / cancelled
```

- **claim 语义**：`update-status --status running` 记录执行者与 `started_at`
- **完成记录**：节点转为 `passed`/`failed` 时自动记录 `completed_at`
- **重试**：`failed → pending` 自动累加 `attempts`

### 边类型（7 种）

| 类型 | 含义 | 拓扑排序参与 |
|------|------|:---:|
| `depends_on` | 顺序依赖 | ✅ |
| `validates` | 验证关系 | ✅ |
| `shares_context` | 上下文共享 | ❌ |
| `fan_out` | 并行分发 | ❌ |
| `fan_in` | 扇入合并 | ❌ |
| `fallback` | 失败回退 | ❌ |
| `iterates` | 迭代优化 | ❌ |

---

## MCP Server（Agent 访问）

启动 MCP 服务器供 coding agent 调用：

```bash
graph-mcp
```

### 工具列表（9 个）

| 工具 | 功能 | 参数 |
|------|------|------|
| `graph_get_node` | 读取节点全部内容 | `id` |
| `graph_create_node` | 创建节点 | `id, label` |
| `graph_update_node_status` | 更新节点状态（claim 语义：`status=running` 时传 `claim_by`） | `id, status` |
| `graph_update_checkpoint` | 执行 agent 上报 checkpoint 进度 | `node_id, checkpoint_id, status` |
| `graph_update_execution_report` | 执行 agent 填写交接单 | `node_id, summary, artifacts, blockers, notes` |
| `graph_delete_node` | 软删除节点 | `id` |
| `graph_get_graph` | 获取完整图拓扑（节点+边+邻接表） | — |
| `graph_traverse` | 从节点出发遍历相邻节点 | `node_id, direction, max_depth` |
| `graph_search` | 按条件搜索节点 | `query, status, type, assigned_to` |

参数由 zod schema 驱动校验：缺参 / 非法枚举返回协议错误 `-32602`（`isError=true`），状态机非法转换同样返回明确错误，绝不静默失败。

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

---

## Web UI（Svelte 5 + D3.js）

`graph serve` 后访问 `http://localhost:8934`：

- **力导向图**：缩放/平移/自动适配，按状态着色
- **边类型可视化**：7 种边类型不同颜色，悬停高亮
- **光点流动**：running 节点的下游边显示光点流动动画
- **checkpoint 进度条**：节点下方展示子步骤完成进度
- **执行者标签**：running 节点旁显示 `assigned_to`
- **WebSocket 增量推送**：节点变更推送 `node:updated` 增量（非全量），浏览器断开时自动 HTTP 回退

---

## 存储结构

```text
.graph/
├── graph.yaml         # 图定义（入口/出口/根上下文 + nodes/edges 引用列表）
├── nodes/*.yaml       # 节点文件（压缩包：plan / checkpoints / execution_report）
├── edges/*.yaml       # 边文件
├── snapshots/         # 版本快照（预留）
└── index/             # 派生索引（可重建，不纳入版本控制）
    ├── graph.json
    └── meta.json
```

**设计原则：**

- **Git 是唯一真相源** — 所有数据以文件形式存在 Git 仓库，`index/` 可删除重建
- **文件即节点** — 每个节点对应一个 YAML 文件
- **结构优先于文本** — YAML Schema 约束，拒绝自由 Markdown
- **纯文件系统** — 无需数据库；软删除保留 `.deleted.yaml` 历史

---

## 开发

```bash
# 安装依赖
npm install

# 构建（后端 + 前端）
npm run build && cd web-ui && npm run build

# 测试
npm test

# 开发模式
npm run dev
```

---

## Subagents（Pi Agent 专用）

项目内置 2 个专用 subagents，位于 `.pi/agents/`：

| Agent | 角色 | 职责 |
|-------|------|------|
| `super-mario` | 拓扑主控 | 节点生命周期裁决（checkpoint 聚合 + 输出抽查）、重试管理、状态监测、进度同步检查 |
| `graph-designer` | 拓扑图设计师 | 将需求分解为结构化图拓扑，为每个节点制定 plan 和 definition_of_done |

以及 `topo-graph` skill（`.pi/skills/topo-graph/`），包含 MCP 工具表与执行 agent 协作协议（认领 → 报 checkpoint 进度 → 填交接单 → Super Mario 裁决）。

---

## 项目状态

```text
Tests:  78/78 ✅  |  CLI: 11 命令  |  MCP: 9 工具  |  Web UI: Svelte 5 + D3.js
```

## 许可

MIT
