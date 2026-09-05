---
name: plumber-join
description: Use when 新会话缺少背景，需要加入已有拓扑图，快速了解工作区、开发目标、当前进度和下一步开发什么。完成上下文入场并将候选节点置 ready 后结束；认领、开发、上报与验收交 plumber-execute。Do NOT use for 设计新图（用 plumber-design）或已有完整上下文的执行任务（直接用 plumber-execute）。
---

# Plumber Join — 最小上下文入场

目的只有两个：**知道在开发什么，知道下一步开发什么**。终点是候选节点 ready，不是完成节点。

## 入场流程

1. **定位工作区与图**：读取工作区入口说明；用户指名图则直接使用，否则 `graph_list_graphs` 选择明确的目标，有歧义才询问。MCP 用进程级 `graph_switch`；CLI 用显式 `--graph <图名>`，不切换共享 active 图。
2. **了解目标与进度**：读取目标图的 entry/exit、审核记录及进度摘要，调用一次 `graph_get_next_actions` 查看前沿。已有信息直接复用；不把 pending/ready/running 当作已审核证据，也不把全 passed 当作整体验收完成。
3. **确定下一步**：优先指定的可执行节点，否则在 ready 桶按 priority（数值越小越先）选择，ready 空再选 ready_eligible。只读取候选节点的 plan、DoD、checkpoints 及其直接关联的 context/ADR；按需打开相关文件，不通读整库、历史记录或整本手册。发现 adr_flags 时先澄清现行决策。
4. **准备就绪即结束**：确认候选范围已获审核（quick 可用 self 凭据），ready 节点不重复写；ready_eligible 节点用 `graph_update_node_status {id, status:"ready"}` 交门禁复校。失败如实报告，不 force、不绕过。无可执行前沿则说明阻塞、正在执行或待验收情况后结束。

## 交接

简短交付：**图名 / 正在开发什么 / 当前进度 / 下一节点及 ready 状态 / 必要上下文路径和约束**。

用户原请求已包含执行授权时，结束本技能后自然转 `plumber-execute`，由它重新确认前沿并 claim；仅要求了解进度或入场时，在此停止，不擅自开发。纯查询不修改节点状态。

**边界**：不 claim、不 reclaim、不开发、不上报 checkpoint/report、不写 verdict/passed、不循环认领。未审核则说明需 `plumber-design` 完成审核；操作语法或错误处理有疑问时才查 `./manual.md` §4/§5/§9。不手改 `.graph/` YAML。
