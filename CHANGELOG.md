# Changelog

## [0.2.0] — 2026-08-13

### 安全修复
- **路径穿越（P0）**：`graph serve` 静态文件服务强制约束在 `web-ui/dist` 内，`/../`、`%2e%2e`、反斜杠变体统一 403（`tests/web/server.test.ts` 回归）。
- `graph validate` 全部错误路径退出码非 0（历史两处"报错但 exit 0"假成功修复）。

### 正确性（P1）
- **原子认领**：锁文件（`.graph/.locks/`，O_EXCL + 陈锁回收）内重读-校验-写回；并发 claim 同一节点恰好一个成功，败者收到"already claimed by X"；同一认领者重复 claim 幂等。
- **ready 门禁**：进入 ready / 认领前校验 `depends_on`/`validates`/`fan_in`/`fan_out` 前驱必须 passed，报错点名前驱；`--force` 仅人类运维。
- **max_attempts 强制**：达上限禁止重试；修改 plan.description 自动重置 attempts（CONTEXT 规则）；`max_attempts=0` 不限。
- **checkpoint 状态机**：pending→running|passed|failed|skipped、running→passed|failed、passed|failed|skipped→pending；同状态幂等。
- **YAML schema 校验层**：读入逐文件校验（手写零依赖，宽容未知字段），拼错即时报可读错误；`graph validate` 逐文件定位。
- 删除节点默认拒绝有引用边的操作（`--cascade` 连删）；新增 `delete-edge`；`createEdge` 核心层校验端点存在。
- `zod` 显式声明为依赖（幽灵依赖修复）；`engines.node >=20`；移除 `import.meta.dirname`。

### 设计愿景补全（P2）
- **版本控制**：`graph snapshot`（可 `--git`）/ `snapshots` / `diff` / `rollback`（自动 pre-rollback 备份 + 必须 `--confirm`）；MCP 对应三工具。
- **图级编辑**：`graph update-graph` / `graph_update_graph`——entry/exit/验收标准不再手写 graph.yaml。
- **调度决策**：`graph next` / `graph_get_next_actions`（ready/blocked/running/stale_running 一屏）。
- **裁决**：`graph verdict` / `graph_update_execution_report` 的 verification 参数。
- `graph get-node`（合法转换 + checkpoint 聚合 + 门禁状态）；`status`/`validate`/`next` 支持 `--json`。
- `index/` 新鲜度缓存（逐文件 mtime 比对）+ `topology.dot`；`graph init` 写 `schema.yaml`。
- `aggregateCheckpointStatus` 接入 validate 输出。

### MCP Agent 原生化（P3，9 → 18 工具）
- 设计期补全：`graph_add_edge`、`graph_delete_edge`、`graph_update_node`、`graph_update_graph`、`graph_batch_create`（全量预校验报全部冲突）、`graph_create_node` 支持一次建完整压缩包。
- 执行期强化：`graph_update_node_status` 原子 claim + 门禁/次数上限错误消息；`graph_get_node` 附带 allowed_transitions/ready_gate。
- 版本三工具；`--root` / `SUPER_PLUMBER_ROOT` 服务定位；工具描述重写为决策导向。
- **E2E 纯 MCP 全流程测试**：设计→调度→claim→checkpoint→report→verdict→passed→三层验收。

### Web UI（P4）
- 修复 fitToView 死代码（改模拟坐标 + 抽取可单测的纯函数）；断线指数退避重连 + HTTP 兜底；adjacency 正确序列化；删除重复 CSS；状态色三处统一（CSS 变量/TS/Mermaid 导出）。
- 布局持久化：节点位置缓存 + 仅边变化时增量更新边层（不再全图重抖）；缩放视角跨重渲染保持；固定布局开关（大图性能）。
- 详情面板补全：EXECUTION REPORT（summary/artifacts/blockers/verification 徽标 + 时间戳）、plan 输入/上下文、quality gates。
- 新增：边详情面板（语义/端点跳转/合约）、版本 diff 视图（快照列表 + 画布绿/红/黄着色 + 状态变化明细）、L0–L5 层级过滤 + 搜索 + 状态摘要条 + 图名显示 + offline 指示。
- 前端测试基建：vitest + jsdom + svelte-check（0 error），12 个单测。

### 生态与文档（P5）
- 包公开 API：`@lukawi/super-plumber/core` 桶导出；skill 脚本改走公开 API（本地→全局回退），`sp-*.sh` 全部重写为跨平台 `.mjs`（去 GNU grep）。
- `plumber-design`/`plumber-execute`/`super-mario`/`sp-designer` 全面同步（update-graph、next-actions、verdict、门禁错误、force 红线）。
- CONTEXT.md 补 裁决/调度决策/版本快照术语 + 门禁与次数上限语义；README 中英同步（19 命令 / 18 工具 / 新 FAQ）。
- CI：ubuntu+windows × Node 20/22，后端 + 前端（build/typecheck/test）全链路；测试 badge 真实化。

### 测试
- 后端 97 → **216**（含并发认领 5 进程竞争、路径穿越、门禁、快照往返、缓存失效、18 工具协议、纯 MCP E2E）。
- 前端新增 **12**（重连/布局纯函数/store）。
- 性能回归：10k 深链 validate 不回归；缓存命中路径。

## [0.1.1] — 2026-08

- 初版发布：11 CLI 命令、9 MCP 工具、状态机、Web UI、双 skill 协议（历史记录见 git log）。
