<!-- 附件（0.9.4 S02 分层，adr_0008）：quiz 三问与审核话术。唯一正本 integrations/src/skills/plumber-design/attachments/；
     .pi 与插件包内同名文件是 gen 产物，手改会被 scripts/sync-integrations.mjs --check 拦截。
     寻址：与 plumber-design/SKILL.md 同目录 attachments/（两渠道同构，相对本文件可解析）。 -->

# Review Brief — quiz 三问与审核话术（serve 人审硬 gate 的对话细则）

何时读：design Step 5 请求用户审核时。**审核是硬性 gate**：用户批准之前绝不进入执行阶段。

## 接入 sp-grilling（人审对话的质检纪律）

- 开场告知"拓扑图已在浏览器打开（端口 X），可以开始审核"；此后人审对话**接 sp-grilling 质检**：designer 引导用户对**已画好的图**跑 sp-grilling——一次只问一个问题、每问附上你的推荐答案，先覆盖三类结构决策（**节点粒度是否得当？阻塞边是否真门槛？该合并还是再拆？**），再沿决策树逐支深入；验收标准、领域划分与 ADR 纳入后续问题序列。
- 事实自查（读图、validate 结果自己查），决策归用户。

## 三透镜审阅

建议切**三透镜**审阅（Web UI 左侧 map 勾选器）：**工作流图**（任务拆分与依赖）/ **领域图**（context 边界与术语，点开看节点即文档详情）/ **叠加图**（簇壳包裹成员、ADR 徽章、契约边高亮——归属是否合理一眼可见）。

## 裁决与凭据

- 用户**否决/提意见** → 回 Step 2 修改 → Step 3 重验 → 浏览器刷新后再次请求审核。
- 用户**批准** → designer 调一次 `graph approve --by <审核者>` 落审批凭据（DEC-1：status 默认 approved；凭据只记录、不替代审核对话），随后才可进入 `plumber-execute`（建议用户明确说"开始执行"触发）。
- program 类图可按层分批 approve（`graph approve --by <审核者> --level L1 …`）：审一层批一层，分层凭据照记（review.layers），零门禁不变（F08）。
- **绝不**在未获批准时 claim 节点或改动节点状态；**绝不**自行调用 plumber-execute 开始执行任何节点——**设计完成 ≠ 可以执行**。

## 旅程告知（WF10，图定稿出场时必做）

向用户交底「下一步是什么、需要你做什么」：

1. serve 页继续开着供复查（看板零门禁，正式凭据是 `graph approve --by <审核者名>` 的人工审核记录）；
2. 之后说"开始执行"即切 `plumber-execute` 编排执行；
3. 也可另开会话用 `/plumber-join` 让执行者冷启动入场自主认领（DEC-5：join 是新会话入场认领，journey 是阶段出场告知，两者互补不互斥）。
