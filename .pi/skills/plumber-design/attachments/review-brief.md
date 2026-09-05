<!-- 附件（0.9.4 S02 分层，adr_0008）：用户审核与可选拷问。唯一正本 integrations/src/skills/plumber-design/attachments/；
     .pi 与插件包内同名文件是 gen 产物，手改会被 scripts/sync-integrations.mjs --check 拦截。
     寻址：与 plumber-design/SKILL.md 同目录 attachments/（两渠道同构，相对本文件可解析）。 -->

# Review Brief — 用户审核与可选拷问（serve 人审硬 gate 的对话细则）

何时读：design Step 5 请求用户审核时。**审核是硬性 gate**：用户批准之前绝不进入执行阶段。

## 用户审核（sp-grilling 仅用户主动调用）

- 开场告知“拓扑图已在浏览器打开（端口 X），可以开始审核”，呈现目标、关键取舍与验收标准后请用户审核。不自动调用 sp-grilling，不要求固定三问；仅用户主动要求拷问时再按该技能对齐需求或调整设计。
- 事实自查（读图、validate 结果自己查），决策归用户。

## 三透镜审阅

建议切**三透镜**审阅（Web UI 左侧 map 勾选器）：**工作流图**（任务拆分与依赖）/ **领域图**（context 边界与术语，点开看节点即文档详情）/ **叠加图**（簇壳包裹成员、ADR 徽章、契约边高亮——归属是否合理一眼可见）。

## 裁决与凭据

- 用户**否决/提意见** → 回 Step 2 修改 → Step 3 重验 → 浏览器刷新后再次请求审核。
- 用户**批准** → designer 调一次 `graph approve --by <审核者>` 落审批凭据（DEC-1：status 默认 approved；凭据只记录、不替代审核对话），随后才可进入 `plumber-execute`（建议用户明确说"开始执行"触发）。
- program 类图审核当前阶段的研究计划、毕业条件及已明确部分，不将尚未确定的后续方案视为已批准；关键未知解决后审核可信交付计划再转 standard。可按层分批 approve（`graph approve --by <审核者> --level L1 …`）：审一层批一层，分层凭据照记（review.layers），零门禁不变（F08）。
- **绝不**在未获批准时 claim 节点或改动节点状态；**绝不**自行调用 plumber-execute 开始执行任何节点——**设计完成 ≠ 可以执行**。

## 旅程告知（WF10，图定稿出场时必做）

向用户交底「下一步是什么、需要你做什么」：

1. serve 页继续开着供复查（看板零门禁，正式凭据是 `graph approve --by <审核者名>` 的人工审核记录）；
2. 之后说"开始执行"即切 `plumber-execute` 编排执行；
3. 也可另开会话用 `/plumber-join` 了解项目上下文与进度、将下一节点置 ready，再交 plumber-execute；join 是入场，journey 是阶段出场告知。
