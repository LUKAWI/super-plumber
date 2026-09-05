# Changelog

## [0.9.6] — 2026-09-05（patch：并发、索引、快照与 Web/UI 边界加固）

> 主题：在不改变既有拓扑语义的前提下，收口跨实体并发一致性、缓存代际、输入契约、快照回滚和 Web/UI 边界，形成可复验的 0.9.6 修复版候选。

- **图身份与跨实体并发一致性**：统一规范化 graphDir 作为快照/事件/嵌套 amend 的 scope key；节点、边和引用写入保持身份绑定与事务补偿；锁增加跨进程 waiter 单槽交接，降低 Windows 热写入 race，并保留 stale 回收与 CAS 式释放。
- **Index 缓存与写入代际一致性**：以源文件快照生成 generation，构建前后和图锁内提交前后复核；临时 index 解析校验后原子替换，过期结果拒绝提交，旧格式 index 回源并兼容补推导。
- **Schema 与审批契约收口**：graph entry/exit、edge.type、review.status/by/at/layers 的输入约束在 schema 层稳定校验；CLI、MCP、Web 和 scheduler 对明确 `approved` 的审批语义保持一致，存量格式继续兼容。
- **Snapshot 路径隔离与原子回滚**：snapshot 标识及派生路径执行 containment 校验；回滚采用 staging、完整校验、备份和原子切换，失败可恢复，覆盖跨图、软删除与故障注入路径。
- **Web API/WS 与 UI 状态边界**：补齐脱敏错误与恢复推送契约，限制 Origin、连接洪峰和慢客户端；UI fallback 校验 HTTP/payload，切图与同 ID 更新按图数据代际重建，避免旧状态伪成功。
- **验证**：后端 99 文件 **858 用例**、web-ui 12 文件 **117 用例**全绿；root typecheck/build、UI typecheck/build、`sync-integrations.mjs --check`、`export --docs --check` 与真实 MCP SDK stdio handshake 均自然退出 0。取证见 `docs/roadmap-to-1-0-0/v096-release-evidence.md`。
- 发布动作：npm 0.9.6（latest）+ GitHub tag v0.9.6（由本节点在授权后执行）。

## [0.9.5] — 2026-09-04（minor：Codex 官方插件渠道 + 叶子复核防嵌套）

> 主题：以官方 `.codex-plugin` 形态接入第四渠道（pi / Claude / ZCode / Codex），共享既有 plugin 包、skills、scripts 与手册；不改图核心语义。同步收紧代理派单边界：复核纪律为纯叶子方法，防止代理在读到同一技能后递归派生。

- **Codex 官方插件渠道（adr_0015）**：新增 `integrations/plugin/.codex-plugin/plugin.json`，注册 6 个 skills 和内联 `graph-mcp` stdio 配置；仓库 `.agents/plugins/marketplace.json` 以 `local` source 指向共享 `integrations/plugin/`，策略 `AVAILABLE` / `ON_INSTALL`。Claude 清单同步移除当前 CLI 拒绝的旧式 `skills` 与 `description_i18n` 字段，改由插件目录自动发现 skills；`.mcp.json` 保持原状。
- **Codex 文档与可选角色**：README 中英文补齐 marketplace 安装、本地/NPM 兜底、Windows `npx` 包装和渠道边界；manual §11 固化 Codex 缓存包根 `Read ./manual.md` 寻址；可选 `.codex/agents/sp-designer.toml`、`super-mario.toml` 作为项目级增强，不进入插件缓存。
- **代理层级防线**：`plumber-review` 取消任何派单权，所有调用均为叶子证据复核；双轴独立复核仅能由外层协调者直接派发，checkpoint/verdict/状态由独立 Super Mario / 裁决者核验证据后写入。`plumber-design`、`plumber-execute` 的派单模板和三份角色定义均加入叶子约束，禁止被派角色创建、转派或唤醒下级 agent，避免嵌套循环与自我裁决。
- **验证**：插件 schema、gen/version/散文锚点门禁、后端 822 项和 web-ui 109 项测试、双端构建、npm 打包预检、Codex 本地 marketplace 安装与 `graph-mcp` 注册、Windows `npx` stdio 初始化均通过；取证见 `docs/roadmap-to-1-0-0/v095-codex-plugin-evidence.md`。
- 发布动作：npm 0.9.5（latest）+ GitHub tag v0.9.5。

## [0.9.4] — 2026-09-04（minor：单真相源重组——integrations/src/ 唯一正本，双视图变构建产物）

> 主题：adr_0008 落地——从「几份一致」升级为「只有一份，其余全是 gen 产物」：正本收拢 `integrations/src/`，gen+比对进 CI 与 prepublishOnly，0.9.1 式 SKILL 双副本漏传（IL-028/B1）被机器根绝。重组本体不夹带语义变更；本版唯一新增读面能力为 F18 oneline，hooks 与纪律族均为默认不激活的可选资产。

