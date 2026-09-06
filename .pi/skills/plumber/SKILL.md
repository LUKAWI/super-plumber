---
name: plumber
description: Use when 需要判断是否使用 Super Plumber、选择 quick/standard/program、定位目标图或确认当前在该档哪一步。只做只读路由提示，不自动点火、不认领、不派单。多工具通用（pi/claude/zcode/codex）。
---

# Plumber Router — 统一入口

本技能只回答四个路由问题，不代替设计、执行或用户决策：

1. **该不该用 SP？** 多步骤、存在依赖、需要交接/并行/可追溯验收时建议使用 SP；纯问答、单点小改动或一次性本地操作可直接处理。
2. **走哪档？** 按 adr_0018 顺序判断：关键未知阻止形成可信交付计划 → `program`；否则一个会话内能完成并验收 → `quick`；其余 → `standard`。跨会话、跨图、跨仓库和并行人数不单独触发 `program`。
3. **用哪张图？** 用户指定图名就使用该图；未指定且已有多个候选时只读查看并请用户选择；没有目标图且任务需要建图时提示 `/plumber-design`。不切换共享 active 图。
4. **现在在该档哪一步？** 新需求/未建图 → `/plumber-design`；图尚未审核 → `/plumber-design`；已审核且有执行授权 → `/plumber-execute`；缺少背景、需要先了解图和前沿 → `/plumber-join`；`program` 仍有关键未知 → 先走 chart/work 约定，再按授权进入对应技能。

## 只 hint，不点火

- 只输出判断、依据、目标图和下一直接入口；需要图状态时只读 `graph_list_graphs`、`graph_get_node`、`graph_get_next_actions` 等信息。
- 不调用 `graph init`、`graph switch` 或任何写操作；不 claim、checkpoint、report、verdict、passed，不启动设计/执行，不派生子代理。
- `quick` 且无需拓扑时，可提示直接使用 SP 自带纪律技能；纪律技能是 model-invoked，不发独立命令。`sp-grilling` 只有用户主动点名时才进入。
- 用户明确指定档位时尊重其意图，但本技能仍只提示，不代用户写入 class 或审计凭据。

## 直达入口仍有效

统一入口不会吞并既有入口：

- `/plumber-design`：直接进入设计、验证和用户审核闸门；
- `/plumber-execute`：直接执行已审核图；
- `/plumber-join`：低上下文入场并把候选节点置 `ready`，随后交给执行技能。

回答结束时给出一条推荐落点和仍需用户确认的事项；不要把提示写成已经执行的结果。
