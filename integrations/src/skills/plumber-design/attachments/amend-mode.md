<!-- 附件（0.9.4 S02 分层，adr_0006 收编 / DEC-7）：designer 改图协议。唯一正本 integrations/src/skills/plumber-design/attachments/；
     .pi 与插件包内同名文件是 gen 产物，手改会被 scripts/sync-integrations.mjs --check 拦截。
     寻址：与 plumber-design/SKILL.md 同目录 attachments/（两渠道同构，相对本文件可解析）。 -->

# Amend Mode — designer 改图协议（结构修订三级分流，adr_0006 / DEC-7）

何时读：执行侧路由回结构修订、雾区毕业、或任何要动已审定拓扑形状的时刻。改图不新增第 9 个 skill——小修是 execute 的职责延伸，结构修订是 designer 的职责延伸（本协议）。

## 三级分流（改自己节点的内容与动图结构，边界要清楚）

1. **小修**（不动结构：本节点 plan/DoD 文案勘误、checkpoint 增删）→ 执行会话内直接修订，执行报告注明**「计划已修订」**与改动点；不经本协议。
2. **结构修订**（增删节点/边、雾区毕业、拆分节点、取消子树、ADR supersede 连锁失效）→ 执行侧**绝不自己动手**：在执行报告写明发现的图错与证据，路由回 designer 走本协议。
3. **裁决触发**（failed 裁决揭示设计缺陷）→ 同样路由回 designer，不由执行侧自行改图补救。

判据一句话：文案级改动自己改完注明即可；凡触及拓扑形状或他人节点，一律上报 designer，修订后按新 plan 重新进入执行。

## 结构修订协议（增量四步）

1. **影响评估**：从待改节点/边出发读邻居与下游（`graph_traverse` / `graph_get_node` 的 neighbors），列出受影响节点、边与门禁关系；
2. **自动快照**：落图前留回滚点——机器已内建（见下节 (a)），协议侧只需确认快照存在（`graph snapshot --list` 或响应中的 auto 快照 id）；
3. **增量修改 + 增量 validate**：改完对受影响范围重跑 `graph validate`（+ doctor 体检），0 error 才交；
4. **增量人审 + 凭据回置**：修订结果向用户呈报（serve 在开则浏览器已自动刷新）；review 凭据已被机器回置 unreviewed（review_flag 重新亮起），按增量范围请求重审，重审通过重新 `graph approve --by <审核者>`。

## 三条轻机器约束（F21，DEC-1 nudge 哲学，已内建于核心层，三通道一致）

- **(a) 结构修订落图前自动 snapshot**：创建/删除节点、添加/删除边、batch_create、graduate-fog 等结构性写入口在实际写盘前自动快照（message 前缀 `auto: structural amend`，快照 best-effort，失败不阻断合法写操作）；
- **(b) graph_amended 事件 + review 回置**：结构修订落盘成功后追加 graph_amended 审计事件；图已有审核凭据则回置 status=unreviewed（记录触发修订的通道与时刻）——review_flag 重新亮起提示增量人审，**零门禁**；
- **(c) 改 passed/blocked 节点 plan 的响应 nudge**：update-node 双通道在响应中附「计划已变更，是否重开/重验」提示——重开/重验由裁决方决定，agent 不代签。

雾区毕业（graduate-fog）是本协议的既成实例：命令自带 DEC-7 守卫（自动快照 + graph_amended + review 回置 → 手册 §2.2）；work 模式第 3 步即走此路径（→ `wayfinder-mode.md`）。