- **S01 单真相源重组（adr_0008 accepted）**：skill/agent/命令/手册/脚本正本收拢 `integrations/src/`；`.pi/`、`integrations/plugin/`、`integrations/shared/` 全部变 gen 构建产物，`scripts/sync-integrations.mjs` 演进为 gen 引擎——渲染比对 `--check` 不一致即 exit 1（原 sha256 三方同步断言退役）；SKILL/agents 副本传导纳入 gen 面（改正本不重新生成＝双渠道同时判漂移，IL-028 机制性根治）；CI 增 gen --check 步；prepublishOnly 门禁改为生成完整性检查。迁移清单 `integrations/src/MIGRATION-0.9.4.md`。
- **C1 核心错误码六枚 + CLI defineCommand 统一骨架**：新建 `src/core/errors.ts`（NODE_NOT_FOUND / WORKSPACE_NOT_INITIALIZED / INVALID_TRANSITION / GATE_NOT_SATISFIED / ATTEMPTS_EXHAUSTED / VALIDATION_FAILED，机器可读单源）+ `src/cli/runner.ts`（图目录解析/枚举校验/JSON-文本切换/错误码→退出码映射单源，coerce 摘除 process.exit 变纯函数）；29 条命令一次性全迁（增量迁移已否决），命令文件退化为 flags 声明+纯渲染；isNodeNotFound 三副本删除、ENOENT 提示 6 份归一、枚举校验 6 份收口。
- **F18 `graph status --oneline` 双通道**：一行图状态摘要（图名/进度计数/百分比/前沿数/running/failed/blocked，零值照排）；CLI 旗标 + MCP `graph_list_graphs` 增 `oneline` 参数同款字段（26 工具数不变，双通道逐字等价金测锁定）；hooks session-brief 与 journey 提示的数据源。
- **S03 八脚本收敛 sp.mjs 单入口（≡ CLI 语义面）**：sp-claim/sp-update-status/sp-checkpoint/sp-report/sp-get-node/sp-traverse 七脚本 + sp-check-design 收编为 `sp.mjs` 子命令式薄封装（claim/update-status/checkpoint/report/get-node/traverse/check-design），只做参数组装→调 CLI→错误透传，零依赖仅 node 内置；旧脚本全产物面退役（grep 无残留）；manual §2.6/§4.1/§7 寻址改 sp.mjs 形态+渠道自适应模板变量；插件渠道按寻址行实跑 check-design 取证（0 error 退出）。pi 真会话回归因本机 pi 未配置以 node 直跑两渠道产物等价替代（用户拍板，执行报告留档）。
- **S02 SKILL.md 分层**：plumber-design 主文档 113→68 行、plumber-execute 158→99 行（常驻 token 只减不增，DEC-4 口径）；七件 attachments 落位（workflow-classes / review-brief / disciplines-map / wayfinder-mode / amend-mode / context-hygiene / prototype-research），细节迁出主文档+指路寻址；gen 双视图同步。
- **S05+S09 subagent 瘦身与执行三角补全**：sp-designer/super-mario 定义只留角色+边界+指路（协议细节归手册与工具响应）；新增 sp-executor 定义（协议唯一来源指向 plumber-join，零复制）；DEC-4 入口冻结首次解除（经 DEC-5/6 授权，修订记录落 docs/v0.8.0-design.md）；新会话零转述实测走通——headless 全新进程凭定义自主完成 switch→认领→开工→verdict→passed（临时图 sp-executor-trial 取证）。
- **S04 hooks 适配层（adr_0009 accepted；可选资产，默认关闭）**：`integrations/src/hooks/` 两件——git-guardrails（PreToolUse 拦危险 git 命令，12 规则+放行例外清单，`SP_GIT_GUARDRAILS_OFF`/`SP_GIT_GUARD_EXTRA` 可调）+ session-brief（SessionStart 注入一行 oneline 图状态，CLI 五级解析、异常静默）；结构性默认关：gen 三表零投影+无注册面引用，不启用＝不在任何 harness 视野；核心层零 hook 事件总线（`src/` 零改动）；README 取舍节在位（「用户选择的额外护栏，不是 SP 的新机制」）。
- **S11 纪律族起步（adr_0005/DEC-6）**：plumber-tdd（预约定 seam + 三大反模式）与 plumber-review（双轴并行、结论不合并）model-invoked 注册（plugin.json skills 4→6，command:null）；两件均写明「服务图中节点」防蔓延定位与条件式指针惯例；实战取证：review 双轴法对 v094-oneline 产物真实交叉复核在案。
- **C7b 散文锚点断言**：sync --check 增两条轻断言——manual 版本锚点==package.json version；README 状态行 CLI 命令数/MCP 工具数/测试计数==实测值（CLI/MCP 数 dist 注册、测试数 vitest 动态取，vitest 不可用明示跳过）；锚点行固化为可 grep 模板；可红实测三次 exit 1。prepublishOnly 全链（test→build→web-ui build→export --docs --check→gen --check）跑通。
- **S06+S08 治理面**：PR 模板双通道三行清单（MCP 工具/CLI 命令/脚本封装，缺一写明理由）+ 纪律行「语义（校验/编排/提示文案）core 单源，渠道只做渲染差异」（2026-09-02 架构评审 C3，不立 ADR 以清单承载）；adr_0008/adr_0009 经 super-mario 裁决 accepted（IL-020 签署代录）；DEC-4 修订记录在案。
- 测试：后端 95 文件 **822 用例**全绿（0.9.3 为 91 文件 795：+7 错误码 +5 coerce +6 oneline +9 sp.mjs 回归）+ web-ui **109 用例**；`graph validate` 0 error；gen --check 通过（含版本面+散文锚点）；export --docs --check 通过。v094-verify 由 super-mario 六断言逐项取证（改正本→双视图同步且手改产物被拦 exit 1／sp.mjs≡CLI 抽样对照／主文档行数／hooks 零行为变化／executor 实测复核／纪律族复核）+ 三层验收（状态/结构/成果）全过。
- 发布动作：npm 0.9.4（latest）+ GitHub tag v0.9.4。

## [0.9.3] — 2026-09-03（minor：纸面边清偿——fallback 最小读语义）

> 主题：F09 拍板落地——fallback/iterates 不再是「validate 自己都警告」的纸面边：fallback 按 DEC-3（adr_0003）判据获得最小运行时读语义（死节点时刻的替代路线亮灯），iterates 同场裁决维持文档性标注；降级出枚举案否决（adr_0017）。

- **F09 fallback 最小读语义（adr_0017，双通道）**：`graph next` / `graph_get_next_actions` 对**死节点**（failed 且 max_attempts>0 且 attempts≥max_attempts——口径对照 state-machine 重试拦截，缺省按 3 兜底、0=不限永不判死）在 ready_eligible/blocked 两桶条目就地标注 `attempts_exhausted: true` 与 `fallback_routes`（沿出向 fallback 边收集 {id,label}，仅非空时出现，幽灵目标跳过）；CLI 人读面渲染 `⚠️ 重试预算耗尽 | fallback 路线: <id>(<label>)`（⚠️ 前缀对齐 adr_flags/review_flag 渲染习惯）。**零新增拒绝规则**——纯读面增强，不进 GATE_EDGE_TYPES/TOPOLOGICAL_EDGE_TYPES，死节点仍留原桶；编排 agent 不再需要全图扫边自找退路。
- **iterates 同场裁决（防半吊子清偿）**：维持文档性标注——其名义语义（重试/迭代）已被内建 attempts 重试链覆盖，无独立最小语义可做；validate 的 per-edge「无运行时语义」警告收窄为 iterates 单型（新文案「迭代语义由内建 attempts 重试链承担」），fallback 不再触发任何此类警告；shares_context 独立汇总提示不变。
- **拍板过程在案**：降级出枚举案否决——schema EDGE_TYPES 直接派生自 EdgeType 枚举（降级=存量图 fallback 边全变 schema 错误，破坏性变更）+ 拆掉 v0.8.0 设计明文引用的「先留标注、后升语义」升级通道先例 + 设计者表达意图的信息损失真实。**adr_0017 accepted**（super-mario 依 v093-verify 实测证据裁决，提议/裁决分离，IL-020 签署代录）。
- 测试：后端 91 文件 **795 用例**全绿（0.9.2 为 91 文件 787：+7 调度死节点场景 +2 validate 口径 +1 CLI 渲染）+ web-ui **109 用例**；`graph validate` 0 error；sync --check 通过（含版本面一致）；export --docs --check 通过。
- 治理：issue-log 前馈回路入册 IL-037（Windows EBUSY 文件锁抖动——环境性 flaky 首例，与 perf 墙钟不同源）/ IL-038（主控派单措辞两连击被实测纠正——attempts 语义口径与大写 ID 规则，「派单即契约」）；v093-verify 由 super-mario 独立临时图实测（8 节点 5 边逐断言：双桶标注齐备/条件缺省成立/0=不限永不判死/警告收窄，IL-020 签署代录模式）。
- 发布动作：npm 0.9.3（latest）+ GitHub tag v0.9.3。

## [0.9.2] — 2026-09-03（minor：渐进审批——分层凭据 + 审批成家/改图组合器两路架构收口）

> 主题：adr_0001 凭据哲学的粒度扩展——program 类大图可审一层批一层（approve --level）；C4b/C5 两路架构债清偿（审批凭据成家 review.ts + parser 减负解环、改图「begin→写→complete」三步舞组合器化、skipAmendGuard 通道退役）。

