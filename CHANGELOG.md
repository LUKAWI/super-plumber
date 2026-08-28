# Changelog

## [0.6.2] — 2026-08-28（导出表达升级 + web-ui 星空化重构）

### web-ui 星空化重构（2026-08-28 拍板，impeccable 工作流交付）

- **设计系统 v0.7（terminal-native monochrome）**：画布纯黑舞台 + 灰阶层差 chrome、白阶梯 ink（全文 ≥AA）、状态七色为唯一彩色语义、交互一律明度表达（focus/选中/开关）；两行头部（品牌行 + 状态芯片行，芯片即过滤器）、统一工具轨（透镜 / 决策+badge / 版本 / 缩放 / 布局固定 / 专注模式）、键盘可达整改（节点 Tab 聚焦 + Enter/Space 选中、Esc 优先级链、搜索 Enter 定位、画布空态可清除过滤）。
- **星空隐喻（starfield）**：节点 = V4 八向棱星（白渐变主芒 44-48 + 斜短芒 0.565× + 红蓝错位色差残像，与 docs/design-system/star-node-demo.html 正本逐参数一致）；状态色 = 贴芒 halo（r = 1.04×芒长——光污染源于光球脱芒，贴芒即星体气质）；闪烁相位按节点 id 哈希（同图稳定、星间去同步），running 呼吸幅度最大；星芒旁常显任务摘要（截 20 字，hover tooltip 全文）。
- **交互反馈去图标化**：hover / 键盘焦点 / 选中 / 边高亮一律「声呐环单次扩散 + 白炽脉冲 + 星芒增亮」，圆形节点形态（node-circle / status-ring / node-body）整体退役；检查点进度条移除（颜色系统承载状态与进度）；对比模式 diff 编码改落星芒外细环（diff-ring，仅对比模式显现），边侧保持加粗/虚线/点线语言。
- **边 E1 渐隐星座线 + E3 running 能量流**：每边内嵌 userSpaceOnUse 线性渐变（tick 逐帧同步端点坐标）——两端渐隐溶进星晕；running 源的出边切琥珀能量档（与光点流同源同语义）；契约边保留虚线 + 中段略亮；箭头随星座语言退役，方向语义由能量流与详情面板承载。
- **领域视图星云**：叠加视图中 context 由虚线色框改为按上下文着色的星云斑（radialGradient 云，云内 0.12 → 0），context 顶点化为云心微尘点（云由谁而生可寻）；契约边虚线语言不变；ADR 徽章锚点迁至云缘；云体渐变走 objectBoundingBox，免逐帧坐标同步。
- **银河带背景**：屏幕固定层（CSS 双光带 + 按画布面积生成的微尘、20% 极慢闪烁），不随缩放平移（4× 不穿帮）；微尘/闪烁/声呐全入 prefers-reduced-motion 关停清单。
- 溯源：设计走 impeccable 工作流（PRODUCT.md / DESIGN.md / surface brief + 三轮 finish review 裁决）；提案与定稿 demo 在 docs/design-system/（star-node-demo.html = V4 棱星正本 + 样式变体画廊，star-atmosphere-demo.html = 定稿配置 + 领域星云候选）；web-ui 86 测试全绿 + svelte-check 0 错 + 生产构建通过。

### 导出表达升级（2026-08-27）

- **知识顶点视觉区分**（此前 context 顶点被染成 pending 灰——误导，context 顶点本无状态；ADR 与工作流节点造型无异）：`graph export --mermaid` 与 `graph rebuild`（topology.dot）中 context 顶点改胶囊/椭圆（teal 填充、不显示状态行），ADR 顶点改六边形并按三态着色（proposed 橙 / accepted 绿 / superseded 灰）；DOT 工作流顶点补七态填充色，与 Mermaid 同一调色板。
- **边样式语义区分**（此前 9 种边类型全为实线箭头，"参与排序/门控的硬边"与"语义/文档性软边"无法肉眼区分）：depends_on/validates/fan_out/fan_in 保持实线箭头；decides 与 fallback/iterates 改虚线箭头；relates 改点线无箭头；shares_context 改无箭头开线——Mermaid 与 DOT 两格式映射一致。
- **entry/exit 入图**（此前图级字段在静态导出物中不可见）：导出文件头以注释呈现 entry/exit 描述与逐条验收标准 + 边样式图例（不造顶点，防拓扑语义污染）。
- **兼容性**：label 转义纯函数零改动，既有转义回归全绿；导出仍为纯文本格式（.mmd/.dot），渲染交给外部工具（mermaid.live / Graphviz），不内置位图渲染。
- 溯源说明：本版本为小步快改，未立拓扑图——主线程直接派工两名 subagent 并行施工（代码/文档互斥边界），第三名 subagent 独立交叉质检（规格符合性 + 全量回归 + 双格式冒烟）通过后发布。

## [0.6.1] — 2026-08-27（多工具集成重构：一套工作流资产——pi 直用＋单插件包双工具通用）

> 本版本把工作流资产（角色提示词 / 阶段 skill / 执行脚本 / Operations 手册）重组为可分发集成：
> pi 维持仓库 `.pi/` 原地演进；Claude Code 与 ZCode 经仓库根 `.claude-plugin/marketplace.json`
> 安装同一个插件 `super-plumber`（zcode 走 `.claude-plugin` 兼容回退装载）。全程 multitool-refactor
> 图驱动交付，溯源见文末。

