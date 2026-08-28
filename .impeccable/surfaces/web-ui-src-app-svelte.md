---
version: 1
slug: "web-ui-src-app-svelte"
primary_target: "web-ui/src/App.svelte"
related_targets: ["web-ui/index.html","web-ui/src/components/GraphCanvas.svelte"]
---

# Surface brief — web-ui（Super Plumber 拓扑图可视化）

## Scope & visitor mode
- Surface：`graph serve` 托管的单页拓扑审阅面板（web-ui/，Svelte 5 + d3-force）。
- Mode：**Operate**——开发者在任务中审阅/监控拓扑，表情达意让位于扫读与状态。

## Audience / job / action
- 用户：@lukawi/super-plumber CLI 的开发者用户；工作时长时挂屏，抬眼定位 running、点开看节点/边/ADR 细节、对比快照。
- 主行动路径：看状态 chips → 过滤/搜索（Enter 定位）→ 点节点/边/ADR → Esc 或空白点击退出。

## Constraints
- 纯审阅：不发任何服务端命令；多图切换纯本地分桶。
- 零依赖增量：系统字体 + 内联 SVG 图标；构建产物由 graph serve 静态托管。
- 状态色三方对齐：CSS 变量 / STATUS_COLORS / CLI export-mermaid 必须一致（cancelled=#7e848d）。

## Chosen direction（用户钉死，2026-08-28）
- 方向 A+C：色彩即状态、交互用明度（白）；两排顶栏 + 44px 工具轨 + 专注模式；单色边阶梯 + 形状化 diff + 簇色图例。
- Memorable moment：挂屏专注模式下纯黑画布上 running 呼吸环与琥珀光点流。

## Unresolved decisions
- 移动端为降级可用（画布手势 + 44px 底部工具轨），不承诺完整移动体验。
- 强调色若未来需要 branding，可切青色（preview.html 实验组已备 token）。