- **F08 approve --level 分批准入（双通道）**：CLI `approve` 增 `--level <层标>`、MCP `graph_approve` 增 `level` 参数——带 level = 整图凭据照写（status/by/at 语义逐字不变）+ `review.layers` 追加一条（同层原位覆盖、首次批准顺序保持）；design_approved 事件 detail 追加 `level=…`（不带 level 时逐字不变，既有消费方零破坏）；整图 approve / resetGraphReview 覆盖时 layers 一并作废（层批历史仍可查 events.jsonl）；**零新增拒绝规则**——level 接受任意非空串，quick/standard/无 class 图照记（档位路由是 skill 口径，工具不强制）；旧图无 layers 零迁移，review schema 严格形状校验（存在则验）。话术一行对齐：plumber-design SKILL Step 5（.pi 正本 + 插件副本，并顺带补齐 0.9.1 漏传导的档位凭据纪律段与 WF10 旅程告知行——见 IL-028）。
- **C4b 审批凭据成家 + parser 减负解环**：新建 `src/core/review.ts`（approveGraph/resetGraphReview/ApproveGraphParams 单家，0.9.2 approve --level 直接落新家）；文件 I/O 原语层下沉新建 `src/core/graph-io.ts`（图/实体读写、锁包装、路径、引用列表同步）；parser.ts 瘦身为用例编排层（原生 4 名，其余 21 名兼容 re-export，CLI/MCP/web 调用面零改动）；循环 import 6→3（madge 同口径：parser↔amend 直环、parser↔fog、parser↔index-service 等四环消灭，parser 完全出环；残余为 lock 既有结构与原环平移）。
- **C5 改图守卫组合器**：`withGraphAmend(rootDir, info, fn)` 收拢 begin→写→complete 三步舞——fn 抛错不留凭据、finally 必清作用域、嵌套免守卫内建（原 skipAmendGuard 语义收拢为免旁路开关）、锁序保持；7 处布线站点迁移（createNode/createAdr/createEdge/deleteNode/deleteEdge/graduateFog/mcp batch_create 整批守卫一次）；mutation API 的 skipAmendGuard 透传字段全库退役（grep 零命中）；守卫语义零变化（拒绝路径不留快照、batch/cascade 整批一份快照一条事件）；lock.ts 按拍板选型 (a) 未动（*Core/*Locked 命名保留，重入/所有权令牌留 1.0 后）。
- 测试：后端 91 文件 **787 用例**全绿（0.9.1 为 90 文件 764：+4 review 新家回归 +19 分层 approve 双通道）+ web-ui **109 用例**；`graph validate` 0 error；sync --check 通过（含版本面一致）；export --docs --check 通过；并发套件（lock/concurrency×2/lock-window）16 用例单独复核绿。
- 治理：issue-log 前馈回路入册 IL-028～IL-036（含 **IL-028 sync 不管理 SKILL.md 副本传导**——0.9.1 两段漏传实锤并本批修复，机制缺口挂 v094-restructure 设计输入）；v092-verify 由 super-mario 独立实测（临时 program 图逐层 approve 全断言 + quick/无 class 零拒绝复核，IL-020 签署代录模式）。
- 发布动作：npm 0.9.2（latest）+ GitHub tag v0.9.2。

## [0.9.1] — 2026-09-02（minor：人机分工进调度——档位凭据 + 等真人可见 + 架构单源化）

> 主题：人机分工从话术约定长出机器面——requires_human/等真人标记进调度五桶、human stale 按人类节奏放宽；class 从纯标注升级为带血统凭据（adr_0016）；C2/C3/C4/C7 四路架构债清偿（调度/validate/提示包/雾区与导出单源化）。

- **F22 /plumber-class 档位凭据命令（adr_0016，IL-024 销账）**：单命令 quick|standard|program，命令文本指示 agent 执行 `graph update-graph --class <档> --by user` 并回显生效；pi 侧对话约定话术落 plumber-design SKILL（用户说设为某档=同款凭据效力）。**class_changed 审计事件**：updateGraph 检测实际变更时落 from/to/by（同值不落、首次设置 from 缺省），provenance 由事件推导、零新 schema 字段；`--by` 双通道（缺省 agent）。**雾/档矛盾 nudge（零门禁）**：图有未毕业雾区且 class 非 program 且最近一次 class 变更无用户凭据 → validate/next 注入提示（fog.ts fogClassNudge 单源，CLI 人读/JSON 与 MCP 全读面），`--by user` 直发后静默——只纠 agent 误判、不骚扰用户明知的选择。话术纪律双副本：升降档须用户批准、降档向（→quick）从严、毕业附带 to-standard 交棒沿用毕业时增量人审不重复请示；commands 正本 3→4（sync 自动传导）。
- **F06 requires_human 派生标注**：含未完成 verifier:human checkpoint 的节点在双通道读面可见（domain.ts requiresHuman 纯函数，零 schema 字段；CLI get-node/MCP get_node 条目条件缺省；C3a 预留槽位接通真值进 claim 提示包）。
- **F07 等真人标记 + human stale 阈值**：next 桶对未认领的 requires_human 节点打 `waiting_human`（等真人）；stale 判定按人类节奏放宽——缺省基线 30 分钟 ×8=4 小时（HUMAN_STALE_MULTIPLIER 常量单源、倍数可配），显式 `--stale-ms` 对全部节点生效且不放大（next.ts 去硬编码缺省，防永久压制放大）；调度入口增可注入时钟（stale 测试不再伪造 YAML 时间戳）。
- **IL-025 雾可毕业 nudge（零门禁）**：fog.ignited 列票全部 passed 且雾未毕业 → validate/next 注入 graduate-fog 毕业建议（fogGraduationNudge，fog.ts 单源）；毕业时机不再靠人记得。
- **WF10 journey prompts**：plumber-design（图定稿出场：serve 复查/approve 凭据/可另开会话 /plumber-join 入场）与 plumber-execute（节点 passed 后前沿五桶概述+并行 join 建议；整图收口三层验收告知）增阶段末尾告知义务——与 join 冷启动互补（DEC-5：入场 vs 阶段出场）。
- **WF11 人机介入正交决策表**：manual 新增 §2.12——serve 预览/gate 节点/decision 节点/checkpoint verifier:human 四口一层一职（图级看板/流程硬放行/显式决策位/检查点级人核），互不顶替。
- **IL-026 grilling 雾区豁免**：sp-grilling SKILL 增条款——雾点只拷「毕业条件是否可验证/可观测」，不按 standard 粒度三问拷问（adr_0007：认知未到处不假装精确）。
- **架构单源化四路（2026-09-02 架构评审落地）**：
  - **C3a 认领提示包 core 单源**：buildClaimNudgePackage 单源组装（governing_adrs/adr_flags/review_flag + requires_human 槽位），MCP claim 响应形状不变，CLI update-status 补齐 review_flag 且 ⚠️ 措辞与调度面同源（手写变体消灭，get-node 残留变体一并收敛）。
  - **C3b validate 下沉 core**：validateGraphDir 七步编排单源（返回 {ok, errors, warnings, node_count, edge_count}），CLI/MCP 只留薄渲染（渠道侧删约 390 行双写编排），两处漂移警告文案归一单源（渠道只加前缀不改写）。
  - **C4a 雾区成家 + class 枚举单源**：graduateFog 自 parser.ts 迁入 fog.ts（雾区读/警告/毕业写单文件可读，语义零变更）；GRAPH_CLASSES 自 schema.ts 单源导出（satisfies + 编译期反向钳），init/update-graph/graph-dir/mcp 字面量清零。
  - **C2 调度分家**：新建 src/core/scheduler.ts（五桶 computeNextActions + 旗标装配 + 认领提示包），index-service 只留索引缓存基础设施（525→241 行）；graph-dir 路径解析进程内 memo（10k 节点热路径去重复目录 I/O）；cli/status 改消费调度 summary 删手抄直方图；graph-summary 下沉 core、mcp 对 cli 层引用清零（层次倒挂消除）；f14-dedupe 金测退役（单源后冗余）。
  - **C7a ADR 导出合树 + 导出门禁 + 锚点即修**：docs/<图名>/adr/ 布局双树合一（default 图视图归位 docs/default/，旧 docs/adr/ 树退役）；新增 `graph export --docs --check`（临时目录重导出比对，漂移退出非零指名文件）挂入 prepublishOnly 发版链；manual 版本锚点与 README 计数即修。
- **IL-017 脚本通道 traverse 语义对齐**：sp-traverse.mjs 与 MCP graph_traverse 语义对齐（truncated_by_depth/truncated_by_nodes 如实上报、max_depth 缺省 3 上限 50、max_nodes 200），9 用例锚定双通道一致；共享核心抽取留 S03（0.9.4）七脚本收敛一并落地。
- 测试：后端 90 文件 **764 用例**全绿（0.9.0 为 78 文件 693）+ web-ui **109 用例**；`graph validate` 0 error；sync --check 通过（含版本面一致）；export --docs --check 通过。
- 治理：**adr_0016 accepted**（档位凭据命令，2026-09-02 用户拍板）；IL-017/IL-024/IL-025/IL-026 销账（issue-log 前馈回路）。
- 发布动作：npm 0.9.1（latest）+ GitHub tag v0.9.1。

## [0.9.0] — 2026-09-01（minor：雾中绘图——wayfinder 化核心）

> 主题：「图一次画完」不再强迫认知未到处假装精确——**雾区进 schema**（adr_0007），还没想清楚的领域可登记、可观测、可毕业；program 档 chart the graph / work the graph 两模式附着其上。

- **F04 雾区图级字段（双通道）**：`graph.yaml` 可选 `fog: { id, description, graduation, ignited? }`——图级轻字段**单一真相源，不做节点载体**（v0.8.2 试跑五卡点实证收口：`_fog` 过不了 ID 规则、双载体必漂移）；**点火不建边**（fog→票 depends_on 死锁 ready 门禁），research 票挂接走 `ignited` 字段；编辑走 `graph update-graph --set-fog '<json>'` 与 MCP `graph_update_graph`（fog 参数整体 upsert，写前校验拒畸形）；`--class quick|standard|program` 工作类标注（F03/F13，用户 2026-09-01 预批随雾区机制进 schema，`graph init --class` 预设）；读面透出：CLI `status`/`next --json`、MCP `graph_get_next_actions`/`graph_get_graph`、serve `/api/graph`（web-ui 云团数据源）。
- **F05 fog_graduated 毕业凭据（双通道）**：新命令 `graph graduate-fog --produced <id,id> --reason <text>` 与 MCP `graph_graduate_fog`——清除 fog 字段 + **fog_graduated 专用审计事件**（payload 带毕业产物与结论，与 node_deleted 明确区分）；毕业动作属结构修订，**复用 DEC-7 amend 守卫**（自动快照 + graph_amended + review 回置 unreviewed，增量人审提示零门禁）；无雾报错——毕业是事实陈述不是清理操作。实现注记：graduateFog 修掉一处锁序隐患（图锁不可重入，守卫收尾在锁外执行）。
- **F17 validate 雾区提示（只提示不阻止）**：图中有未毕业雾区 → 一条 warning（含雾 id 与毕业条件），执行期照常推进、零新拒绝规则；`core/fog.ts` fogWarnings 单源，CLI `graph validate` 与 MCP `graph_validate` 同文案；零工作流节点不重复提示。
- **WF09 chart/work 两模式进 skill**：plumber-design SKILL 增「chart the graph 模式」（绘图会话只画图不解题：雾区登记、research 型点火、一次会话一张票）；plumber-execute SKILL 增「work the graph 模式」（取前沿→解一张→毕业雾→决议回写 ADR/术语→to-standard 交棒）；毕业话术引用 DEC-7 改图协议不复制；双副本 diff 仅寻址行差异。
- **web-ui 雾区呈现**：星空视图把 fog 渲染为虚线云团（低饱和雾芯 + id/描述/毕业条件 tooltip，置于星座下方不遮星体）；数据一律来自既有读接口（`/api/graph` 顶层 fog 字段），毕业后数据刷新云团即消失（零 DOM 残留）；prefers-reduced-motion 关停呼吸动画。
- 测试：后端 75 文件 **676 用例**全绿（0.8.2 为 656；+20 雾区用例含零迁移/零默认拒绝/锁序回归断言）+ web-ui **109 用例**全绿（+3 雾云团）、svelte-check 0 错；`graph validate` 0 error；`sync-integrations.mjs --check` 通过（含版本面一致）。
- 计数面：CLI 28→**29** 命令、MCP 25→**26** 工具（manual §1/§2.2/§6.1/§6.2 + README 同步）；`tools-coverage` TC-01 断言 26。
- 治理：**adr_0007 accepted**（雾区进 schema：轻字段 + 只提示不阻止——0.9.0 设计基准，2026-09-01 交叉验证随裁决转正）；docs/adr 视图与 DECISIONS.md 已刷新。
- 发布动作：npm 0.9.0（latest）+ GitHub tag v0.9.0。

## [0.8.2] — 2026-09-01（minor：plumber-join 冷启动第三口 + 改图协议落地 + 待拍板三项收口）

> 主题：任意新会话变自给自足工人（S10/WF15）；执行中改图从「能改但无声」到三级分流 + 三条轻机器约束（DEC-7/adr_0006）；设计文档三项待拍板全部收口。

- **plumber-join skill（DEC-5/DEC-6，S10/WF15）**：新增独立冷启动加入协议 skill——零前文新会话仅凭 skill 名与图名自主完成 list/switch → status → next（前沿五桶按 priority 挑）→ claim_by（governing_adrs 必读、adr_flags ⚠️ 即停）→ 干活（单节点工作协议**指** plumber-execute 不复制）→ checkpoint/report → verdict → passed → 回队列直到无前沿；多会话并行是预期场景（原子认领互斥、stale 是心跳走 reclaim、绝不 cancel）。`/plumber-join [图名]` 命令正本 + 插件拷贝（sync 自动传导零漂移）+ plugin.json 注册（工作流入口 skills 2→3，物理条目 3→4 含 grilling；commands 2→3）。零前文实测通过：全新会话无任何协议转述完成全循环（事件链+实物双证）；并行互斥实测通过：两会话抢同一节点，败者按协议换节点不重试。
- **WF16 execute 上报出口**：plumber-execute SKILL（双副本）新增「发现图错的上报出口（改图三级分流）」节——小修（plan/DoD 文案、checkpoint 增删）执行会话内直接改 + 报告注明「计划已修订」；结构修订（增删节点/边、雾区毕业、拆分、取消子树、ADR supersede 连锁）不自己动手，路由回 designer amend 模式；failed 裁决触发同样路由。话术守 DEC-4 no-op：只写何时上报、报给谁，不复述机器行为细节。
- **F21 改图三约束（DEC-7 配套，双通道）**：(a) 结构修订落图前自动 snapshot——拦截在 core 公共写入口一层（增删节点/边、batch 整批一次），message 形如 `auto: structural amend (add-node n1) by cli`，拒绝路径不留快照、安全网快照跳过 docs 导出；(b) `graph_amended` 审计事件 + 已审核图 review 回置 `unreviewed`（by=触发修订的通道/actor，review_flag nudge 重新亮起走增量人审）；(c) 改 passed/blocked 节点 plan 的响应 nudge（CLI 提示行 / MCP 响应 `plan_amend_nudge` 字段，纯提示不改状态）。三约束全为 nudge/凭据类，零硬门禁（DEC-1 哲学）；CLI/MCP/脚本三通道天然一致。
- **三项待拍板收口（设计文档 §4）**：① **class 字段纯约定先行、不进 schema**（按 §4-1 既有倾向落地：零工具改动，档位约定留 plumber-design Phase 0 路由表；字段随首个需要它的机制——0.9.0 雾区/0.9.2 渐进审批——一起进，反转路径已成文）；② **review_flag 文案定稿**：「设计审核凭据缺失或已失效——仅提示，可照常认领」（句式对齐 adr_flags「状态——含义，建议动作」，覆盖无凭据与结构修订回置两种触发；断言改锚 `REVIEW_FLAG_UNREVIEWED` 常量）；③ **雾区约定版试跑完成**（docs/fog-recon-trial-report.md）：真实模糊需求「发布链自动化」走完登记→点火→一票→毕业全程，5 卡点实证（fog→票 depends_on 边死锁 research 票 ready 门禁、`_fog` 命名过不了 ID 规则、毕业无专用凭据、双载体漂移、知识顶点计数三口径）直接输入 0.9.0 F04/F05/F17 schema 设计。
- **adr_0006 转正（S08）**：改图协议（三级分流 + 三约束）经 WF16/F21 实践检验后 accepted（裁决位 super-mario 独立取证：adr 内容三判据 + 两实现节点交付实况 + 全量测试绿）；`docs/adr/roadmap-to-1-0-0/` 隔离导出刷新（A1 口径，默认 docs/adr/ 零触碰）。
- **治理账（docs/issue-log.md 前馈回路）**：IL-022（共享 MCP server 会话内 `graph init/switch` 全局副作用事故——并行执行期 active 图被翻转，零脏写恢复；防复发纪律成文）、IL-023（sp-\*.mjs 无 `--graph`/`SUPER_PLUMBER_GRAPH` 寻址，绑 0.9.4 S03 收敛）记录即可；v082-verify 观察项：审计日志不记并发认领失败事件（backlog 候选）。
- 回归：后端 72 文件 **656 用例绿**（0.8.1 为 634，F21 新增 22 条）+ 交叉验证独立复核（verify-t1 双会话互斥实测、双进程机械复现认领互斥、F21 三约束隔离图正反向实证：快照/事件/回置/nudge 四断言 + review_flag 亮灭双向）。
- 发布动作：npm 0.8.2（**latest**）+ GitHub tag v0.8.2；beta tag 保留指向 0.8.2-beta.1（npm dist-tag 不可删，latest 由本版接管）。

## [0.8.2-beta.1] — 2026-08-31（beta：super-mario 工具供给实验 + 签署代录成文）

> 实验性测试版：检验「super-mario 零工具系 tools 显式声明所致」假设（IL-021），随版带 IL-020 签署代录模式。**验证结论出来前请勿依赖本版——latest 仍为 0.8.1。**

- **super-mario 工具供给实验（IL-021）**：`integrations/plugin/agents/super-mario.md` 移除 frontmatter `tools:` 显式声明。ZCode 渠道 spawn 零工具（manual §9 已知问题）的 C2 结论「平台侧不可修」存在误诊候选：sp-designer（无 tools 字段）spawn 工具齐全 vs super-mario（显式声明）零工具，且声明中的 find/ls 并非本 harness 工具名——显式列表按名解析失败疑似**整表丢弃**。去除后继承默认全量（含 super-plumber MCP `graph_*` 工具，恰为 mario 自行落盘 checkpoint/report/passed 所需）；pi 正本保留原声明待 pi 侧验证。**若实测通过，mario 将可在 ZCode 渠道自行完成裁决落盘全链路（签署代录模式退役为兜底）**。
  - **✅ 同日实测确认**：用户更新插件重启后五步全过（Read/Bash + MCP graph_* 读、幂等写、调度读全通，零状态流转副作用）——假设成立，C2 误诊已修正进 manual §9；签署代录降为兜底。
- **IL-020 签署代录模式成文**：mario 裁定文本即落盘凭据——逐 checkpoint 签署 + verdict + 显式落盘授权三件套，主控凭签署代录、无签署的簿记无效；super-mario 定义双副本 + manual §9 缓解模式段。
- **web-ui**：passed 节点绿加深 `#34c964`→`#16a34a`。
- 发布动作：npm `0.8.2-beta.1`（**beta tag，latest 仍为 0.8.1**）+ GitHub tag `v0.8.2-beta.1`；插件渠道 marketplace/plugin manifest 版本同步 0.8.2-beta.1 供更新实测。

## [0.8.1] — 2026-08-31（patch：决策凭据周边——删除拒绝理由、决议索引、星空前沿视图）

> 主题：决策的「为什么不」进入可追溯面——删除带理由（F14），决议一屏可读（F15），调度面「现在就能干的活」一键直达（前沿视图）。

- **F14 删除拒绝理由（双通道）**：`graph delete-node --reason` 与 MCP `graph_delete_node` 的 `reason` 参数——理由进 `.deleted.yaml` 归档（deleted_reason/deleted_at/deleted_by 三键）与 `node_deleted` 审计事件；**理由是凭据非拒绝条件**（DEC-3：缺省行为零变化，不设硬门禁）；plumber-design SKILL（双副本）出图前新增「查历史拒绝理由」步骤（读软删归档与事件，避免重蹈已否决方案）。
- **F15 DECISIONS.md 决议索引**：`graph export --docs` 增发决议一行索引——passed 的 task 节点 + accepted/superseded 的 ADR 各一行（决议/id/标题/结论时间），pending 不入；单图落工作区根、多图落 `docs/<图名>/`（与 CONTEXT-MAP.md 同目录约定）。
- **mermaid 分期带导出（IL-004）**：`graph export --mermaid` 默认按 level 分期带生成 subgraph 分组（知识顶点横切不入带、带内稳定排序 Git diff 友好），`--levels <1,2>` 分段裁剪、`--band-name <level>=<名>` 显式命名（图 schema 无 level→域名映射，缺省 `L<n>` 防误标）；DOT 侧仍平铺（形状/配色/边样式映射一致，分组仅 mermaid）。
- **traverse 深链修复（IL-003）**：深度截断与 max_nodes 截断分别如实上报（新增 `truncated_by_depth`/`truncated_by_nodes`，truncated=任一发生，不再虚报 false）；max_depth schema 上限 20→50（默认 3 不变），深链 33+ 跳一次调用可达末端；MCP 工具 description 与 manual §6.2 双落点标注深链使用姿势。
- **web-ui 前沿视图 + 分期图例 + Avoid 呈现**：顶栏「✦ 前沿 N」一键过滤（ready 与门禁已满足的 pending 合并档，与调度器五桶对账一致，零新增读接口）；领域/叠加视图「开发分期」玻璃图例（debug·0.7.0 / 0.8.x / 0.9.x / 1.0.0 四段，数据源为节点 id 前缀或标签段位，点击看成员与分期索引域）；术语 definition 尾部 `Avoid:` 尾注识别与琥珀分区高亮（WF06 约定先行，schema 字段后置）。
- **工作流面成文（WF05/06/07）**：manual §2.4 术语 Avoid 约定（切分口径与 web-ui 解析逐字对齐）、§2.11 节点类型×默认纪律映射表 + plan 纪律指针惯例（DEC-6：只指 SP 自带技能、存在才建议、缺失静默降级）。
- **发版门禁（IL-016）**：`sync-integrations.mjs --check` 增版本面一致性断言（package.json 与 `.claude-plugin/marketplace.json`、`integrations/plugin/.claude-plugin/plugin.json` 三方一致，0.9.5 起前向兼容 `.codex-plugin/plugin.json` 与 `.agents/plugins/marketplace.json` 共五方；不一致 exit(1) 逐条列差异）——作为 prepublishOnly 第一段自动生效；README 新增「发版清单」小节（版本面同步为第 1 步）。
- **治理账（docs/issue-log.md 前馈回路）**：IL-003/IL-004/IL-016 销账（节点 passed，2026-08-31）；IL-017（sp-traverse.mjs 脚本层 DFS 语义漂移，il-003 执行者上报）立节点 `il-017-sp-traverse-drift` 绑 0.9.4 S03 七脚本收敛一并清偿；IL-018（DOT 平铺不对称）/IL-019（web-ui 纯知识顶点图透镜提示与空 context 星云两处边角，v081-verify 观察项）记录即可；附带数据清洗：ctx-webui「Avoid 呈现」定义正文中置 `Avoid:` 字样改写（快照保底）。
- **0.9.5 立项随版入库**：adr_0015（Codex 渠道采用官方 .codex-plugin 插件路线，accepted）+ ctx-phase-09x 收录 0.9.5 四节点（v095-manifest/docs/verify/release，25→29 成员）。
- 回归：后端 69 文件 634 用例绿（0.8.0 为 605）+ web-ui 106 用例绿（0.8.0 为 68）、`graph validate` 0 error、`sync-integrations.mjs --check` 通过（含 IL-016 版本面断言）。
- 发布动作：npm 0.8.1（latest）+ GitHub tag v0.8.1。

## [0.8.0] — 2026-08-31（minor：借力 skills 系统的工程判断——分级路由 + 审批凭据 + 写作规范）

> 主题：把"每张图都走全套重流程"的对称性打破——quick/standard/program 三档分级路由让小任务轻装自举，
> 审批从口头"批准了"变成可追溯凭据，plan/DoD 文案有了 lint 与写作规范，serve 人审话术并入 sp-grilling 纪律技能。

- **设计审批凭据（DEC-1/adr_0001，F01/F12/F02）**：新增 `graph approve` CLI 与 `graph_approve` MCP 双通道——图级 `review` 字段（status: approved=人工 / self=quick 自签，by，at）+ `design_approved` 事件 + 索引失效，幂等覆盖；**零门禁红线**（核心状态机零新拒绝，未审核图全链路行为不变）。未审核图在 `graph next` 的 ready_eligible 条目与 MCP claim 响应注入 `review_flag: 'unreviewed'` 提示（≤10 token，机制同 adr_flags），approve 后消失；ready 桶不注入。CLI 27→28 命令、MCP 24→25 工具。
- **三级工作类路由 Phase 0（DEC-2/adr_0002）**：plumber-design SKILL 流程之首两问定档（有雾吗？一个会话装得下吗？）——quick：单节点图、entry/exit 各一句话、跳过 serve 人审与 doctor 质检、只跑 `graph validate`、init 后立即 `approve --status self` 自签、执行协议减为 claim→report→passed（checkpoint 可选）；standard：现状全流程；program：登记方向，雾区渐进 0.9.0 落地。自举实测：quick 档 9 步 vs standard 档 22 步（41%），成本匹配目标。
- **sp-grilling 纪律技能（adr_0014/adr_0005，skills 2→3）**：MP grilling 本体协议忠实移植（一次一问、每问附推荐答案、事实自查环境/决策归人、共识达成前不动手）+ SP 落点附录四路落图（定档→Phase 0 路由表；设计决策→graph adr create；改决定→DEC-7 分流；审批→approve 凭据话术）+ 强度分档（quick 轻量/standard·program 全量深挖）。serve 人审话术改为对「已画好的图」跑 grilling 质检（覆盖原 quiz 三问的三类结构决策：粒度/阻塞边真门槛/合并或再拆），用户批准后 designer 调一次 approve 落凭据。model-invoked、无命令。
- **plan/DoD 写作规范与上下文卫生（WF03/WF04）**：manual §2.8 写作规范四原则一正一反（耐久＞精确/行为式/可独立验证/显式范围，反例即 lint 三类规则码）；§4.4 上下文卫生四要点（一节点一会话为默认/checkpoint=阶段边界/compact 失败模式/stale 是心跳不是事故）；plumber-execute SKILL 双副本同步增「上下文卫生」节。
- **F16 文案 lint（DEC-3，warning 级三通道同源）**：`src/core/style-lint.ts` 纯函数规则组——a 脆弱定位（路径+行号/函数名共现，板块级文件落点不报）/ b 行号式 / c 不可验证措辞（词表+裸词干守卫 `(?<![不非])词干(?![性化界地])`，IL-014 验收发现漏报后二轮补洞）；CLI validate / MCP graph_validate / sp-check-design W8 三通道同源透传，warning 不影响退出码。
- **ADR 与术语**：六张 ADR 转正——adr_0001（审批凭据非硬门禁）、adr_0002（三级路由）、adr_0003（纪律分层判据）、adr_0004（自主入场）、adr_0005（skills 入口策略+纪律族）随版 accepted，加 adr_0012（过程问题前馈回路，设计期已转正）；CONTEXT.md 增三术语（工作类/审批凭据/提示旗标）。
- **治理账（docs/issue-log.md 前馈回路）**：IL-001 置层准则成文（SKILL 置层准则节 + manual §2.9，33 层事故实证入文；doctor W9 层数>8 评估结论在案留 0.8.x）；IL-002 批量操作守则（manual §2.10：glob 排除 *.deleted*/先快照/批量后 validate+抽查）；IL-014 c 类词表二轮修复；IL-015 外部驱动 roots 回退教训入账。manual §6.1/§6.2/§1 计数同步（28 命令/25 工具）。
- **插件清单**：`.claude-plugin/plugin.json` version 自 0.6.3 对齐至 0.8.0（历史停滞导致市场插件未跟上 0.7.x，随版修正），skills 注册面 2→3（sp-grilling，command=null）。
- 回归：后端 65 文件 605 用例绿（0.7.1 为 560）+ web-ui 68 用例不回归、`graph validate` 0 error（本图另有 7 条自指性 lint warning 属预期信号）、`sync-integrations.mjs` 一致性门禁通过。
- 发布动作：npm 0.8.0（latest）+ GitHub tag v0.8.0。

