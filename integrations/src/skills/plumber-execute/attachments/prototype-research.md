<!-- 附件（0.9.4 S02 分层，adr_0008；WF12 产出物范式在此收编）。唯一正本 integrations/src/skills/plumber-execute/attachments/；
     .pi 与插件包内同名文件是 gen 产物，手改会被 scripts/sync-integrations.mjs --check 拦截。
     寻址：与 plumber-execute/SKILL.md 同目录 attachments/（两渠道同构，相对本文件可解析）。 -->

# Prototype & Research — 研究/原型节点范式（雾区解票）

何时读：chart 端拆 research 票、work 端解题、给研究/原型节点定产出物形态时（program 档；两模式分工 → `../../plumber-design/attachments/wayfinder-mode.md`）。

## 票的定义与登记（chart 端拆票）

- **research 票 = 普通 task + plan 自述调研目标**：「research 型」零新概念即可表达，不引入新节点类型。
- **一次会话一张票**：一票 = 一个会话装得下的调研量；chart 端按此拆票，work 端按此解题。
- **点火绝不建边**：research 票与雾之间没有拓扑边——fan_out 点火关系由雾侧 `ignited` 字段（或票 plan 自述）承载，**绝不建 depends_on 边**：fog→票 边会把票永久锁死在 ready 门禁外（试跑实证死锁，不存在合法边能表达点火）。

## 解票（work 端）

- 票照常 claim，走满 0–5 步协议（claim→report 全循环）；**解票是为了把雾想清楚，不是为了清桶赶进度**。
- 调研类天然豁免「一节点一会话」的串行默认，但仍遵守一次一张票；上下文卫生细则 → `context-hygiene.md`。

## 产出物范式（WF12：AFK 点火、分支保留、报告指针）

- **产物落真实 artifact**：调研笔记/对照结论/原型代码写成仓库内真实文件；原型代码可独立分支保留，不混入主干产物——分支名与票 id 对应，便于毕业后取舍。
- **结论写进执行报告**：summary 给结论摘要，notes 给「下一步」（雾可否毕业、还差哪些问题）；报告里放**指针**（artifact 相对路径 + 一句话导读），不整篇粘贴。
- **够 ADR 三判据 → 转正**：`graph adr create`（MCP `graph_create_adr`）落 proposed，accept/supersede 归裁决方（super-mario/人）；术语沉淀进所属 context 顶点 glossary。
- **AFK 点火**：票登记即进入公共调度池——任何已获执行授权的会话都能按 plumber-execute 凭 next 桶认领研究票推进（缺背景时先用 `/plumber-join` 入场至 ready），无需原 chart 会话在场。
