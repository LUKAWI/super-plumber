---
name: Super Plumber Web UI
description: 终端观测台——挂屏拓扑审阅面板：纯黑画布舞台、白色 ink 阶梯、色彩即状态
colors:
  bg: "#000000"
  bg-chrome: "#0a0a0a"
  surface-1: "#141414"
  surface-2: "#1e1e1e"
  surface-3: "#2a2a2a"
  ink: "#ffffff"
  ink-muted: "rgba(255, 255, 255, 0.72)"
  ink-faint: "rgba(255, 255, 255, 0.52)"
  line: "rgba(255, 255, 255, 0.09)"
  line-strong: "rgba(255, 255, 255, 0.16)"
  interactive: "#ffffff"
  status-pending: "#8a8f98"
  status-ready: "#4a93e8"
  status-running: "#f0a73a"
  status-passed: "#34c964"
  status-failed: "#e5504f"
  status-blocked: "#a574e6"
  status-cancelled: "#7e848d"
  ctx-cyan: "#4db8c9"
  ctx-teal: "#4fb3a9"
  ctx-yellow: "#d4c25a"
  ctx-rose: "#d47fa6"
  ctx-lime: "#a8c95a"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "normal"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0.01em"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "0.04em"
  mono-data:
    fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  sm: "3px"
  md: "6px"
  lg: "10px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
  16: "64px"
components:
  button-primary:
    backgroundColor: "{colors.interactive}"
    textColor: "#000000"
    typography: "600 0.75rem var(--font-sans)"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  chip-status:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "500 0.6875rem var(--font-mono)"
    rounded: "{rounded.md}"
    padding: "3px 8px"
  chip-status-active:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "500 0.6875rem var(--font-mono)"
    rounded: "{rounded.md}"
    padding: "3px 8px"
  chip-meta:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "500 0.6875rem var(--font-mono)"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  rail-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    size: "36px"
  input-search:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
    width: "210px"
---

# Design System: Super Plumber Web UI

## Overview

**Creative North Star: "终端观测台（The Terminal Observatory）"**

一块挂在开发者屏幕上、长明不灭的黑色观测仪。整个产品只有一位主角——d3 力导向画布（`#000000` 纯黑舞台），其余一切 chrome（顶栏、工具轨、抽屉、浮层）都是灰色阶的观测仪器外壳，可收纳、可退场（专注模式下整体让位）。视觉纪律只有一条主轴：**色彩即状态，交互用明度**——画布上唯一的彩色语义组是 7 个节点状态（外加 ADR 三态与簇色两个授权延伸），选中、hover、focus、开关等一切交互态全部用白色明度阶梯表达，绝不借色相。字面上保留终端血统：系统字体栈、mono 只用于数据（id/计数/命令/时间戳），11px 起步的紧凑字号，4pt 间距基。

这是 code-led 记录：方向由用户对 `docs/design-system/preview.html` 的评审拍板，本文件的每个值都取自建成代码（`web-ui/index.html` token 正本 + 各组件实际渲染值），一处与提案的已知偏差见 Colors 节。

**Key Characteristics:**
- 纯黑画布 + 四级灰阶 chrome（0a/14/1e/2a），面差与 1px 发丝线替代一切阴影
- 白色 ink 阶梯 100/72/52%（正文下限 ≈4.6:1，全部 ≥ AA）
- 7 状态色是唯一彩色语义组；边线单色白阶梯（0.45/0.6）+ 线型语义
- mono 只为数据；UI 句子一律 sans；图标全部内联 SVG 描边
- 圆角上限 10px；130/220/450ms 三档单一 ease-out 曲线族
- z 五档：canvas 1 / overlay 10 / panel 100 / tooltip 1000（toast 预留未实现）
- Esc 与画布空白点击是全局退出手势，每个状态都有出口

## Colors

一个刻意的双色域系统：冷调七状态彩色（仅画布语义）寄宿在完全无彩的黑白灰舞台上，彩色的稀缺性就是它的可读性。

### Primary
- **Ink 白阶梯**（#ffffff / rgba(255,255,255,0.72) / rgba(255,255,255,0.52)）：交互色即 `--interactive` #ffffff。100% 用于标题/选中态/主按钮底色；72% 用于次级正文；52% 用于 hint、kbd、时间戳（≈5.7:1，AA 达标）。focus 环、选中描边、开关勾选一律白，不给任何色相。
- **纯黑舞台**（#000000）：画布背景。所有状态色与白阶梯都在它上面校准过对比度。
- **灰阶 chrome**（#0a0a0a / #141414 / #1e1e1e / #2a2a2a）：顶栏与工具轨用 0a，抽屉/浮层面板用 surface-1，面板内嵌块（chips/输入框/列表项）用 surface-2，徽标与最深 hover 态用 surface-3。层级越深越亮，从不反转。