## [0.7.1] — 2026-08-30（patch：多图知识视图按图名分离 + 0.7.0 遗留修复批清账 + 边类型与契约工效）

- **多图工作区知识视图按图名分离（adr_0013，根治 A1 跨图视图挤占）**：多图工作区中 `graph export --docs` 与 snapshot 自动导出默认落 `docs/<图名>/{adr,contexts,CONTEXT-MAP.md}`，各图视图互不挤占、不再产生 `.retired/` 误归档与 CONTEXT-MAP 翻烧饼；单图工作区路径完全不变（向后兼容）；显式 `--adr-dir/--ctx-dir` 透传仍优先。多图工作区升级后视图落点有变化，旧共享目录成为冻结历史视图。
- **0.7.0 遗留修复批清账**（docs/v0.8.0-issue-log.md）：
  - B1 双副本防漂移短期门禁：新增 `.github/PULL_REQUEST_TEMPLATE.md`——skill/agent 提示词改动须列双路径逐一 diff 核对（允许且仅允许渠道寻址行差异）；
  - B2 manual §2.3 契约边示例修订为实测形状（`consumed_by` 须为 `[{artifact, used_as}]` 对象数组、`validation` 须为对象），旧形状会被写前校验整批拒绝；
  - C1 领域建模防略过三层：plumber-design 派单模板「派发前合规自查」三条清单 + doctor 新增 W7（工作流节点 ≥8 且 context=0 提示评估 bounded context）+ sp-designer「报告缺领域段 = 未完成」自检条款；
  - C2 super-mario 定义首步工具自检句（spawn 缺文件工具即如实挂起上报，不伪造结论）+ manual §9 已知平台问题注记与 general-purpose 只读代行缓解模式。
