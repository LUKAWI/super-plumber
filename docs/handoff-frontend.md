# Handoff：TopoGraph 前端修复

> 下一阶段：独立修复和优化 Web UI（Svelte 5 + D3.js）前端的显示与样式。
> 生成时间：2026-07-29
> 当前会话不含 API 密钥、密码或个人身份信息。

---

## 会话概况

这是"拓扑图管理工具（TopoGraph）"项目的完整 MVP 构建会话。经过需求分析、质询、领域建模、编码实现，已交付一个可用的工作流拓扑图管理工具 v0.1.0。

**下一阶段任务：** 修复前端（`web-ui/`）的显示和样式问题。当前会话中已用 `impeccable` 技能做了一轮优化，但用户对效果不满意，需要在新会话中独立改动前端。

---

## 项目状态

| 维度 | 状态 |
|------|------|
| 后端 Core | ✅ 完成 |
| CLI (11 命令) | ✅ 完成 |
| MCP Server (7 工具) | ✅ 完成 |
| Web 后端 (serve) | ✅ 完成 |
| Web 前端 (Svelte + D3.js) | ⚠️ **需修复** ← 本 handoff 聚焦 |
| Subagents (4个) | ✅ 完成 |
| Skill (topo-graph) | ✅ 完成 |
| 测试 | 54/54 ✅ |
| 类型检查 | CLEAN ✅ |
| LSP 诊断 | 零诊断 ✅ |

---

## 项目仓库

```
位置: D:/LUKAWI/AI_project/projects/topological-tool/
Git:  master 分支，19 commits
Tag:  mvp-checkpoint（回滚点）
```

### 关键提交

| Commit | 内容 |
|--------|------|
| `8bf33eb` | 前端 NodeDetail 显示 plan/expected_outcome/checkpoints |
| `3df71f4` | GraphCanvas 响应式 + zoom/pan |
| `d5c5505` | 第一轮 impeccable 前端优化（动画/loading/empty） |
| `c8820af` | 初始 Svelte + D3.js Web UI |

### 完整 Commit 日志

```bash
git log --oneline
```

### 回滚方式

```bash
# 回到 MVP checkpoint
git reset --hard mvp-checkpoint
```

---

## 前端代码结构

完整的 Svelte 5 前端在 `web-ui/` 子目录下，独立 package.json，使用 Vite 构建。

```
web-ui/
├── package.json              # Svelte 5 + D3.js v7 + Vite 6
├── vite.config.ts            # @sveltejs/vite-plugin-svelte
├── svelte.config.js
├── tsconfig.json
├── index.html                # 入口 HTML（样式变量 + ease-out 曲线）
├── static/index.html         # 冗余副本，可删除
└── src/
    ├── main.ts               # mount(App)
    ├── App.svelte            # 主应用：header + canvas + detail
    ├── lib/
    │   ├── types.ts          # NodeSchema, Plan, ExpectedOutcome, Checkpoint 等
    │   ├── api.ts            # WebSocket 客户端 + HTTP 回退
    │   └── store.svelte.ts   # Svelte 5 $state runes 状态
    └── components/
        ├── GraphCanvas.svelte    # D3.js 力导向图（核心可视化）
        └── NodeDetail.svelte     # 右侧详情面板
```

### 数据流

```
后端 (.graph/*.yaml)
  → buildGraphIndex()
  → WebSocket push / REST /api/graph
  → api.ts (WebSocket 客户端)
  → store.svelte.ts (graphState)
  → GraphCanvas.svelte (D3.js 渲染)
  → NodeDetail.svelte (点击节点显示详情)
```

### 前端类型定义

`web-ui/src/lib/types.ts` 定义了与后端对应的类型：

- `NodeSchema` — 节点（含 plan? / expected_outcome? / checkpoints?）
- `EdgeSchema` — 边
- `GraphIndex` — 完整图索引
- `STATUS_COLORS` — 状态→颜色映射

### 后端 API

Web 后端（`graph serve`，端口 **8934**）提供：

| 端点 | 协议 | 说明 |
|------|------|------|
| `/api/graph` | HTTP GET | 返回完整 GraphIndex JSON |
| `ws://host/` | WebSocket | 连接即发 `graph:full`，变更推 `graph:update` |

---

## 前端的当前状况

### 已有的功能

- **力导向图**（D3.js forceSimulation）：节点圆圈 + 箭头连线 + 标签
- **节点着色**：按 status 七色区分
- **节点交互**：hover 放大 (22→26px)，click 脉冲反馈
- **Running 脉冲动画**：stroke-opacity 呼吸
- **详情面板**：slide-in 动画，显示 label/id/type/level/status/assigned_to/attempts
- **详情内容**：plan.description / definition_of_done 列表 / checkpoints 状态
- **Loading 状态**：spinner + "连接拓扑服务中..."
- **Empty 状态**：SVG 插图 + CLI 命令提示
- **状态图例**：header 中的七色 legend
- **节点计数**：header 右侧的节点/边统计
- **reduced-motion 支持**：所有动画有 `@media` 兜底
- **Vignette 遮罩**：画布径向渐晕

### 用户不满意的地方（需修复）

1. **整体样式和设计感不足** — 当前配色是纯功能性 dark theme（#0f172a），缺少设计语言
2. **NodeDetail 面板布局** — 信息密度和可读性需要优化
3. **GraphCanvas 交互** — zoom/pan 用户体验可以更好
4. **响应式适配** — 不同屏幕尺寸的适配
5. **微交互缺失** — 过渡动画和手感可以更精致

---

## 启动方式

```bash
cd D:/LUKAWI/AI_project/projects/topological-tool

# 构建后端
npx tsc

# 启动 Web 服务器（端口 8934）
node dist/cli/index.js serve -p 8934

# 前端开发模式（热更新）
cd web-ui && npm run dev
```

Web UI 访问：`http://localhost:8934`

---

## 可参考的文档

| 文档 | 路径 | 用途 |
|------|------|------|
| 需求说明 | `拓扑图管理工具-轮子需求.md` | 完整需求 |
| 产品愿景 | `../pi-extension/graph/docs/产品愿景.md` | 架构全景 |
| 领域术语 | `CONTEXT.md` | 术语表 |
| ADR-0001 | `docs/adr/0001-*.md` | 拓扑排序忽略运行时边 |
| ADR-0002 | `docs/adr/0002-*.md` | 纯文件系统存储 |
| 实施计划 | `docs/superpowers/plans/2026-07-28-*.md` | 原始实现计划 |

---

## 建议的技能

| 技能 | 使用时机 | 说明 |
|------|----------|------|
| **impeccable** | 前端设计优化时 | 本项目的视觉和交互设计优化，包含动画/animate 参考 |
| **domain-modeling** | 改前端类型定义时 | 确保前端 types.ts 与后端 types.ts 对齐 |
| **anysearch** | 选型或搜索 D3.js 方案时 | 搜索 D3.js force graph 交互优化方案 |
| **test-driven-development** | 修改 core 层逻辑时 | 修改后端时先写测试再改代码 |
| **systematic-debugging** | 遇到 WebSocket 或热更新问题时 | 系统化定位前端集成问题 |

---

## 安全注意

- 本项目无 API 密钥、密码或敏感信息
- `.graph/` 目录下的 YAML 文件包含任务描述，不包含凭据
- 所有代码为 TypeScript 开源项目