### Secondary（状态色七值——画布上唯一的彩色语义组）
- **pending 灰**（#8a8f98）、**ready 蓝**（#4a93e8）、**running 琥珀**（#f0a73a）、**passed 绿**（#34c964）、**failed 红**（#e5504f）、**blocked 紫**（#a574e6）、**cancelled 灰**（#7e848d，v0.7 提亮：原 #5b5f66 仅 3.27:1）。三端同源（CSS 变量 / CLI export-mermaid / `STATUS_COLORS`），改一处必须三处同步。
- **ADR 三态**与状态色同源：proposed=#8a8f98（pending 灰）、accepted=#34c964（passed 绿）、superseded=#e5504f（failed 红），经 `statusColorOf()` 统一取值。
- **簇色板五值**（#4db8c9 青 / #4fb3a9 水鸭 / #d4c25a 黄 / #d47fa6 玫红 / #a8c95a 黄绿）：仅叠加视图的 context hull。逐色相角避开 7 状态色（青 180-200° 避 ready 蓝 250°、黄 100° 避 running 橙 70°、玫红 340° 避 failed 红 25°、黄绿 120° 避 passed 绿 150°）。按 context id 排序取模分配，节点增删不跳色。

### Neutral
- **发丝线两级**（rgba(255,255,255,0.09) / rgba(255,255,255,0.16)）：所有面板边框、分隔线、kbd 描边。0.16 用于 hover 提亮与 active 态边框。
- **画布边阶梯**：纯白 #ffffff 单色，明度只由 stroke-opacity 承载——依赖边 0.45 / 契约边 0.6（虚线 7 4）/ hover 0.9 + 2.5px。diff 高亮用白 0.95 纯形状编码（加粗实线=新增 / 2.5px 虚线 3 3=移除 / 2.5px 点划 8 3=修改）。

### Named Rules
**The 色彩即状态 Rule.** 画布上唯一的彩色是 7 状态语义（及 ADR 三态、簇色两个授权延伸）。选中、hover、focus、开关、激活 tab 一律白明度表达；任何交互组件不得借用状态色相。已知偏差：画布边 hover 用白 0.9（preview.html 提案 0.75），finish review 接受——单载后 0.9 才稳过图形 3:1 线，此值已定档。

**The 单载 Rule.** 边的明度只由 `stroke-opacity` 一层承载，严禁再叠 rgba alpha 值——双重衰减会把边线压到 1.6:1（finish review 实锤），0.45 是任何常驻线素的明度下限。

**The Legend Rule.** 簇色（及任何非状态分类色）必须与图例同屏才可出现（叠加视图左下/工具轨右侧常驻渲染）；颜色永不单独承担无图例的分类语义。

**The 单色边 Rule.** 画布边线永不回到多色盘。`EDGE_TYPE_COLORS` 九色表是数据层遗物，无任何组件消费；边类型语义由 hover 标签（sans 11px 黑晕白字）与 EdgeDetail 抽屉承载。

## Typography

**Display Font:** 系统栈 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif
**Body Font:** 同上（单一 sans 族，无衬线对照）
**Label/Mono Font:** ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace

**Character:** 终端血统的单族系统——sans 承担全部人类句子（中文正文为主），mono 只出现在数据位。全局 `font-feature-settings: "tnum" 1, "lnum" 1` + 计数位 `font-variant-numeric: tabular-nums`，挂屏时数字列不跳动。

### Hierarchy
- **Display**（sans 700，28px/1.25，-0.015em）：节点详情标题，唯一出现处。`text-wrap: balance`。
- **Headline**（sans 700，20px/1.35）：边详情标题（人类可读类型名）、决策文档标题。
- **Title**（sans 650，12px）：面板小节标题（计划/检查点/管辖…）、面板标题、flyout 标题。小节头一律 sans——mono 大写 eyebrow 已废除。
- **Body**（sans 400，14px/1.55 为根字号；面板密排正文 13px/1.7，ink-muted）：说明文字、边界描述、执行报告。上限约 44ch。
- **Label**（sans 650 或 mono 500，11px，+0.02~0.08em）：全部 chips、meta 标签、图例、zoom-hint；结构位 EN 大写用 `--track-caps` 0.08em（品牌名、verdict 徽标）。
- **Mono-data**（mono 500，11-12px，tabular-nums）：id、节点/边计数、时间戳、命令（`graph init`）、kbd 键名、执行者 id。