- **边类型工效（IL-011）**：MCP `graph_add_edge` / `graph_batch_create` 的 edge type 改为可省略、缺省 `depends_on`（对齐 CLI 既有默认，双通道一致）；manual §3「九边速查」改写为判据式（默认 depends_on、知识边仅 ADR/领域建模阶段、validates/fan_in/fan_out 向后兼容存量新设计不再使用、fallback/iterates 保留字禁用）；**depends_on 方向约定成文**（source=被依赖的前置、target=等待方）；sp-designer 角色提示词选型段同步收窄。
- **契约工效（IL-012）**：context 顶点支持 `contracts: [{to, contract}]` 默认契约声明，跨 context 工作流边自动继承、单边可覆写；validate 契约检查改为「该 context 对无声明且边无 contract 才警告」；双通道交付（CLI `update-node --contract-add` / MCP `contract_add`）；存量图零迁移。
- **web-ui**：节点详情面板 IL 条目 each_key_duplicate 渲染中断修复（NodeDetail.svelte）。
- **账本入库**：`docs/issue-log.md`（统一问题账本）与 `docs/v0.8.0-issue-log.md`（0.7.0 遗留修复批账本）随版入库；docs/contexts/ 四张领域上下文视图入库。
- 回归：全量测试 61 文件 560 用例绿、`graph validate` 0 error 0 warning、`sync-integrations.mjs` 一致性门禁通过。
- 发布动作：npm 0.7.1（latest）+ GitHub tag v0.7.1。

