# 雾区约定版试跑报告（0.8.2 WF08 / v082-fog-recon）

> 0.9.0 F04/F05/F17 雾区 schema 的设计输入（跨版本契约边已挂接：v082-fog-recon → v090-fog-schema）。
> 试跑日期：2026-09-01。执行：zcode-main（主控）。

## 试跑设定

- **真实模糊需求**：「发布链自动化」——工作区现存想法（IL-016 版本面漏点教训 + README 发版清单人工 5 步 + beta 转正时机悬案）。雾点：版本面同步/sync 断言/changelog/commit/tag/publish/dist-tag 各步哪些能机械化、哪些必须留人工判断、beta→final 如何流转。
- **试跑载体**：独立临时工作区（`%TEMP%\fog-trial`，图名 `fog-recon-trial`），零前文空白工作区，全部经 CLI + sp-scripts 通道驱动；**不触碰 roadmap 主图与共享 MCP server 的 active 图**。
- **流程**：登记（双载体对比）→ research 型 fan_out 点火（3 票）→ 一次会话一张票（r1 全循环 claim→report→passed，真实调研）→ 毕业尝试（软删雾节点）。

## 顺手的部分

1. 图级 `root_context` 承载结构化 fog JSON：零障碍、中文无损、status 读面直接可见——最接近 F04 图级字段的形态预演。
2. context 顶点当雾记录节点：不进 next 调度桶、可承载描述；雾不是票这一点语义正确。
3. research 票即普通 task + plan 描述，「research 型」零新概念即可表达。
4. 一次会话一张票全循环（CLI update-status + sp-report 脚本通道）零障碍；**三通道状态机一致**（sp-claim 同样拒绝 pending→running 两步并一步）。
5. 毕业=软删+理由：审计留痕天然存在。

## 卡点（按严重度）

1. **【死锁】点火边方向无合法语义**：`fog→票` 的 depends_on 边使 research 票永远无法转 ready——context 顶点永远 pending、作为门禁前置永远「未满足」（实测：next 桶三票全部卡「未满足: fog-release-automation(pending)」）；反向 `票→fog` 同样不通（雾无状态机、不可 passed）。**约定版不存在合法边能表达「雾点火票」**。本次实操出路=点火边建完即删，或干脆不建边（雾与票仅凭命名关联）。
2. **【无法落地】`_fog` 命名过不了 ID 规则**：节点 id 规则 `^[a-z0-9][a-z0-9._-]{0,63}$` 拒绝下划线开头（实测报错）——设计文档「独立 _fog 记录节点」载体按字面无法落地，须改 `fog-` 前缀或图级字段。
3. **【凭据缺失】毕业无专用事件**：毕业落进通用 `node_deleted(reason=...)`，无法与「删错节点」区分（F05 `fog_graduated` 缺位实证）；validate/调度对图中有雾零提示（F17 缺位，预期内，实测确认）。
4. **【双载体漂移】**载体 A（图级 root_context.fog）与载体 B（fog- 节点）并存时毕业其一、另一残留（实测：雾节点已删、root_context.fog 仍在）——schema 必须定单一真相源，否则毕业动作必然漏一半。
5. **【呈现小瑕】计数三口径**：同一时刻 status 状态分布计 `pending: 1`（含 context 雾节点）、next 总数不含（总 4）、validate 数 5——知识顶点的计入规则三面不一致（与 IL-019② 同族）。

## 对 0.9.0 schema（F04/F05/F17）的具体建议

1. **F04：雾为图级字段，不做节点载体**（卡点 2/4 同源）。`graph.yaml` 增可选 `fog: { id, description, graduation }`（单雾起步，多雾留数组扩展）；`update_graph` 编辑；status/get_graph/next 读面透出雾概要。
2. **点火不建边**：research 票以字段挂接（如票 plan 或雾侧 `ignited: [node_id...]`），**绝不建 depends_on 边**（卡点 1）——点火不进 ready 门禁，fan_out 关系靠字段不靠拓扑边。
3. **F05 `fog_graduated` 审计事件**：毕业动作=清除图级 fog 字段 + 专用事件（payload 带毕业产物节点 id 列表与理由），与 `node_deleted` 明确区分、可查询可统计。
4. **F17 validate 提示（提示不阻止）**：图有 fog → 「图中有未毕业雾区 <id>（毕业条件：<graduation> 摘要），执行期照常推进」；零工作流节点时不重复提示。
5. （顺带）知识顶点计数口径统一：status/next/validate 三处对齐（可与 0.8.x web-ui 边角同批）。

## 对当下 0.8.2 的回灌

- 雾 schema 改动整体归 0.9.0，0.8.2 无需任何 schema 前置改动（符合分期判据「0.9.x 机器能力先行、话术跟上」）。
- r1 票的真实调研结论（发版 5 步盘点 + 人工判定点清单：版本号定值/changelog 文案/beta 转正时机/publish 授权）已存试跑图 r1 执行报告——「发布链自动化」雾区若立项可直接续用。
- 试跑图保留于 `%TEMP%\fog-trial`（审计证据），不需要时可整目录删除。
