---
target: web-ui 拓扑图可视化前端（App.svelte 全表面）
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 3
timestamp: 2026-08-27T16-33-32Z
slug: web-ui-src-app-svelte
---
# Critique — web-ui 拓扑图可视化前端（impeccable 4.1.2 · Operate 模式）

- Target: `web-ui/src/App.svelte`（webui 全表面）
- Method: dual-agent (A: agent_0a0e7808 · B: agent_fb33791b) + 主代理浏览器实证（本 harness 的 Browser Use 仅限主代理，浏览器巡检与 overlay 注入由编排方执行并如实记录）
- 日期: 2026-08-28

## Design Health Score（Nielsen 十启发式，Operate 全适用）

| # | 启发式 | 分 | 关键问题 |
|---|---|---|---|
| 1 | 系统状态可见性 | 3 | running 四重表达优秀；fetchGraph 失败=永久 loading，搜索零命中无反馈 |
| 2 | 贴近真实世界 | 3 | 边类型中文字典、CLI 词汇咬合；EN/ZH 混排无规则 |
| 3 | 用户控制与自由 | 2 | 全站无 Esc；画布空白点击不取消选中；刷新丢布局/选中/过滤 |
| 4 | 一致性与标准 | 2 | 双蓝同屏；diff 劫持状态色；琥珀三义；--sp-14 未定义；z 靠补丁 |
| 5 | 错误预防 | 3 | 纯审阅只读，切图不发服务端命令 |
| 6 | 识别而非回忆 | 2 | 簇色 8 色无图例；边色 9 色无图例；pin 按钮是"+"号 |
| 7 | 灵活与高效 | 3 | 多图分桶、pinned 布局、reduced-motion 全链路；缺 Esc/搜索跳转 |
| 8 | 美学与极简 | 2 | 顶栏同词汇表达两遍；五处浮层穿孔画布 |
| 9 | 错误恢复 | 2 | 懒拉失败静默；错误与空态混写一句 |
| 10 | 帮助与文档 | 3 | zoom-hint 常驻、空态教 CLI 命令（但 hint 实测被网格遮挡） |
| **总分** | | **25/40** | Acceptable 带中位（20–27），画布拉分、一致性与 dismissal 拖分 |

## Design Specificity 判定

**扎根领域但半身出戏。** 画布层是真产品：状态呼吸环+光点流、checkpoint 进度条长在节点脚下、ADR 三形态、decides 边转管辖徽章、契约边虚线、superseded 划题接替链——这些词汇换 logo 就说不通。chrome 层约 60% 可换皮：▸ mono 大写小节头 + chip 的面板语法、顶栏四件套、四文件各自手写的 chip。terminal-native 是写进 token 注释的承诺（index.html:8），但"纯黑单色"早已被 7 状态+9 边+8 簇+3 diff 色击穿；EN-caps=结构件、ZH=内容物的双语层级方向对，纪律没闭环（空态标题英文、按钮"清除"中文）。

craft-floor 禁令命中：彩色 border-left 3px（AdrDock.svelte:124）；Unicode 充当图标系统（⬡⚖⚠️✓✗◐⊘○▸ 与手绘 SVG 两套图标词汇同屏）；mono 作技术戏服（边缘命中，有 CLI 血统背书）。

## 确定性扫描（Assessment B）

- CLI detect.mjs：exit 2，3 条 findings，**DEGRADED（htmlparser2 等缺失，正则回退，对比度/CSS 变量规则未执行，结果为下界）**：
  - flat-type-hierarchy（index.html:41）— 部分误报（降级伪影），但 13/14px 步差过近属实
  - side-tab（AdrDock.svelte:124，border-left 3px）— 非误报，功能性辩护存在但形式即 AI 味 tell
  - side-tab（AdrDocument.svelte:323）— 高概率误报（DECISION blockquote 惯例，中性色）
- 浏览器 overlay 注入成功（live-server 8400 → detect.js，注入已验证），console 报告 **52 条**：
  - undersized-ui-text ×40+：8.75px/9px/10.5px 功能文本遍布 header/tabs/legend/MAPS/ADR 座（11px 地板）
  - **text-occlusion ×4：zoom-hint 快捷键文字被 rect.grid-bg 100% 遮挡；画布节点标签被 map-selector 100% 遮盖、被 adr-chip 遮盖 90%**（左缘冲突的运行时实锤）
  - text-overflow：span.graph-label 溢出 110px
  - ai-color-palette：紫罗兰霓虹文字on 暗底（--status-blocked 用作文本）
  - flat-type-hierarchy：8.8px–14px，ratio 1.6:1

## 优先问题（合并双评估与浏览器实证）

### [P0] 黑屏家族——五个"看起来坏了"的时刻
首屏加载（实测 8s 全黑）、切图（multitool-refactor→fix-review-v052 黑屏，0 键/dblclick 均无法找回）、窗口 resize、空 diff（VERSIONS 面板 +0−0~0 时画布全黑无解释）、搜索无命中（节点 dim 至 0.14 近全黑）。根因族：autoFit 固定 setTimeout(2000) 与 ~5.7s 的 alphaDecay 赛跑 + fit 失败无重试 + 空态不表达。修：fit 挂接模拟收敛、切图/resize 强制 refit、四种空态文案化。
建议命令：/impeccable optimize + /impeccable onboard（空态系统）