## [0.7.0] — 2026-08-28（minor：0.7.0-beta.1 转正 + 领域文档与设计系统同步补录）

- 版本决策：0.7.0-beta.1（tag=beta，2026-08-28 发布）为「深空仪器舱」重构预发布；beta 验证通过、无阻断缺陷，直接转正 0.7.0 发布为 latest。npm 不允许删除 dist-tag，beta 保留指向 0.7.0-beta.1（latest 已是 0.7.0）。
- 转正前补录（审计发现 → 已同步）：
  - **ADR 裁决补录**：multitool-refactor 图 adr_0002「插件包合二为一」此前停在 proposed——0.6.1 已按该决策发布实施；经裁决执行 `graph adr accept adr_0002`，`graph export --docs` 再生成 docs/adr（0001 superseded / 0002 accepted 落视图，图为真相源）。
  - **PRODUCT.md**：ADR 形态由「徽章/角座/文档」更正为现行「dock 决策文档目录 + 详情抽屉五节 + 接替链（画布不渲 ADR 形体）」，decides 边转「管辖决策」反向板块。
  - **DESIGN.md**：由 0.6.2 灰阶 chrome 基线更新为 v0.7.0 玻璃语言定档（token 正本 `web-ui/index.html`：`--glass` 0.72/0.88、blur 20/24px、wash 4/7/12%、圆角 6/10/14/18+pill、单档 `--shadow-float`、单排 48px 仪器条 + 浮动 glass dock + 右缘统一抽屉），画布语汇同步星体/星云/边态定档值；顶部附修订注记与取值来源。
  - **README.en.md**：特性表 Web UI 锚点补齐连字符（原断链跳转失效）。
