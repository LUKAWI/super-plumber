# Handoff：TopoGraph 项目独立验证校验清单

> 下一阶段：派遣独立 agent 会话，验证产品是否达到计划的功能和性能要求，全面扫描代码做 debug 和测试。
> 生成时间：2026-07-31
> 本清单不含 API 密钥、密码或个人身份信息。

---

## 一、项目概况

| 项 | 值 |
|----|----|
| 项目路径 | `D:/LUKAWI/AI_project/projects/topological-tool/` |
| Git 分支 | `master`（25 commits，可回滚点 `mvp-checkpoint` tag） |
| 语言 | TypeScript（严格模式） |
| 测试 | Vitest，7 个测试文件，当前 63/63 通过 |
| 构建 | `npx tsc`（后端）+ `cd web-ui && npx vite build`（前端） |

### 产品定位
工作流拓扑图管理工具。将任务文档/工作流重构为 agent 可原生理解的拓扑结构（节点/边/状态机），提供 CLI + MCP Server + Web UI 三层访问，纯 YAML 文件存储（无数据库）。

### 功能矩阵（当前实现）
```
CLI:      11 命令（init/create-node/add-edge/update-status/update-node/delete-node/status/validate/rebuild/export/serve）
MCP:      9 工具（get_node/create_node/update_node_status/update_checkpoint/update_execution_report/delete_node/get_graph/traverse/search）
Core:     状态机(7态13转换) / 拓扑排序(Kahn) / 环检(DFS) / 节点&边 CRUD / YAML 读写
Web UI:   Svelte 5 + D3.js 力导向图，WebSocket 增量推送，边类型可视化，光点流动，checkpoint 进度条
Subagent: super-mario（裁决主控）+ graph-designer（设计）
Skill:    topo-graph（操作指南 + 协作协议）
```

---

## 二、校验清单

### A. 完整性验证（对照需求文档）

需求文档：`D:/LUKAWI/AI_project/projects/topological tool/拓扑图管理工具-轮子需求.md`