### Named Rules
**The Mono-Is-Data Rule.** mono 只用于 id、数字、命令、时间戳、kbd、EN-caps 结构徽标；UI 句子、小节标题、正文、按钮文案一律 sans。10px 功能文本已废除，字号下限 11px。

## Layout

三段式纵向骨架，chrome 只占两条窄带：**排 1 品牌行**（品牌 + 可点状态 chips + n/e 统计 + offline 徽标，min 40px）+ **排 2 操作行**（图 tabs + L0-L5 层级 chips + 搜索框 210px，min 34px），合计约 76px（`--header-h`）；主区左缘一条 **44px 工具轨**（`--rail-w`：透镜/决策/版本 · 分隔 · 缩放×3/固定布局 · 专注，z-overlay），其余全部让给画布。间距 4pt 基（4/8/12/16/20/24/32/40/48/64），面板内边距 20-24px，行间距 2-12px 紧凑密排。

浮层几何：抽屉类（节点详情 380px / 边详情 340px 贴右，决策文档 440px 贴左）从 `--header-h` 起到底、0.22s 滑入；flyout 类（透镜/决策目录/版本对比）贴工具轨右侧 `--rail-w + 8px`、10px 圆角。三个 flyout 由 store 互斥（开一个关其余），adrDockOpen 默认展开。

交互行为边界：`localStorage sp.ui.v1` 只持久化当前图名与透镜开关；专注模式为瞬态（刷新即出），布局钉住为会话态。Esc 逐层退出：面板选中 → 对比 → 专注 → 浮层。

**响应式（断点 768px，降级可用为承诺上限）**：工具轨从左缘竖轨转为底部 52px 横轨（含上边线），rail 按钮放大到 44px 触达；顶栏 stats 隐藏、品牌缩号、搜索收窄 130px；抽屉全宽（顶到 0）；flyout/目录/对比面板改为左右 8px 通栏、上移让开底轨（52px+8px）；簇色图例收窄 150px 并让位底轨；zoom-hint 隐藏。

## Elevation & Depth

无投影体系。深度由三件事表达：**z 五档**（canvas 1 < overlay 10 < panel 100 < tooltip 1000，toast 档预留但无实现——画布内常驻小件如图例/对比徽章/zoom-hint 落在 canvas 层内的 z 5，永远让位于 z 10 的轨）、**明度面差**（黑画布 → 0a 轨 → 14 面板 → 1e 内嵌块，越浮越亮一档）、**1px 发丝线**（0.09/0.16 两级）。仅有的两处光效都是状态语义而非装饰：running 节点的 4px 高斯 glow 与下游边上的琥珀流点；ADR 徽章带 1px 微投影（drop-shadow 0 1px 2px 60% 黑）只为在彩色 hull 上保持可读。

### Named Rules
**The Hairline Rule.** 面板之间只有边线没有影子。新增浮层先问 z 档位（五档不得越层），再用 surface 提亮一级 + 发丝线，禁止引入 box-shadow 体系。

## Shapes

圆角三档 + 一枚 pill：3px（kbd、小 chips、进度条、scrollbar）/ 6px（按钮、chips、输入框、卡片内块）/ 10px（浮层面板、抽屉内 flyout 的外框上限）/ 999px pill（专注退出钮、对比模式徽章两处模式横幅）。缩放进度条与徽标可整圆。线型是本世界的第二语义轴：**虚线 = 未定案或非实存**——契约边 7 4、proposed 徽章 3 2、proposed 芯片虚线边框、context 节点 5 4、hull 6 4、diff 移除 3 3、diff 修改 8 3；实线加粗 = 已定案/选中/高亮。画布文字一律带 3px 黑描边晕（`paint-order: stroke`），保证在任意线色上可读。

## Components

### Buttons
- **Shape:** 6px 圆角；触达目标 ≥44px（关闭钮 44px、移动端 rail 44px；桌面 rail 桌面态 36px 视觉 + 轨距补足）。
- **Primary:** 白底黑字（retry：#fff 底 / #000 字 / 6px / 8×16 padding / 600）。hover=opacity 0.88——主按钮的唯一强调手段是明度，永不变色。
- **Ghost:** 透明底 + 发丝线边框（0.09），hover 提到 ink 文字 + 0.16 边线；小号幽灵钮（清除过滤/重试/退出对比）3px 圆角 2×8 padding。链接型（边端点跳转）用 mono 下划线，下划线色 hover 从 0.16 提到 ink。
- **Rail 按钮:** 36px 方形、透明底、ink-muted 图标（16px 内联 SVG 描边 1.5）；hover=surface-1；active（开启态）=surface-2 + 0.16 边框；可带 15px mono 计数徽标（surface-3）。
- **Focus:** 一律 `outline: 2px solid #fff; outline-offset: 1px`（`:focus-visible` 全局规则，鼠标点击不触发）。