- 回归：后端 534 例 + web-ui 68 例全绿、svelte-check 0 错误、生产构建通过、`scripts/sync-integrations.mjs --check` 手工手册一致性门禁通过。
- 发布动作：npm 0.7.0（latest，2026-08-28）+ GitHub tag v0.7.0 与 release。

## [0.7.0-beta.1] — 2026-08-28（web-ui「深空仪器舱」全面重构：玻璃 chrome + 图库/决策文档 + 交互六修）

> 星空画布主体不变，chrome（顶栏/工具轨/抽屉/浮层）整体替换为现代科技暗色的玻璃语言
> （对标 Linear / Vercel Geist 一系），并以浏览器黑盒测试驱动修掉六类交互缺陷。
> impeccable 工作流交付；先发 beta 验证，转正另行拍板。

### chrome 视觉全面重构（深空仪器舱）

- **玻璃语言 token 体系**：冷调近黑玻璃（`--glass` 0.72 / `--glass-strong` 0.88 + backdrop-blur 20px + 1px 白 8% 边 + 顶部内高光 + 单档 `--shadow-float`）、白色洗刷阶梯 4/7/12%（容器底/hover/active，替代不透明灰阶）、圆角阶梯 6/10/14/18 + pill；状态七色「色彩即状态」契约不变，画布星体/边/星云零改动。
- **单排 48px 仪器条**：双排顶栏压扁为一条（品牌文字 + 状态过滤分段组 + 层级 + 图标搜索框 + n/e 统计），任何宽度不叠两栏；拥挤时过滤组横向滚动；搜索框 `autocomplete=off`（防浏览器 reload 表单恢复把旧查询塞回、与 store 脱节导致全图变暗）。
- **浮动玻璃 dock**：原贴边工具轨改为左缘垂直居中的悬浮玻璃舱（图库/决策/透镜/对比 · 缩放×3/固定布局 · 专注），focus 模式整体滑出；移动端转底部居中横排。
- **品牌 logo 砖移除**（用户拍板）：左上角仅保留文字品牌与当前图标签。

