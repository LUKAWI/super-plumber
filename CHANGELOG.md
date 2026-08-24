# Changelog

## [0.5.3] — 2026-08-24（补丁：S0-6 web 黑屏修复）

> 0.5.2 已发布包 `graph serve` 打开即整页黑屏的紧急修复补丁。

- **S0-6 根因**：web-ui store（`store.svelte.ts`）全部 getter 经 `cur()→bucketOf()` 取桶，桶未命中时 `_buckets[name]=newBucket()`——该写操作发生在模板表达式（Svelte 5 编译为 derived）求值期间，抛 `state_unsafe_mutation`，整棵组件树崩溃；初始渲染 WS 数据未到、桶为空，首个被读的 getter 必崩。漏测原因：既有测试在普通上下文先 set 后 get，无 derived/真实渲染上下文覆盖。
- **修复**：读/写路径分离——getter 统一走 `curReadonly()`（冻结空桶 `EMPTY_BUCKET` 兜底，**绝不建桶**），建桶只发生在事件/异步上下文（`selectGraph`/`applyFull` 等）；响应性不受影响（getter 仍读取 `$state`，真实桶落地后 derived 自动重算）。
- **回归防线（三层）**：`store-probe.svelte.ts`（derived 上下文探针）+ `store-readonly.test.ts`（空桶缺省值/建桶时序 3 条）+ `render-smoke.test.ts`（jsdom 真实挂载 App：无数据初始渲染出骨架屏不崩、`applyFull` 后节点标签真实渲染进 DOM 2 条）。
- **测试工具链**（支撑组件级测试）：vitest 2→3、vite-plugin-svelte 5.1.1→6.2.4（修复 vite 6.4 `preprocessCSS` Environment 兼容）、vite.config 增加 `resolve.conditions: ["browser"]`（Svelte 5 官方测试配方，vitest 默认 SSR transform 会使 `mount` 不可用）。web-ui 54/54 绿、svelte-check 0 错误。
- 发布动作（npm publish 0.5.3）归 fix-review-v052 修复计划 GATE 发布检查单执行。

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