| # | 需求验收标准 | 验证方式 | 预期 |
|---|-------------|----------|------|
| 1 | YAML 定义图（入口+出口+N节点+M边） | `graph init` 后检查 .graph/ 结构 | 目录齐全，graph.yaml 可解析 |
| 2 | Agent 通过 MCP 创建/读取/更新节点 | MCP 客户端调用 9 工具 | 全部可用，参数校验生效 |
| 3 | 节点完整生命周期状态机 | 状态转换测试 | 7 状态 13 转换正确，非法转换报错 |
| 4 | 结构化 plan/checkpoint/expected_outcome | 节点文件验证 | 示例节点含完整字段 |
| 5 | typed edge（7 种） | 边文件验证 | 36 条边含 5 种类型 |
| 6 | 拓扑排序 + 循环检测 | DAG 引擎测试 | 20 节点排序通过，无环 |
| 7 | Git commit 版本快照 | `git log` | 25 commits，含快照能力 |
| 8 | 人类查看拓扑图 | `graph export --mermaid` + `graph serve` | 导出成功，Web UI 可访问 |
| 9 | 纯文本文件可编辑 | 手工验证 | .graph/*.yaml 可直接编辑 |
| 10 | index/ 可从源文件重建 | `graph rebuild` | graph.json/meta.json 生成 |

### B. 代码检验

| # | 检查项 | 命令/方式 | 预期 |
|---|--------|-----------|------|
| 1 | 类型检查 | `npx tsc --noEmit` | 零错误 |
| 2 | LSP 诊断 | pi-lens `lsp_diagnostics` | 零诊断 |
| 3 | 测试全量 | `npx vitest run` | 63/63 通过 |
| 4 | 前端构建 | `cd web-ui && npx vite build` | 无警告无错误 |
| 5 | 未使用导入/死代码 | LSP + 代码审查 | 无 unused 警告 |
| 6 | 外部依赖最小化 | package.json 核对 | 核心逻辑零外部依赖（仅 CLI/MCP/web 层有） |
| 7 | 错误处理 | 审查 CLI/MCP 错误路径 | 用户友好，不静默失败 |
| 8 | 安全性 | 无凭据/密钥在代码中 | 无泄漏 |

### C. 功能测试（端到端）

| # | 测试项 | 步骤 | 预期 |
|---|--------|------|------|
| 1 | CLI 全流程 | init → create-node → add-edge → update-status → validate | 全部成功，状态机校验正确 |
| 2 | 状态机非法转换 | `update-status --status passed`（pending 态） | 报错 "Invalid transition" |
| 3 | claim 语义 | update_status running + claim_by | 记录 assigned_to + started_at |
| 4 | execution_report | update_execution_report 填写 | 交接单持久化，completed_at 自动记录 |
| 5 | 软删除 | delete-node → 检查文件 | `.deleted.yaml` 保留 |
| 6 | rebuild 可重建 | 删 index/ → rebuild | graph.json 恢复 |
| 7 | MCP 参数校验 | 缺参/非法枚举调用 | 返回 `MCP error -32602` isError=true |
| 8 | WebSocket 增量推送 | serve 启动 → 改节点文件 | 收到 `node:updated` 增量（非全量） |
| 9 | Web UI 渲染 | serve 后访问 localhost:8934 | 力导向图、边类型、进度条、执行者标签 |
| 10 | 光点流动 | 节点置 running | 下游边光点流动动画 |

### D. 性能验证

| # | 测试项 | 方式 | 预期 |
|---|--------|------|------|
| 1 | 大规模图拓扑排序 | 脚本生成 1000+ 节点图，`validate` | 秒级完成 |
| 2 | 增量推送 vs 全量 | 对比 node:updated vs graph:update 负载 | 增量显著更小 |
| 3 | Web UI 流畅度 | 50+ 节点图交互 | 60fps 无明显卡顿 |
| 4 | 文件监听开销 | 高频变更 | chokidar 不抖动 |

### E. 架构合规（MCP 协议）

| # | 检查项 | 预期 |
|---|--------|------|
| 1 | 工具注册用 McpServer（非 deprecated Server） | ✅ |
| 2 | zod inputSchema 驱动校验 | ✅ 非法参数 -32602 |
| 3 | 错误返回 isError 而非静默 | ✅ |
| 4 | 无 deprecated API（z.nativeEnum 等） | ✅ |
| 5 | 进程级错误处理 | ✅ uncaughtException 兜底 |

### F. 文档与生态

| # | 检查项 | 位置 | 预期 |
|---|--------|------|------|
| 1 | README | README.md | 完整使用文档 |
| 2 | 领域术语 | CONTEXT.md | 覆盖 Super Mario/Claim/Execution Report 等 |
| 3 | ADR | docs/adr/0001, 0002 | 架构决策记录 |
| 4 | 实施计划 | docs/superpowers/plans/ | 与实现对应 |
| 5 | Subagent 定义 | .pi/agents/ | super-mario + designer 有效 |
| 6 | Skill | .pi/skills/topo-graph/ | MCP 工具表 9 个 + 协作协议 |
| 7 | workflow prompts | ~/.pi/agent/prompts/ | 4 个 prompt 引用有效 agent 名 |

---

## 三、评分清单（总分 100 分）

> 验证 agent 按以下标准逐项打分，每项 0-10 分或按权重折算，最后汇总并附理由。

| 维度 | 权重 | 评分标准（10 分制基准） |
|------|:----:|--------------------------|
| **A. 完整性** | 15% | 10=10条验收标准全过；每缺1条扣1分；核心缺口(状态机/拓扑/存储)严重扣分 |
| **B. 代码质量** | 20% | 10=tsc/LSP/测试全绿、无死代码、依赖最小、错误处理完整；每项不达标扣2分 |
| **C. 功能正确性** | 25% | 10=11 CLI+9 MCP 全功能端到端正确；bug 按严重度扣分（静默错误扣4分/个，误导报错扣2分/个） |
| **D. 性能** | 10% | 10=1000节点秒级、增量推送生效、UI流畅；卡顿/超时按程度扣分 |
| **E. 架构/协议合规** | 10% | 10=McpServer+zod、isError规范、无deprecated；违规每项扣2分 |
| **F. 文档/生态** | 10% | 10=README/CONTEXT/ADR/agents/skill/prompts 齐全且一致；过时或缺失每项扣1分 |
| **G. 测试覆盖** | 10% | 10=核心逻辑全覆盖（状态机/拓扑/CRUD/CLI/MCP）；缺关键用例扣分 |

**评分等级：**
- 90-100：达标，可进入下一阶段
- 75-89：基本达标，需修复指定缺陷
- 60-74：不达标，需系统修复
- <60：严重不达标，需重新评估架构

---

## 四、参考文档索引

| 文档 | 路径 |
|------|------|
| 需求说明书 | `D:/LUKAWI/AI_project/projects/topological tool/拓扑图管理工具-轮子需求.md` |
| 产品愿景 | `D:/LUKAWI/AI_project/projects/pi-extension/graph/docs/产品愿景.md` |
| 问题分析 | `D:/LUKAWI/AI_project/projects/pi-extension/graph/docs/问题分析.md` |
| 领域术语 | `CONTEXT.md` |
| ADR-0001/0002 | `docs/adr/` |
| 实施计划 | `docs/superpowers/plans/2026-07-28-topological-wheel-mvp.md` |
| 前端 handoff | `docs/handoff-frontend.md` |