### 图库与决策文档（两个新入口）

- **图库弹层**：选图从顶栏 tabs 迁入 dock 图库按钮（带图数徽标）——低频操作收进折叠栏，顶栏不再随图数量膨胀；弹层列出名称/标签/工作流口径节点数/工作区 active 实心点。
- **决策文档（ADR）入口恢复**（0.6.3 退役的 ADR 入口以新形态回归，不再上画布）：dock「决策文档」按钮 + 目录弹层（三态点色、superseded 划线标题 + `→ adr_XXXX` 接替链）；点击打开**决策文档详情抽屉**——决策/背景/备选方案/理由/后果与代价五节（Markdown 渲染）+ 管辖范围（decides 落点可跳转）+ 接替链跳转；节点与 context 详情页新增**「管辖决策」**反向板块（decides 打到本节点/所属簇的 ADR，划线+状态色点+可跳转）。

### 详情页组件化

- **DetailDrawer 共享舱体**：节点 / 上下文 / 决策文档 / 边 / 版本对比五种详情统一同一右缘玻璃抽屉壳（头部标题+Esc 提示+关闭钮、通用小节排版、meta/chips 语言单一真相源）；context 详情（边界/术语表/成员）与节点详情（计划/完成标准/检查点/执行报告）风格完全同步；成员/管辖跳转 chip 化可点击。
- **右缘抽屉互斥**：开对比即收详情、选中节点即退对比与目录弹层（同泊位单焦点）；**版本对比从左下 flyout 迁为右缘抽屉**——左下角永久属于簇色图例，画布底部提示条不再被盖（评审 F1/F2 的结构性解法）。

### 交互六修（浏览器黑盒测试驱动）

- **F1 图例遮挡**：版本对比面板盖住左下簇色图例——随对比面板右移根治；图例/提示条/对比徽章同步玻璃化。
- **F2 提示条遮挡**：窄宽度下操作提示条被对比面板压住——同上根治；<1000px 提示条直接让位（桌面 affordance）。
- **F3 专注退出钮被盖**：进入专注模式即收全部抽屉与弹层；退出钮 z 提到面板档，详情抽屉残留也不遮挡。
- **F4 星云拦截空白点击**：星云云体放行点击（大片画布恢复「空白点击=清除选中」），context 可点域收敛到云缘命中环/云心/标签。
- **F5 边难点中**：每条边补透明 12px 加宽命中线（1.5px 可见线不再考验鼠标精度）；云心命中域同步放大（r12）。
- **过滤空态点不动**：「没有匹配当前过滤条件的节点」面板被画布 SVG 层（z1）压住导致「清除过滤」不可点——空态提 z 至画布浮层档并玻璃化重做；清除过滤同时从层级 chips 组挪进状态过滤组（紧邻被清除对象）。

### 画布与语义修正

- **所见即所计**：chrome 计数全部改工作流口径——顶栏 n/e、状态 chips、图库计数只数工作流顶点，decides 边不计入 e；map 透镜领域图计数剔除不渲染任何形体的 adr 顶点。此前 22n·26e 里有 2 个 adr 顶点与 2 条 decides 边在画布上根本不存在。
- **context 假状态移除**：知识顶点不再显示/统计 pending 假状态（schema 缺省值泄漏进 UI——context 无工作流生命周期），详情页 chips 与「5 pending」计数同步纠正。
- **星云云心放大 + 动效**：r 2.6→4、同色环 5.2→7.5；hover/键盘聚焦云心微涨+环提亮（core-hot），选中套白色实心环（与节点选中白描边同语言，core-selected）；reduced-motion 全量降级。
- **Tab 分组循环**：Tab 在同类元素内循环——星体只在星体间、context 云心只在云心间、dock（含打开的弹层项）只在 dock 内，不再一路 Tab 到顶栏乃至浏览器 UI；云心补 tabindex/role/aria-label/Enter-Space 选中；Shift+Tab 逆序，组内环绕。

### 溯源

- impeccable 工作流：浏览器黑盒全量测试（F1-F5 缺陷清单）→ Linear/Geist 双参考调研 → 「深空仪器舱」方向 → 用户六轮实测反馈迭代（单栏化、图库迁移、logo 移除等）；web-ui 68 测试全绿 + svelte-check 0 错 + 生产构建通过；未立拓扑图（主线程直接交付）。

## [0.6.3] — 2026-08-28（星空修正与调优：边可见性根因修复、领域图单独视图、ADR 入口退役、银河带补齐）

- **边可见性三连修（本轮核心技术坑）**：① 各边渐变元素漏设 id——24 条边 `stroke="url(#eg-*)"` 引用悬空，SVG 初始 `stroke:none` 导致整条边不绘制（`.edge-debug` 像素采样实证，修复 = 补 id + tick 逐帧同步渐变端点坐标）；② fit 后 k≈0.6-0.9 时 1.5px 线被亚像素摊薄——线宽按 `1/√k` 补偿（k<1 放大、封顶 2.2×，屏幕宽恒定）；③ 静态服务缓存头修正（hash 资源 `immutable`、index `no-cache`，防发布后浏览器加载陈旧包）。感官强度随后按用户拍板两轮调低：0.85 → 0.7 → 0.35（当前 10-90% 平台 0.35、契约虚线 0.39、E3 能量 0.35/0.1）。
- **领域图单独勾选**（原为工作流+领域双开才见星云）：勾领域图即「星体 + 星云，无连线」——工作流星体保留、所有连线隐藏、星云/云心/淡虚线缘/簇色图例照常；`isEdgeVisibleInMaps` 增补 workflow 前置条件（纯函数与单测同步修订）。
- **星空微调**：光晕缩小（r = 0.88×芒长、中心浓度 0.5-0.55，减光污染而不失星芒温度）；星云补淡虚线云缘（色 0.35、4-4 点线——不同领域单靠颜色难以区分）。
- **ADR 文档入口全删**：画布徽章层 / 左下角决策文档抽屉 / 工具轨决策按钮及相关组件、状态、测试一并退役——图中不再设 ADR 入口；superseded 语义警示（详情面板 adr_flags 金标）保留；ADR 权威入口回归 CLI（`graph adr` 列表）与 `docs/adr/`。
- **银河带补齐**（与定稿 demo 对齐）：补带内星尘航线——沿带轴聚拢的 0.75 亮度微尘（±34 扩散），0.05 渐变黑底上不可见，星尘航线才是银河带的视觉主体；带角度 115deg → 162deg（与 demo rotate(-18°) 同向）、带宽收窄至 demo 同比例。
- 溯源：0.6.2 发布后在浏览器逐项实测的修正轮（web-ui 68 测试全绿 + svelte-check 0 错 + 构建通过），未立拓扑图；方向 demo（docs/design-system/star-atmosphere-demo.html）同步至同一参数。

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
