# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主用户是使用 @lukawi/super-plumber CLI/MCP 管理工作流拓扑图的独立开发者与 agent 编排者（命令行为主）。Web UI 是他们的**拓扑审阅/监控面板**：工作时长时挂屏，抬眼瞟 running 在哪、点开看节点详情与 ADR 决策、对比快照差异。次要场景：向他人展示/讲解拓扑结构。

## Product Purpose

super-plumber 把需求拆解为任务拓扑图（节点/状态机/契约边/ADR），用图驱动多 agent 执行与裁决。Web UI（`graph serve`，默认 8934 端口）让用户在浏览器里实时审阅拓扑：7 种节点状态流转、层级钻取、搜索、多图切换、map 透镜（工作流图/领域图）、节点/边详情、ADR 决策文档、快照 diff。成功标准：挂屏一眼可读状态、点两下内看到任何细节、纯审阅绝不影响 CLI/MCP 状态。

## Positioning

图即真相源：拓扑图（.graph/）是唯一权威数据，CLI/MCP/webui 三端同源消费。Web UI 的不可复制机制是**领域顶点的原生可视化**——decides 边转「管辖决策」反向板块（节点/context 详情页）、契约边虚线、context 星云（云心 + 云缘命中环）、ADR 决策文档（dock 目录 + 详情抽屉五节 + superseded 接替链；画布不渲 ADR 形体），这些是任意通用图工具拿不到的语义。

## Operating Context

- 开发者本地终端运行 `graph serve`，浏览器常驻一个标签页，长时间挂屏。
- 数据经 WebSocket 实时推送（graph:full / node:updated / graphs:list），断线自动重连。
- 与 CLI 共享同一套状态词汇：pending/ready/running/passed/failed/blocked/cancelled（三方对齐：CSS 变量 / CLI export-mermaid / statusColorOf）。
- 用户语言：界面正文中文，结构件可用英文 mono 大写（EN-caps=结构、ZH=内容 的既有层级语言）。

## Capabilities and Constraints

- Web UI 是**纯审阅**面：不写服务端状态；切图/过滤全部本地。
- Svelte 5（runes）+ Vite + d3-force；构建产物 `web-ui/dist` 由 `graph serve` 静态托管；无路由、单页。
- 无外部字体/图标库依赖（系统字体栈 + 内联 SVG）；保持零运行时依赖增量（d3/marked/dompurify 之外）。
- 已确认未决：移动端为降级可用（画布手势可用即可），不承诺完整移动体验。

## Brand Commitments

- 命名：Super Plumber（npm 账号 lukawi）。
- 既有视觉承诺（用户 2026-08-28 拍板延续并精修）：terminal-native 血统——纯黑画布舞台、白色 ink 阶梯、状态色是唯一彩色语义组；**色彩即状态，交互用明度**。
- 用户明确废除：彩色 side-stripe、Unicode 字符图标（⬡⚖⚠️✓✗◐⊘）、mono 大写 eyebrow 作小节头。

## Evidence on Hand

- 真实图数据：工作区 `.graph/`（multitool-refactor 等 3 图，含 ADR/context/契约边），`graph serve` 可实时渲染。
- 评审档案：`.impeccable/critique/2026-08-27T16-33-32Z__web-ui-src-app-svelte.md`（Nielsen 25/40，P0×3/P1×3，逐条 file:line）。
- 设计系统提案（用户已审核通过方向）：`docs/design-system/preview.html`（token 全量带 WCAG 核算值）。

## Product Principles

1. **画布即产品**：chrome 让位，一切面板可收纳；挂屏距离可读优先于桌面精致。
2. **色彩即状态，交互用明度**：7 状态色是画布上唯一彩色语义；选中/hover/focus 用白色明度阶梯。
3. **每个状态都有出口**：加载/切图/搜索/断线/空图，明示状态 + 给出恢复路径；Esc 与空白点击是全局退出手势。
4. **mono 只为数据**：id/数字/命令/时间戳用等宽；UI 标签回归 sans。
5. **动效表达状态**：130/220/450ms 三档单曲线，reduced-motion 全量降级。

## Accessibility & Inclusion

- WCAG AA 为底线：正文 ≥4.5:1（黑底 ink 阶梯已核算），图形 ≥3:1；状态不得仅靠色相区分（线型/符号补位，ADR 三态已达标并推广）。
- 键盘完整可达：节点 tabindex+role、全局 Esc、焦点可见（2px 白环）；prefers-reduced-motion 全链路。