### [P0] 键盘不可达 + 无 Esc
SVG 节点无 tabindex/role/aria；全站无 Escape；空白点击不取消选中；目标用户是 CLI 开发者——键盘是母语，WCAG 2.1.1 直接违约。
建议命令：/impeccable harden

### [P0] 低对比硬伤群（逐一实算）
边基线 0.28 透明度 ≈1.4:1（拓扑图第一数据近隐形）；zoom-hint 有效 ≈2.0:1；ink-faint 0.38 白 = 3.39:1 ×15+ 处；cancelled 环 ≈2.1:1；叠加 SVG 8px/8.5px/9px 硬编码字号。修：ink 阶梯下限 0.46 白、边基线 0.45、SVG ≥10px。
建议命令：/impeccable colorize + /impeccable typeset

### [P1] 色彩语义冲突
EDGE_TYPE_COLORS 9 色（Tailwind 原值）与状态色两套蓝/绿/红/紫同屏；diff-modified 复用 running 橙、added/removed 复用 passed/failed 绿红；CONTEXT_PALETTE 前四色即状态色 hex 原值（maps.ts:76-85）；琥珀 #f0a73a 三义（running/diff-modified/pin 激活）。
建议命令：/impeccable colorize + /impeccable distill

### [P1] 左缘浮层实际遮挡 + z 体系击穿
overlay 实锤节点标签被 map-selector/adr-chip 遮盖；`var(--z-tooltip, 30)` 实为 1000（App.svelte:612、AdrDock.svelte:79），AdrDocument 被迫打 1001 补丁；≤768px 时 NodeDetail(z=100) 被盖。
建议命令：/impeccable layout

### [P1] --sp-14 未定义 token
DiffPanel.svelte:111 → versions 开关与面板分居对角（截图证实）。修：--sp-4 + stylelint 校验 var() 引用。
建议命令：/impeccable polish

### [P2 群]
移动端崩坏（画布黑屏、zoom 缩至 28px 反向缩小、浮层占屏）；图标双词汇（Unicode vs 手绘 SVG）；空 diff 无解释；搜索 Enter 不跳转；刷新丢布局/选中/过滤；错误与空态混写（DiffPanel.svelte:93）；positions 缓存跨图共享（同名 id 互继承坐标）；tooltip 右缘不夹紧；NodeDetail 对 context 顶点名实不符。

### [P3 群]
顶栏状态双呈现且两表集合不对齐；图例虚假可供性（有 hover 无行为）；16 连 mono 大写 eyebrow；ADR 芯片 3px 彩色边条；EdgeDetail 标题渲染边 id；NodeDetail 把 d3 SimNode 整包塞 store（类型泄漏）。

## 做得好的（保持不动）

1. running 状态四重感官通道（呼吸环+glow+执行者标签+出边光点）——为挂屏场景真正做的设计，reduced-motion 全链路降级
2. 多图分桶架构：后台图静默热更新、EMPTY_BUCKET 冻结、切图不发命令的纯审阅承诺与实现一致
3. 会教学的空态与图形化骨架屏（6 节点小图形态而非 spinner）

## 人物画像红旗

- **Alex（电源用户）**：键盘预算只有 +/-/0；搜索命中后仍要肉眼找变亮的圆；pin 按钮是"+"号没人会发现；光点 RAF 每帧 O(n²) filter 费电；后台图热更新无提示，切回才知道状态全变
- **Sam（无障碍）**：键盘到画布即死路；SVG 对屏幕阅读器静默；level-chip 18px/zoom 32px 低于触达底线；focus-visible 全站缺失（搜索框反而 outline:none）
- **Riley（边界测试）**：fetchGraph 失败永久"loading graph…"；错误与空态混写；同名 id 跨图继承坐标；tooltip 右缘溢出截断

## 情感旅程

骨架屏（好第一秒）→ 首屏 stagger 淡入+光点流（峰值，若 fit 没输给模拟）→ 选中节点面板滑入（平滑）→ 读 ADR 三态横幅+划题接替链（第二峰值）→ 关面板只有远方 X、Esc 无效、空白点击无效、zoom-hint 以 2.0:1 贴底（谷底）。peak-end 规则下"关不掉"比"打不开"更被记住。

## 激发性提问

1. 7 状态+9 边+8 簇+3 diff 色同屏时，"颜色只属于状态"已名存实亡——你愿意牺牲哪个编码赎回纪律（边色退灰？簇色去饱和？diff 改形状）？
2. diff 是"另一个视图"还是"当前视图的标注"？若承认它是模式，它是否该有自己的画布词汇与图例？
3. 挂屏的真实观看距离是多少？60cm 则 8px 尚可辩护；抬头 1-2m 瞟 running 在哪，则字阶/边透明度/光点尺寸全部按远距离重校——这题决定一半排版结论。

## 重构方向（A' 供裁决，不拍板）

- **方向 A 同语系精修**（必做基底）：修纪律不换血统——ink 提至 AA、三套杂色与状态色解耦（形状编码补位）、单一 SVG 图标体系、去边条、修 --sp-14/z 表
- **方向 B 中性第二层+单一交互强调色**：chrome 微冷抬升面、唯一强调色（青）、图例计数合并为可点过滤器；成本收益比最好的"审阅工作台"路线
- **方向 C 画布优先重构**：三层 chrome 压成 44px 命令轨、AdrDock 退役入轨、搜索 Enter 跳转、节点方向键沿边行走、挂屏模式；监控墙定位收益最大，成本最高
- A 必做；B/C 按产品定位二选一，不建议跳过 A 直接做 B/C。