- **多工具集成重构**：`.pi` 双 skill 编排化收缩重写——skill 退为编排剧本（阶段推进 + 硬 gate + 派单模板 + solo 分支），subagent 与 skill 解耦；新增单插件包 `integrations/plugin/`（agents / skills / commands / manual / scripts + 根级 `.mcp.json` 自动接线 graph-mcp），marketplace 收敛单条目 `super-plumber`（source 必带 `./` 前缀——冒烟实证，缺前缀报 `source: Invalid input`）；`package.json` files 增补 `integrations/` 与 `.pi/` 随包分发；新增 `scripts/sync-integrations.mjs` 一致性门禁——手册 / 命令文案 / sp 脚本一份正本构建期同步进插件包（sha256 一致断言，`--check` 模式入 prepublishOnly，漂移即发布失败）。
- **Operations 手册唯一正本**（`integrations/shared/manual.md`，§1–§12）：三访问层（CLI / MCP / 脚本）操作语法、状态机全文、错误处理大表、solo 裁决边界的唯一权威；角色提示词与 skill 的语法引用一律改为「Read 手册 §N」指针（寻址约定 §11：pi 相对仓库根，插件包内相对包根），插件包内 manual 为构建期同步拷贝，杜绝第二正本。
- **sp-designer / super-mario 提示词瘦身**：命令语法表、体检项明细等机械知识迁入手册，提示词只留角色判断力与流程纪律（designer 首步指令即「读手册 §2 与 §6」）；九边选型表判定为设计判断力而非语法，整表迁入 sp-designer 提示词（手册不存第二份，防漂移）；两份 reference.md 退役（头部留迁移指针，发布包不再随带）。
- **solo 裁决规则成文**（手册 §10）：单人单会话、主线程原地扮演角色时，机械核算可自裁——checkpoint 聚合、artifact 存在性、状态层/结构层验收，读数说话并在 notes 留证据；裁量与裁决必须留人——DoD 主观质量、ADR accept/supersede、用户审核 gate、force 类动作，停下列单呈报、不得代签。
- **集成形态裁决（ADR 两步走）**：adr_0001 先定「三套集成分别手写维护、否决单源生成器」——三家 frontmatter 互不通用，手工分别润色的质量优先于模板化机械一致，机械共享件用同步脚本兜一致性；双包组装冒烟经评审证实字节级同构后，用户以 adr_0002 接替——**插件包合二为一**：单包 `integrations/plugin/` 以 `.claude-plugin/plugin.json` 承载、命名 `super-plumber`（不带渠道后缀），zcode 经 `.claude-plugin` 兼容回退装载（example-plugin 官方样板明文背书），marketplace 两条目收敛为一条，`integrations/zcode-plugin/` 删除（内容与单包同构，无信息丢失）。
- **doctor（sp-check-design.mjs）语义修复**：E4 三要素检查豁免知识顶点（context/adr 不要求 plan/checkpoints/DoD）；可达性判定改根汇锚定（唯一无入边根 → 唯一无出边汇，E6/E7 沿此判定，多根多汇 W6 提示收敛）；W2/W3 判据纠偏——W2=无出边、W3=无入边，旧参考文档恰好写反，手册 §12 以代码为准常记防回潮。

### 溯源

- 全程 multitool-refactor 图驱动交付（15 节点全 passed + 5 context + 2 ADR；执行记录与各节点 execution report 见仓库 `.graph/`）；关键决策 adr_0001（分别手写维护、否决生成器）与其接替者 adr_0002（单包合二为一、双工具通用）；zcode 项目级 agents 扫描结论出自静态探针（docs/multitool-v061/zcode-agents-probe.md）。

## [0.6.0] — 2026-08-25（minor：S0-6 web 黑屏修复 + v0.5.2 代码评审 46+5 项全量修复 + web-ui 文案板块 Markdown 渲染）

- 版本决策：原计划 0.5.3 补丁，因含三处行为语义变更升 minor——①cancelled→pending 重开保留 attempts（重开≠重置预算，N5）；②写前校验架构收紧（此前可落盘的残缺数据现被拒，A2）；③快照 manifest 改名 manifest.json（读旧写新兼容，S3-10）。先以 0.6.0-beta.1 预发布（tag=beta）验证，2026-08-25 转正 0.6.0 发布为 latest。

> 0.5.2 已发布包 `graph serve` 打开即整页黑屏的紧急修复补丁。

- **S0-6 根因**：web-ui store（`store.svelte.ts`）全部 getter 经 `cur()→bucketOf()` 取桶，桶未命中时 `_buckets[name]=newBucket()`——该写操作发生在模板表达式（Svelte 5 编译为 derived）求值期间，抛 `state_unsafe_mutation`，整棵组件树崩溃；初始渲染 WS 数据未到、桶为空，首个被读的 getter 必崩。漏测原因：既有测试在普通上下文先 set 后 get，无 derived/真实渲染上下文覆盖。
- **修复**：读/写路径分离——getter 统一走 `curReadonly()`（冻结空桶 `EMPTY_BUCKET` 兜底，**绝不建桶**），建桶只发生在事件/异步上下文（`selectGraph`/`applyFull` 等）；响应性不受影响（getter 仍读取 `$state`，真实桶落地后 derived 自动重算）。
- **回归防线（三层）**：`store-probe.svelte.ts`（derived 上下文探针）+ `store-readonly.test.ts`（空桶缺省值/建桶时序 3 条）+ `render-smoke.test.ts`（jsdom 真实挂载 App：无数据初始渲染出骨架屏不崩、`applyFull` 后节点标签真实渲染进 DOM 2 条）。
- **测试工具链**（支撑组件级测试）：vitest 2→3、vite-plugin-svelte 5.1.1→6.2.4（修复 vite 6.4 `preprocessCSS` Environment 兼容）、vite.config 增加 `resolve.conditions: ["browser"]`（Svelte 5 官方测试配方，vitest 默认 SSR transform 会使 `mount` 不可用）。web-ui 54/54 绿、svelte-check 0 错误。
- 发布动作：0.6.0-beta.1（--tag beta，2026-08-25）与 0.6.0（latest，2026-08-25）均由 fix-review-v052 修复计划 GATE 发布检查单执行；beta 转正后 npm 不允许删除 dist-tag，beta 保留指向 0.6.0-beta.1（latest 已是 0.6.0）。