### Chips
- **状态 chips（计数即图例）:** 透明底 + 7px 状态圆点 + mono 计数 + 小写状态名；hover=surface-1；按下过滤=aria-pressed + surface-2 底 + 0.16 边框；零计数整枚 0.5 透明度。点击即过滤，不再有第二套图例。
- **Meta chips:** surface-2 底 + 发丝线 + mono 11px（id/type/L 值/日期）；status tag 以同色边框 + 6px 圆点呈现状态色。
- **层级 chips:** mono "L0-L5"，active 同状态 chips；附"清除"弱化变体（ink-faint）。
- **ADR 芯片:** proposed=虚线边框（未定案语义）；selected=1.5px 白 outline（交互白，不借状态色）；superseded=标题划线（ink-faint）+ mono 接替链"→ 被 X 接替"。
- **Diff 徽章:** +/−/~ 计数用 surface-2 方形符号徽章（中性），diff 数字永不占用状态色相。

### Cards / Containers（面板）
- **Corner Style:** 抽屉直角贴边；flyout 外框 10px；内嵌块 3-6px。
- **Background:** 面板一律 surface-1；内嵌块 surface-2。
- **Shadow Strategy:** 无（见 Elevation）。
- **Border:** 1px 发丝线 0.09；面板头 44px 高 + 底部发丝线，含 sans 650 标题 + mono"Esc 关闭"kbd 片（3px 圆角描边）+ 44px 关闭钮。
- **Internal Padding:** 抽屉 body 20-24px；小节以顶部发丝线分隔，节间距 20px。

### Inputs / Fields
- **Style:** 搜索框 210px，surface-1 底 + 发丝线边 + 6px 圆角；placeholder=ink-faint。
- **Focus:** border 提到 0.16；键盘焦点追加 2px 白环。

### Navigation
- **图 tabs:** mono 11px、发丝线边、active=surface-2 + 600 字重；工作区 active 以 6px 空心圆点标记。切图纯本地审阅，绝不写服务端状态。
- **工具轨:** 44px 竖轨（768px 以下转 52px 底轨），按钮 active 用面差表达；专注模式整轨 translateX(-100%) 退场，右下留 pill 形"退出专注 + Esc"出口。

### Signature Component: 拓扑画布语汇
本产品的识别核心，全部值已定档：
- **节点解剖:** 工作流节点 r20 圆（白 0.02 填充 + 白 0.6 描边 1.5px）+ 状态环（r+3，状态色 2px / running 3px）；running 叠加 glow 滤镜与上方 mono 琥珀执行者标签；checkpoint 进度条 28×3 圆角 1.5（passed 绿 / failed 红）。context 顶点 r26 虚线大圆（簇色 5 4）。ADR 顶点不进模拟——以徽章与决策目录呈现。
- **边阶梯:** 白 0.45 依赖（1.5px）/ 白 0.6 契约（2.2px + 虚线 7 4）/ hover 白 0.9（2.5px）+ 中央 sans 11px 黑晕类型标签。单向箭头 marker 白 0.3。
- **叠 加视图:** hull 簇壳（Catmull-Rom 闭合，外扩 r+14，簇色 0.07 填充 + 0.45 虚线描边 + 簇色标签）+ ADR 徽章（15px 高 #141414 0.92 底、状态色描边、proposed 虚线、superseded 1.5px 加粗 + 划线、同锚点 +17px 堆叠）+ 簇色图例常驻。
- **运动语义:** running 状态环 1200ms 呼吸（0.3↔1.0）；模拟收敛后 running 下游边出现 r3 琥珀流点（速度 ≈0.003-0.004/帧）；节点入场 stagger ≤40×15ms 400ms；hover 150ms；面板 220ms；定位 450ms；fit/重置 500ms。UI 态过渡一律 130ms。`prefers-reduced-motion` 全链路降级（呼吸/流点/入场/滑入全停）。
- **标签退让:** fit/缩放稳定后（150ms 去抖）贪心 AABB 避让，状态优先级 running > failed > blocked > ready > passed > pending > cancelled；被退让标签隐藏，hover 恢复。
- **fit 管线:** 挂接模拟收敛（alpha ≤ 0.3）取景一次 + 4s 兜底；同图重渲染保持视角，切图/透镜切换/尺寸变化（180ms 去抖）重新取景。
- **空态三则:** 透镜全关提示 / 过滤无匹配提示（带"清除过滤"幽灵钮）/ 无图与空图（80px 发丝线虚线插画 + mono 命令出路）；加载 = 图形化骨架（6 脉动节点 + 虚线边 1.5s）；错误 = 状态色 SVG 符号 + 白底黑字重试钮。
- **Tooltip:** 仅截断标签触发，surface-2 + mono 12px + 3px 圆角，z-tooltip。

### 状态词汇表（全组件统一做法）
- **hover:** 面差提一级（transparent→surface-1→surface-2）或文字/边线明度提档（ink-muted→ink、0.09→0.16）；画布节点放大 +4、边提 0.9；130ms。
- **focus:** 2px 白环 offset 1px（`:focus-visible` 全局）；SVG 节点用同语言白色描边加粗到 2.5px（g 元素 outline 不可靠）。
- **active/选中:** surface-2 底 + 0.16 边框（chips/tabs/rail）；画布选中 = 白描边 3px；ADR 芯片 = 1.5px 白 outline。
- **disabled:** 无原生禁用组件；弱化用透明度表达（零计数 chips 0.5、非命中节点 0.3）。
- **loading:** 图形化骨架（图形状脉冲）或行内 mono 文案"正在加载…/正在连接拓扑服务…"；快照列表加载为 sans hint。
- **error:** 状态红仅用于真实失败语义（offline 徽标红边框、加载失败标题/重试区、diff 错误文案、adr-flags 红色警告盒 rgba(229,80,79,0.1) 底 + 0.4 边框），附 `role="alert"` 与重试出口。
- **empty:** 中央 surface-2 提示面板（`role="status"`，透镜空态 pointer-events none 不挡画布）+ 每个空态给出恢复路径（命令 chip / 清除过滤钮 / 透镜指引）。

## Do's and Don'ts

### Do:
- **Do** 用白色明度阶梯表达一切交互态：hover 提面差、选中加白描边、focus 2px 白环（offset 1px）。
- **Do** 保持边线单载：白 #fff + stroke-opacity 0.45/0.6，hover 0.9；线型（7 4 契约虚线）承担第二语义。
- **Do** 为 ADR 三态保持线型语义：proposed 虚线 / accepted 勾 / superseded 划题 + mono 接替链——这是本世界最需保护的识别语汇。
- **Do** 簇色出现必配图例；状态不得仅靠色相区分（线型/符号补位）。
- **Do** 图标用 16px 内联 SVG 统一描边（1.3-1.6px），checkpoint/ADR 符号走状态色 12% 底 + 实色图标。
- **Do** 新动效从 130/220/450ms 三档取值（画布内动画例外：150/400/500/1200ms 已定档），单一 ease-out 曲线族，reduced-motion 全量降级。
- **Do** 每个状态给出口：Esc 逐层退出（面板→对比→专注→浮层）、画布空白点击清除选中、空态带命令或清除钮。
- **Do** 触达目标 ≥44px；移动端（≤768px）工具轨转 52px 底轨并放大按钮。

### Don't:
- **Don't** 把状态色用于交互语义（选中/开关/复选框/hover 不借用七状态色相；accent-color 一律灰阶）。
- **Don't** 使用彩色 side-stripe（左缘彩条标记状态已被废除；引用块用 2px ink-faint 中性左边线）。
- **Don't** 使用 Unicode 字符图标（⊘●○✓✗◐⬡⚖ 已废除；一律 SVG 描边路径）。
- **Don't** 用 mono 写 UI 句子或当小节头（mono 大写 eyebrow 已废除；mono 只进数据位）。
- **Don't** 让画布边线回到多色盘或叠双层 alpha；`EDGE_TYPE_COLORS` 不进入任何视觉层。
- **Don't** 越过 z 五档（canvas 1/overlay 10/panel 100/tooltip 1000，toast 档预留）；新增浮层先归档位。
- **Don't** 用 diff 劫持状态色：增删改用白 0.95 纯形状编码（加粗实线/3 3 虚线/8 3 点划）。
- **Don't** 引入 box-shadow 体系或字体/图标库依赖；深度靠 z 档 + 面差 + 发丝线，字体系统栈、图标内联 SVG。