### v0.5.2 代码评审修复（fix-review-v052，P1-P3；溯源各节点 execution report）

- **写前校验架构（f5，A2/S1-1/S1-8/S3-12/N2）**：writeNode/writeEdge/writeGraph 落盘前统一 schema 校验（毒化对象在源头被拒，文件不落盘）——NaN/负数 level、非法枚举、缺字段的延时炸弹类缺陷单点消灭；contract 校验目标从不存在的顶层 `contract.method` 修正为 `contract.validation.method` + `consumed_by` 逐元素校验；MCP checkpoint id/label 补 `.min(1)`（与 CLI 对齐）；实体 id 拒绝 Windows 保留设备名（con/nul/com1-9 等）。
- **并发与图级锁（f7，S1-3/S1-4/S1-7/S1-11/S3-6 + A1/A3）**：新增图级锁 `__graph__`（锁序恒为实体锁→图锁，锁内用 *Locked/*Core 变体防重入）——graph.yaml 引用列表读-改-写、快照/回滚整体、写路径落盘段全部互斥：并发建节点引用零丢失、快照不再新旧文件混装；createAdr 编号与重复检查入锁内（并发双号不再静默覆盖）；invalidateIndex 缓存键统一（两种 rootDir 传法不再删错键）；工作区事件追加加锁。A1 决策：保留 graph.yaml refs 引用列表（图级锁让写路径原子化、validate 双向校验兜底，删除 refs 属破坏性格式变更留待 v0.6）。
- **MCP 工具补全（f10，S2-1）**：新增 `graph_validate`（schema+环+幽灵边+六条领域规则+引用列表双向漂移，与 CLI 同构）与 `graph_events`（审计回溯：node/kind/last 过滤）——工具面 22→24，agent 具备批量创建后的自检与裁决审计手段；建图/删图/导出刻意不设 MCP 通道在 `graph_list_graphs` 描述中显式说明。
- **MCP 语义修复（f11，S2-2/S2-3/S2-10/S2-11/S2-12）**：`graph_switch` 在 SUPER_PLUMBER_GRAPH 压制下如实上报未生效（不再假成功）；diff `from` 缺省一律回填最新快照（CLI/MCP 双通道对齐文档承诺）；`graph_add_edge` 描述如实披露 fallback/iterates 为文档性标注；审计 actor 透传真实身份（MCP client 名/claim_by，替换 15 处硬编码 "mcp"）；幂等 re-claim 补审计痕迹。
- **MCP 服务层（f12，S3-1/S2-7/S2-8/S3-14/S3-15）**：`as never` 类型逃逸清零（编译期类型检查恢复）；core 桶补导出 graph-dir/domain/eventlog/docs-export/index-service、根入口转口齐备（多图/领域 API 对库用户开放）；`graph_search` 改走缓存索引；`graph_get_graph` 边同窗口分页（edge_total）；uncaughtException 改 fail-fast 退出（不再带病服务）。
- **Web 缓存（f13，S2-9）**：`/api/graph` 与 WS 初始推送统一启用索引缓存（与 watcher 推送同一 I/O 模型），轮询不再全量扫盘；WS 初始推送与 REST 数据一致性有测试锁定。
- **去重（f14，S3-2/S3-3，纯重构零行为变化）**：三处"旧布局 default 目录判定"合一为 graphDirOf、两份图摘要逻辑合一为 summarize（MCP 复用 CLI 实现）；updateExecutionReport 审计事件 kind 双写重构为显式分支。等价性由金样对照测试（重构前输出逐字节一致）保证。
- **转义修复（f15，S3-4/S3-5/S3-11/N4）**：Mermaid/DOT 导出 label 转义（引号/反斜杠/换行）；`createGraph` 手拼 YAML 改构造骨架 + yaml.dump（label 含冒号/井号/引号/换行不再产生非法或被注入的 graph.yaml——N4 PoC 四形回归锁定）+ 图 id 加随机后缀防同毫秒撞号；CONTEXT-MAP 表格 id/label 补 `|` 转义。
- **算法与健壮性（f16，S3-8/S3-9/S3-10/S3-16）**：topologicalSort 头指出队替代 shift()（O(n²)→O(V+E)，10k 图毫秒级）+ 环报错路径 Set 化；CLI 错误分类改结构化 code 双通道（message 兜底）、ENOENT 死分支删除；快照 manifest.yaml（JSON 内容）改名 manifest.json（读侧兼容旧名，历史快照零迁移可见）；锁 pid 复用/长临界区两类已知窗口注释标注 + 真实死亡 pid 回收测试。
- **reopen 语义（f19，N5）**：cancelled→pending 重开**保留 attempts**（原归零使 max_attempts 门禁可被 fail→cancel→reopen 循环无限绕过）——与死认领回收语义对齐；预算耗尽的重开走 CLI `--force`（force_override 审计）。
- **web-ui 文案板块 Markdown 渲染（v0.6.0 并入）**：PLAN / DONE CRITERIA / CHECKPOINTS / EXECUTION REPORT 全部适配 Markdown——marked 解析 + DOMPurify 消毒（XSS 防线）、GFM 全量语法、外链强制 target=_blank+rel=noopener、inline 模式嵌入列表条目与标签；artifacts/blockers 保持 chip 纯文本（路径下划线不被误转斜体）；组件 11 例 + 集成 5 例，web-ui 70/70。
- **承诺-实现断言与文档同步（f17，A5）**：四处"承诺-实现"断言纳入测试防漂移（工具计数=24 [tools-coverage TC-01]、artifacts 核验 [artifacts-check ART-01..04]、diff 默认值 [semantics SEM-02/03]、fallback/iterates 文档性标注 + 刻意无 MCP 通道披露 [description-contracts DC-01/02]）；双语 README 同步至 24 工具/27 命令/0.6.0；全量回归 504 例后端全绿 + CLI validate 演练。

## [0.5.2] — 2026-08-24（已同步 GitHub，未发 npm）

> 单工作区多图管理：一个 `.graph/` 管多张命名任务图，agent 像切 git branch 一样按名切换、
> 定向编辑，配全链路选错图兜底与多图并行渲染。设计经 grilling 六问共识（进程内 active 双层
> 语义/扁平布局+一次性迁移/5 CLI 命令+2 MCP 工具/五兜底机制/多图并行渲染/难度总评）。
> 全程 super-plumber 工作流自举交付（7 节点全部 passed；问题记录见 docs/v0.5.2-issue-log.md）。

### 核心能力

- **存储布局（扁平 + 一次性迁移）**：`.graph/{active, schema.yaml, workspace-events.jsonl, default/, <图名>/, .trash/}`——每图一个一级目录（图内=完整既有布局），每图独立锁/索引/事件/快照；旧仓库零迁移兼容（旧布局原地识别为 default），建第二张图时工作区级锁内一次性 renameSync 6 项迁入 `.graph/default/`（`.locks` 刻意不迁——工作区级互斥锁的家，见 issue log A4）。
- **图目录解析五级链**：`--graph 参数 > SUPER_PLUMBER_GRAPH > 进程内 active（仅 MCP）> .graph/active > default`；CLI/MCP 共用 core 解析器；错名报错列全部可用图 + did-you-mean，绝不静默滑级。
- **CLI 命令面（22→28）**：`graph init <内容名>`（新仓库必须带名；旧仓库带名 = 迁移+建图+设默认；`--force` 软删重建）、`graph switch [<名>]`（带名改写默认+目标摘要+原图 running 在途提示；无参显当前含来源）、`graph list [<名>]`（全量结构化含当前标记 / 单图详情，`--json`）、`graph rename-graph`（active 随迁+审计）、`graph delete-graph --confirm`（默认拒绝、拒删最后一张、拒删 active 默认、`.trash` 软删除可手工救回）；全部数据命令支持 `--graph` 与 `SUPER_PLUMBER_GRAPH`；关键输出首行标图名。
- **MCP 工具面（20→22）**：`graph_switch`（**进程内** active——每个 agent=独立 MCP 进程=独立当前图，不落盘不污染工作区默认，重启回落）与 `graph_list_graphs`；**全部 22 个工具响应统一附 graph 名回显**；跨图智能纠错（当前图缺失节点/边 id → 报错附『它存在于图 X，请先 graph_switch』，多命中全列，提示绝不代切）。
- **Web UI 多图并行渲染**：递归监听全部图目录按图路由 ws/HTTP（`/api/graphs` 图列表、`/api/graph?graph=` 指定图）；折叠任务栏/开关式选图器（有几张渲染几张，初始选中=工作区 active，切换纯审阅不影响 CLI/MCP），store 按图分桶、后台图持续热更新；UI 纯只读。
- **领域结构 dogfood**：本图 4 context（多图存储/CLI 命令层/MCP 协议/Web 可视化）+ 3 ADR（扁平布局一次性迁移/双层 active/.trash 软删除，均 accepted）+ decides 挂接 + 跨 context 契约边；`export --docs` 视图再生（旧 v0.5.0 导出归档 `.retired/`）。

### 缺陷修复（执行期发现，见 docs/v0.5.2-issue-log.md）

- **A1**：MCP 回显层批量替换把 jsonGraph 内部 return 也替换成自身 → 自递归栈溢出——已修。
- **A2**：CLI 未初始化守卫在 rootDir 语义变更后双拼 `.graph`——已修（守卫改为图目录内 graph.yaml 存在性）。
- **A3**：特定 Unicode 文件名的 `fs.rmSync` 是进程级崩溃（exit 127 无异常可捕）——导出清理改 `renameSync` 归档 `.retired/`（snapshot 回滚同类风险列为后续优化）。
- **A4**：并发建图迁移把 `.locks` 搬走致等待锁进程 ENOENT 崩溃——`.locks` 移出迁移清单（专项并发测试锁定）。
- **C3**：dogfood 首版验证声明失实被裁决拦截（init 契约变更后 core 套件漏跑）——已修正，教训入 issue log。

### 专项性能实测（tests/perf/multigraph-perf.test.ts）

- 多图解析热路径：10 图工作区 resolveGraphDir/toGraphDir 千次中位数 <2ms（实测 ~0.1-0.7ms），listGraphNames 50 图 <10ms——多图兼容对热路径开销可忽略。
- 快照自动导出（v0.5.1 CONTEXT-MAP 功能）：40 节点+7 知识顶点图快照中位数 <2s、幂等重跑 <500ms；10 图工作区中单图快照不受周边图影响。
- 全局隐患推测 5 项（G1-G5：多图 export 目标冲突/纠错扫描成本/rename-delete 窗口期/workspace-events 无限增长/default 认知歧义）记录于 issue log，待后续版本处理。

### 行为变更（升级注意）

- `graph init` 在新仓库**必须带图名**（内容命名，禁止 default 式指代不清名称）；无名单图 init 与 `--force` 语义调整见 CLI 参考。
- 图内路径从 `.graph/{nodes,…}` 变为 `.graph/<图名>/{nodes,…}`——依赖旧路径的脚本需适配（未迁移仓库完全不受影响）。
- MCP 全部工具响应新增 `graph` 字段；`graph_get_graph`/`graph_get_node` 等语义不变。

## [0.5.1] — 2026-08-22（已同步 GitHub，未发 npm；按用户指令暂缓全量测试）

### 遗留问题修复（docs/v0.5.0-issue-log.md D1-D5 处置）

- **D1**：validate 出口检查拆分——原 `!exit.description || criteria 为空` 的或逻辑在
  "描述空但验收标准实有"时误报"验收标准为空"；现在描述与标准各自独立警告。
- **D2**：门禁前驱去重——fan_out 与 depends_on 平行同向标注同一前驱时，`前置未满足`
  列表与 blocked.unmet 不再重复点名（gateReverseAdj 构建源头去重，含旧格式缓存推导路径）。
- **D3**：契约边警告按集成点（source→target 对）分组判定——平行标注边任一条声明契约即视为
  集成点已声明，警告按集成点汇总一次并列出全部未声明边，不再逐边重复。
- **D4**：export 同号旧文件清理加固——个别环境 rmSync 对 Unicode 文件名静默崩溃，删除失败
  时降级为把旧文件覆写成指向新文件名的跳转注记（导出永不因此中断，幂等保持）。
- **D5**：双语 README FAQ 新增"升级包后 MCP 工具表现还是旧版本→重启 MCP server"条目。

### 新增能力

- **快照自动导出领域文档（无 LLM 决策的纯工具行为）**：`graph snapshot`（CLI 与 MCP）创建
  快照时自动导出 CONTEXT-MAP.md + docs/contexts/*.md + docs/adr/*.md——快照即设计定稿点，
  md 视图随快照点落盘，git 提交即冻结"图+文档"一致状态；导出失败不回滚快照（非致命，
  原因记入 snapshot_created 事件）。
- **文档导出上移 core 层**（src/core/docs-export.ts）：CLI `export --docs` 与快照自动导出
  共用同一实现。
- **领域文档书写模板**：plumber-design reference.md 新增 §7——context 顶点（boundary 划界
  句式、glossary 定义句式）与 ADR 顶点（六字段写法、三判据、极简原则）的书写范式；
  格式决策：真相源是 YAML 顶点字段，markdown 只是导出视图，不在图里存 markdown。

## [0.5.0] — 2026-08-22（已发布 GitHub，未发 npm）

> 本版本把 domain-modeling 的设计融合进工具：**bounded context 与 ADR 成为图中一等公民**，
> 直接进入 agent 的设计与执行工作流。设计经一轮 grilling 对齐（D1-D8 决策点），下表可溯源。

### 设计溯源矩阵（grilling 决策 → 实现）

| 决策 ID | grilling 共识 | 实现 |
|---|---|---|
| V5-锚点 | 主线级、图原生领域语义（方案 A） | 知识顶点（context/adr）与工作流顶点同图共存，零新存储机制 |
| V5-D1 | ADR/context 一等顶点；术语是 context 内容不是顶点（节点即文档） | NodeType+context/adr、boundary/glossary/ADR 内容字段、context 外键归属；`graph export --docs` 导出 md 视图（图为真相源） |
| V5-D2 | 双图分离 + 显性映射（map 过滤架构，单独看是一等能力） | map 由类型派生（nodeMapOf/deriveMaps/edgeMapsOf）；Web UI 勾选器 + 领域视图 + 叠加视图（簇壳/ADR 徽章/契约边高亮）；UI 纯只读 |
| V5-D3 | ADR 触发矩阵：claim 指针 + 调度旗标 + skill 判据 + 裁决管状态 | claim/get_node 响应附 governing_adrs；next-actions 条目附 adr_flags；三判据进 plumber-design；accept/supersede 归 Super Mario/人类（提议/裁决分离） |
| V5-Q3 | context 无状态（废弃=删除，悬空归属逼重新归属） | transition 层拒绝一切 context 状态变更；悬空引用 validate=error |
| V5-Q4 | relates 单类型 + 自由 kind 标注（防装饰边回潮） | EdgeType.Relates（rel_kind 自由文本，非 DDD 枚举）；两端必须 context 顶点（error） |
| V5-Q5 | 交付：单次 v0.5.0、不做 import | 本版本一次性交付 core/CLI/MCP/WebUI/skills 五层；ADR 手工录入（dogfood 节点验证） |
| V5-Q6 | super-mario/sp-designer 提示词升级 v0.5 | ⑧ 领域裁决职责 + 工具参考附录；designer 四阶段流程 + 人类审核闸门 |
| V5-fix | （执行期 Mario 裁决发现）索引缓存 Windows mtime 写后读陈旧 | fix_index_cache：写路径主动 invalidateIndex，根治预存 flaky |

### 新增能力

- **知识顶点**：`type: context`（节点即文档：boundary + glossary 术语表）/ `type: adr`
  （decision 必填，label 即标题）。豁免调度与工作流状态机；旧图零迁移（新字段全可选）。
- **ADR 生命周期**：`graph adr create/accept/supersede/list`（create 自动编号 adr_NNNN 落
  proposed；supersede 原子完成状态+superseded_by，接替者三重校验）；MCP 新增
  `graph_create_adr`（第 20 个工具），superseded 两步法（update_node 设 superseded_by →
  update_node_status）；事件 adr_created/adr_accepted/adr_superseded 落审计日志。
- **决策变更传播**：claim 响应与 `graph_get_node` 附 `governing_adrs`（标题级指针）；
  `graph next` 条目附 `adr_flags` ⚠️（依据已 superseded → 建议重审；decides 打在
  context 上时传播给全体成员）。上下文经济红线：只注入指针，永不全文推送。
- **知识边**：`decides`（ADR → 任意顶点，决策管辖）/ `relates`（context↔context，
  rel_kind 自由标注）。均不参与拓扑排序与门禁。
- **契约边激活**：跨 context 的工作流边必填 contract（休眠字段获得第一个运行时语义）；
  六条领域校验规则进 `graph validate`（悬空归属=error、同 context 术语重复=warning、
  缺契约=warning、relates 端点=error、孤儿 ADR=warning、decides 来源=error）。
- **map 透镜（Web UI）**：左侧勾选工作流图/领域图任意子集；领域视图渲染 context+relates
  与术语详情；叠加视图 D3 簇壳包裹成员 + ADR 徽章 + 契约边高亮；边可见 ⇔ 两端 map
  都激活。UI 保持纯只读（裁决走 Super Mario/人类通道）。
- **`graph export --docs`**：ADR → docs/adr/NNNN-slug.md（格式对齐既有手写 ADR）；
  context → CONTEXT-MAP.md + docs/contexts/<id>.md（domain-modeling skill 约定格式，
  非 graph 工具照旧可读）。根 CONTEXT.md（手写术语表）不受影响。
- **CLI 领域参数**：create-node `--context`；update-node `--set-context`（空串清除）/
  `--boundary` / `--glossary-add`；add-edge `--rel-kind` / `--contract`。
- **索引缓存写路径主动失效**：Windows NTFS mtime 滞后墙钟曾导致长驻进程（MCP/Web）
  同进程"写后读"陈旧（phase3 旧用例 flaky 根因）；parser 全部变更原语落盘后
  invalidateIndex，确定性失效。
- **skills 更新**：plumber-design 新增 Step 2.5 领域建模 + Step 2.6 ADR 三判据 +
  契约边规则 + 三透镜审阅的审核闸门强化（绝不自链执行）；plumber-execute 新增
  governing_adrs 必读与 adr_flags 停下重审纪律；修复两处 v0.4 残留（SKILL.md 与
  reference.md 的"修改 plan 自动归零"错误描述）。

### 行为变更（升级注意）

- `graph export` 默认行为不变（mermaid）；文档导出改为 `graph export --docs` 子模式。
- ADR/context 顶点的 status 不再适用工作流七态（adr 三态、context 恒 pending），
  状态机与 schema 双层拦截。
- 知识顶点永不进入 next/get_next_actions 的调度桶与 summary 计数（完成判定排除）。

## [0.4.1] — 2026-08-18

### MCP 全局配置一次、随项目自动跟随（用户核心诉求修复）
- **动态图目录定位**：`--root`/`SUPER_PLUMBER_ROOT` 固定覆盖之外，新增两级自动定位——
  ① MCP workspace roots 协议（客户端上报当前项目根，取第一个含 `.graph/` 的，5s TTL 缓存）；
  ② 服务进程 cwd 向上逐级查找 `.graph/graph.yaml`。每次工具调用时求值，
  用户把 MCP 配置写进 agent 全局配置一次即可，换项目不改配置、不需要填路径。
- **定位失败报可读错误**：未初始化的目录返回"图目录未初始化…请 graph init 或 --root 指定"，
  不再静默返回空图误导用户。
- **新增 `super-plumber` bin 别名**（与包名去 scope 同名）：全局安装后可直接
  `super-plumber` 启动 MCP server；npx 形式简化为 `npx -y @lukawi/super-plumber`。
- README zh/en 接入配置章节重写：全局安装 + 零路径配置为推荐路径，附解析优先级说明与 FAQ。
- 测试 +4（E2E）：roots 上报 workspace 定位 / cwd 子目录向上查找 / `--root` 覆盖 / 未初始化报错。

## [0.4.0] — 2026-08-17

> 本版本是对一次全面代码评审（A–F 级发现）的可溯源修复。每项修复独立提交，
> 提交信息与下表 ID 一一对应，评审结论可在 git log 中逐条回查。

### 评审溯源矩阵

| 修复 ID | 评审发现（级别） | 内容 |
|---|---|---|
| FIX-A1 | A 级·信任模型 | MCP 通道协议级拒绝 force（agent 无法越权绕过门禁/次数上限；人类运维收敛为 CLI `--force` 并留审计事件） |
| FIX-A2 | A 级·自我豁免后门 | attempts 重置必须显式请求（CLI `--reset-attempts` / MCP `reset_attempts`），移除"改 plan 自动重置"；重置必写审计事件 |
| FIX-C1 | C 级·无事件日志 | append-only 事件日志 `.graph/events.jsonl` + `graph events` 命令；全部写路径挂载，actor 透传（cli/mcp/claimBy） |
| FIX-B1 | B 级·运行时边装饰性 | `detectHiddenCycles`：检出 fan 门控边闭合的互等死锁环（拓扑排序不可见但门禁今天就会死锁）；validate 对 fallback/iterates 边发"无运行时语义"警告、shares_context 计数提示 |
| FIX-C2 | C 级·设计/执行同卷 | design-only 回滚：`rollback --design-only` 只回卷设计字段、保留执行进度（status/attempts/execution_report），快照后新增节点删除、缺失节点恢复 |
| FIX-E1 | E 级·快照无锁 | 快照/回滚共用全局互斥锁 `__snapshot__`（多文件复制不再与同类操作交错产生撕裂快照）；备份走无锁内层避免重入死锁 |
| FIX-F1 | F 级·调度无优先级 | 节点 `priority` 字段全链路（schema/create/update/CLI/MCP）；ready 与 ready_eligible 按 (priority, level, id) 排序 |
| FIX-F2 | F 级·stale 无心跳 | stale 判据改为最后活动时间 max(updated_at, started_at)——checkpoint/报告上报即心跳，长任务不再误报"疑似卡住" |
| FIX-DOC | 文档滞后/哲学矛盾 | 双语 README/CONTEXT/.pi skill 全面同步；存储章节明确"以 Git 为真相源的工作流不应 gitignore .graph/" |

### 信任与审计（A 级 + C1）
- **事件日志**：`graph events [--node] [--kind] [--last N] [--json]` 一键追查"何时、何人、改了什么"；事件类型覆盖创建/删除/状态流转/claim/force_override/checkpoint/裁决/attempts_reset/reclaim/快照/回滚；撕裂行读取时跳过不毒化。
- watcher 忽略 `events.jsonl`（事件写入不触发 Web 全量推送）。

### 行为变更（升级必读）
- MCP `graph_update_node_status` 传 `force: true` 从"生效"变为**协议错误**。
- 修改 `plan.description` **不再**重置 attempts；必须显式 `reset_attempts`。
- `graph_get_next_actions` 的 ready/ready_eligible 条目新增 `priority` 字段并按其排序。

### Roadmap（本轮明确不做，防再犯"纸面能力"）
- **monorepo 命名空间/子图组合**（评审 D 级）：节点无 package 作用域、无跨图引用、无"子树任务包"执行单元。单图巨图与多图割裂的两难仍在，需架构级设计后实施。
- fallback/iterates 的运行时语义仍未实现（现状已由 validate 警告显式化，不再是静默的纸面承诺）。

## [0.3.0] — 2026-08-17

### 性能（大图热路径）
- **索引两级缓存**：新增 `src/core/index-service.ts`——内存缓存 + 磁盘 `index/graph.json` 双轨，逐文件 mtime 精确新鲜度校验（跨进程写入可见，2 万次 stat 实测 ~0.4s vs 2 万次读+解析 ~9.4s）。
- **门禁不再全图扫描**：`checkReadyGate` 走缓存索引的 `gateReverseAdj` 查表 + 按需直读前驱文件。10k 图实测 **9.1s → 231ms**（39×）。
- **调度 O(N+M)**：`computeNextActions` 基于缓存索引单遍扫描（原 O(N×M)，16k 图 15.9s → 10k 图热路径 **282ms**）。
- **WebSocket 风暴消除**：watcher 忽略 `.locks/`/`snapshots/`/`index/`（含目录自身 addDir 事件）；非节点事件 250ms trailing 去抖；全量重建走缓存索引。回归测试：状态流转只产生增量推送、快照零全量推送、连续边变更合并为一次。
- 性能回归测试 `tests/core/perf.test.ts`（5k 节点链，冷/热/门禁/单点读阈值断言）。

### 正确性（工作流程拓扑）
- **passed 硬门禁（第三条硬规则）**：`running → passed` 核心层强制——execution_report.summary 非空、无 `verification.verdict: failed`、checkpoints 全部 passed/skipped。`--force` 仅人类运维。
- **死认领回收**：新转换 `running → pending` + CLI `graph reclaim` + MCP `graph_reclaim_node`——清空 assigned_to、notes 附回收记录，attempts 不变。
- **cancelled 重开**：新转换 `cancelled → pending`（attempts 归零），修复"取消即永久作废 + 毒死下游汇合点"。

### Agent 接口（计划拓扑 + 上下文经济）
- `graph_get_next_actions`：新增 **ready_eligible** 桶（门禁已满足的 pending/failed——冷启动入口）；每桶 `limit` + `truncated` 分页；`assigned_to` 过滤。
- `graph_get_graph`：默认 **summary 模式**（紧凑节点字段）+ `mode=full` 时 `offset/limit` 分页。
- `graph_search`：`limit` 上限 + 紧凑结果（`{total, limit, nodes}`）。
- `graph_traverse`：`max_nodes` 上限，返回 `{nodes, truncated}`。
- `graph_get_node`：`include_neighbors: up|down`（基于索引，零额外扫描）。
- MCP 19 工具、CLI 20 命令（`graph reclaim`、`get-node --neighbors`）。
- 协议层同步：plumber-design / plumber-execute / super-mario / CONTEXT / README。

### 测试
- 后端 216 → **247**（+31：索引缓存一致性、门控邻接、ready_eligible、passed 三门禁、reclaim、重开、5k 性能预算、ws-storm 集成）。

## [0.2.0] — 2026-08-13

### 安全修复
- **路径穿越（P0）**：`graph serve` 静态文件服务强制约束在 `web-ui/dist` 内，`/../`、`%2e%2e`、反斜杠变体统一 403（`tests/web/server.test.ts` 回归）。
- `graph validate` 全部错误路径退出码非 0（历史两处"报错但 exit 0"假成功修复）。

### 正确性（P1）
- **原子认领**：锁文件（`.graph/.locks/`，O_EXCL + 陈锁回收）内重读-校验-写回；并发 claim 同一节点恰好一个成功，败者收到"already claimed by X"；同一认领者重复 claim 幂等。
- **ready 门禁**：进入 ready / 认领前校验 `depends_on`/`validates`/`fan_in`/`fan_out` 前驱必须 passed，报错点名前驱；`--force` 仅人类运维。
- **max_attempts 强制**：达上限禁止重试；修改 plan.description 自动重置 attempts（CONTEXT 规则）；`max_attempts=0` 不限。
- **checkpoint 状态机**：pending→running|passed|failed|skipped、running→passed|failed、passed|failed|skipped→pending；同状态幂等。
- **YAML schema 校验层**：读入逐文件校验（手写零依赖，宽容未知字段），拼错即时报可读错误；`graph validate` 逐文件定位。
- 删除节点默认拒绝有引用边的操作（`--cascade` 连删）；新增 `delete-edge`；`createEdge` 核心层校验端点存在。
- `zod` 显式声明为依赖（幽灵依赖修复）；`engines.node >=20`；移除 `import.meta.dirname`。

### 设计愿景补全（P2）
- **版本控制**：`graph snapshot`（可 `--git`）/ `snapshots` / `diff` / `rollback`（自动 pre-rollback 备份 + 必须 `--confirm`）；MCP 对应三工具。
- **图级编辑**：`graph update-graph` / `graph_update_graph`——entry/exit/验收标准不再手写 graph.yaml。
- **调度决策**：`graph next` / `graph_get_next_actions`（ready/blocked/running/stale_running 一屏）。
- **裁决**：`graph verdict` / `graph_update_execution_report` 的 verification 参数。
- `graph get-node`（合法转换 + checkpoint 聚合 + 门禁状态）；`status`/`validate`/`next` 支持 `--json`。
- `index/` 新鲜度缓存（逐文件 mtime 比对）+ `topology.dot`；`graph init` 写 `schema.yaml`。
- `aggregateCheckpointStatus` 接入 validate 输出。

### MCP Agent 原生化（P3，9 → 18 工具）
- 设计期补全：`graph_add_edge`、`graph_delete_edge`、`graph_update_node`、`graph_update_graph`、`graph_batch_create`（全量预校验报全部冲突）、`graph_create_node` 支持一次建完整压缩包。
- 执行期强化：`graph_update_node_status` 原子 claim + 门禁/次数上限错误消息；`graph_get_node` 附带 allowed_transitions/ready_gate。
- 版本三工具；`--root` / `SUPER_PLUMBER_ROOT` 服务定位；工具描述重写为决策导向。
- **E2E 纯 MCP 全流程测试**：设计→调度→claim→checkpoint→report→verdict→passed→三层验收。

### Web UI（P4）
- 修复 fitToView 死代码（改模拟坐标 + 抽取可单测的纯函数）；断线指数退避重连 + HTTP 兜底；adjacency 正确序列化；删除重复 CSS；状态色三处统一（CSS 变量/TS/Mermaid 导出）。
- 布局持久化：节点位置缓存 + 仅边变化时增量更新边层（不再全图重抖）；缩放视角跨重渲染保持；固定布局开关（大图性能）。
- 详情面板补全：EXECUTION REPORT（summary/artifacts/blockers/verification 徽标 + 时间戳）、plan 输入/上下文、quality gates。
- 新增：边详情面板（语义/端点跳转/合约）、版本 diff 视图（快照列表 + 画布绿/红/黄着色 + 状态变化明细）、L0–L5 层级过滤 + 搜索 + 状态摘要条 + 图名显示 + offline 指示。
- 前端测试基建：vitest + jsdom + svelte-check（0 error），12 个单测。

### 生态与文档（P5）
- 包公开 API：`@lukawi/super-plumber/core` 桶导出；skill 脚本改走公开 API（本地→全局回退），`sp-*.sh` 全部重写为跨平台 `.mjs`（去 GNU grep）。
- `plumber-design`/`plumber-execute`/`super-mario`/`sp-designer` 全面同步（update-graph、next-actions、verdict、门禁错误、force 红线）。
- CONTEXT.md 补 裁决/调度决策/版本快照术语 + 门禁与次数上限语义；README 中英同步（19 命令 / 18 工具 / 新 FAQ）。
- CI：ubuntu+windows × Node 20/22，后端 + 前端（build/typecheck/test）全链路；测试 badge 真实化。

### 测试
- 后端 97 → **216**（含并发认领 5 进程竞争、路径穿越、门禁、快照往返、缓存失效、18 工具协议、纯 MCP E2E）。
- 前端新增 **12**（重连/布局纯函数/store）。
- 性能回归：10k 深链 validate 不回归；缓存命中路径。

## [0.1.1] — 2026-08

- 初版发布：11 CLI 命令、9 MCP 工具、状态机、Web UI、双 skill 协议（历史记录见 git log）。
