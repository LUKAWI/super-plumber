# 段落级归属清单（三归类）— multitool-refactor v0.6.1

> 本文是 `l1_design_final` 的交付物一。对 `.pi/skills/` 现有四个文件逐段贴标签，**换归属≠删除**：
> 【留】= 编排语义，留在收缩后的 skill；【归提示词】= 角色专业协议，迁入对应 agent 提示词；
> 【进手册】= 操作语法/机械知识，迁入 Operations 手册正本（`integrations/shared/manual.md`）；
> 【删】= 冗余或已过时（去向注明）。评审通过后，后续节点的改写一律可回溯到本文行号。

标签：S = plumber-design/SKILL.md；DR = plumber-design/reference.md；X = plumber-execute/SKILL.md；XR = plumber-execute/reference.md

---

## 一、plumber-design/SKILL.md（14 段）

| # | 段落 | 归属 | 去向与处置 |
|---|------|:----:|-----------|
| S1 | frontmatter description 触发词 | 留 | 收缩版 skill 保留并增补"多工具可用"触发词；claude/zcode 包组装时仅做格式适配 |
| S2 | Overview（产出物定位、审核硬 gate 宣言） | 留 | 编排定位宣言，压缩至 3-4 行 |
| S3 | When to Use / Do NOT use 清单 | 留 | 主线程入口判据，保留 |
| S4 | REQUIRED SUB-SKILL 两行（→execute / →super-mario agent） | 留·改写 | 改为「派单」语言：审过 → 按 §派单模板 派 executor；裁决 → 派 super-mario。subagent 与 skill 解耦后不再叫 sub-skill |
| S5 | Step1 理解需求（问用户不猜） | 留 | 编排行为：主线程对用户，agent 提示词里无此环节 |
| S6 | Step2 设计拓扑流程骨架（顺序铁律/分层步骤/边先后/batch≤200） | 拆 | 铁律与骨架句【归提示词】（designer 流程主线）；命令示例、MCP 名对照、batch 参数【进手册】§design-ops；skill 仅留一行 gate 断言"建图须过 designer 协议+体检" |
| S7 | 节点三要素表（plan/checkpoints/dod MUST） | 归提示词 | designer 已有对应段——以它为唯一正文；手册收录机器校验行为（E4）；skill 不再复述 |
| S8 | Step2.5 领域建模细则（context 识别信号/术语纪律/归属/契约边） | 归提示词 | designer 第二阶段已是唯一完整载体；skill 留编排级提醒一行："需求跨多个关注点 → designer 必做领域建模"；命令示例全部【进手册】 |
| S9 | Step2.6 ADR 甄别（三判据表/create 命令/孤儿警告） | 归提示词 | 同上，judgement 表在 designer 提示词；命令语法【进手册】 |
| S10 | Step3 验证两关（结构关 validate + 质量关 doctor 必须 0 error） | 拆 | **门禁语义【留】**（预览前必须双绿）；怎么跑（--json、参数、失败怎么办）【进手册】§validate-ops |
| S11 | Step4 serve 预览（贯穿全程不关闭/不重复启动） | 拆 | 编排行为【留】；端口参数/占用处理【进手册】 |
| S12 | Step5 审核硬 gate + 三透镜话术 + "绝不自链执行" | 留 | 编排灵魂，整段保留 |
| S13 | 常见错误表（13 行） | 逐行拆 | 见 §1-A 明细 |
| S14 | Red Flags / 细节与规范指针 | 逐行拆 | Red Flags 并入 S13 同源条目；文件指针更新为新布局路径 |

### §1-A S13/S14 逐行归宿

| 条目关键词 | 归属 | 说明 |
|-----------|------|------|
| 跳过 entry/exit 先建 L1 | 归提示词 | designer 流程纪律 |
| 裸节点（无三要素） | 归提示词 | designer 纪律（机器侧 E4 在手册） |
| validate 有 warning 就放行 | 留+进手册 | 门禁语义留 skill；warning 分类怎么读在手册 |
| 用 CLI 建图没验可达性 | 进手册 | 工具自动查的能力说明，随 doctor 章节 |
| 审核没过偷偷执行 | 留 | 编排护栏（gate 是硬的） |
| 忘了 serve 在跑重复启动 | 留 | 编排护栏 |
| 边类型乱用（fan_out 当 depends_on） | 归提示词 | 九边选型判断力在 designer（见 DR5 决策） |
| 为术语单独建节点 | 归提示词 | designer 术语纪律 |
| 每个决策都建 ADR | 归提示词 | 三判据自律 |
| 跨 context 边不填 contract | 归提示词 | designer 硬规则（schema 细节在手册） |
| 设计完自链进入执行 | 留 | 编排护栏 |
| reference/scripts 指针段 | 删·改写 | 指向新布局（手册正本 + `sp-check-design.mjs` 新位置随包同步） |

---

## 二、plumber-design/reference.md（7 节）

| # | 节 | 归属 | 处置 |
|---|-----|------|------|
| DR1 | §1.1 entry/exit 建法（含"create-node 建 entry/exit 文件"做法） | 进手册·重写 | ⚠️ 本节存在文档-实现漂移：教手建 `entry`/`exit` 任务节点，而 v0.2 起 `graph update-graph` 直写图级字段（本图即按字段式建成）。手册按引擎现状重写；医生脚本已支持根汇锚定，不再依赖 entry/exit 文件节点 |
| DR2 | §1.2 分层与 id 命名 | 归提示词 | designer 专业协议 |
| DR3 | §1.3 节点三要素 | 归提示词 | 同 S7 去重，唯一正文在 designer；校验行为在手册 |
| DR4 | §1.4 先 topo 后运行时 | 归提示词 | 一句话心法 |
| DR5 | §2 九边选型表+判据 | 归提示词 | **判定为设计判断力而非语法**：表不长且直接决定图质量，整表保留在 designer 提示词；手册不做第二份（防漂移），仅在错误处理节引用 |
| DR6 | §3 体检项明细（E1-E10/W1-W6） | 进手册 | 权威清单跟随脚本本体（本次修复后语义：知识顶点豁免、根汇锚定、W6 多根多汇）；⚠️ 原文 W2/W3 定义与脚本实现恰好颠倒（文档说 W2 密度/W3 无父，代码是 W2 无出边/W3 无入边）——手册以代码为准修正 |
| DR7 | §4 验证命令速查 | 进手册 | 归入 validate-ops 章 |
| DR8 | §5 serve 用法参数 | 进手册 | gate 语义已由 S11 承接 |
| DR9 | §6 反模式表 | 逐行拆 | 与 S13 同源的条目合并去重后按同一规则归属（去重明细见手册撰写时的 merge 记录） |
| DR10 | §7.1 CONTEXT 模板书写纪律 | 归提示词 | 划界句式/术语纪律属判断力；YAML 字段格式示例【进手册】 |
| DR11 | §7.2 ADR 六字段写法 | 归提示词 | 同上拆分 |
| DR12 | §7.3 快照即定稿点 | 进手册 | snapshot/export 操作知识；"图为真相源"原则一句留 designer |

---

## 三、plumber-execute/SKILL.md（11 段）

| # | 段落 | 归属 | 处置 |
|---|------|:----:|------|
| X1 | frontmatter description | 留 | 同 S1 |
| X2 | Overview（CLAIM→…→passed 五步歌） | 留 | 协议步骤名与纪律是编排骨架 |
| X3 | When to Use | 留 | — |
| X4 | REQUIRED SUB-SKILL 两行 | 留·改写 | 同 S4：解耦为派单语义 |
| X5 | 执行协议 0-5 步细则（PLAN 数据源/CLAIM 字段/REPORT AS YOU GO/HAND OFF/passed 门禁叙述） | 拆 | **五步骨架+每步一句纪律【留】**；`governing_adrs` 机制解释、状态机字段、force 拒绝、原子认领细节、【进手册】§claim-ops；新增 solo 分支注入本节尾（机械自裁边界引用手册清单） |
| X6 | 并行决策两步走（结构判读+联合条件） | 拆 | **条件表+≤3+回收不 cancel【留】**（这就是编排本职）；6.1 字段判读法（桶/truncated/fan 结构怎么看数据）【进手册】 |
| X7 | 并行实现方式（独立 claim/汇合 verify/subagent 类型参考） | 留·改写 | 类型参考行改为占位符 `{{executor-agent-types}}`——三个集成包组装时各自本地化（pi=hephaestus/sisyphus-junior/explore；claude/zcode 待包内实装名单），这是"分别写"的自然结果 |
| X8 | stale 回收三步 | 留 | 编排决策（何时回收、绝不 cancel）；reclaim 命令细节在手册 |
| X9 | 结束验收三层 | 拆 | 层名+"成果层不信报告信 artifact"铁律【留】；逐层操作手法【进手册】 |
| X10 | 常见错误表（12 行） | 逐行拆 | claim 非 ready/force/already claimed/pending→running 一步到位 →【进手册】错误表；checkpoint 攒批/report 后补/fan_in 不等齐/串并行误判/stale 直接 cancel/只跑 validate 宣告完成 →【留】（纪律类） |
| X11 | Red Flags / 细节与工具指针 | 逐行拆 | "CLI 就够了""报一个过一个"等纪律性红旗【留】；其余并入手册对应节；指针更新 |

## 四、plumber-execute/reference.md（9 节）

| # | 节 | 归属 | 处置 |
|---|-----|------|------|
| XR1 | §1 访问层表 | 进手册 | 手册开篇章（本就是访问层总览） |
| XR2 | §2 CLI 20 命令表 | 进手册 | 唯一权威处（claims 里 init 等 MCP 无通道的项特别标注） |
| XR3 | §3 状态机 7 态+三条硬规则 | 进手册 | 手册核心章；skill 只留一句"passed 有硬门禁，详见手册" |
| XR4 | §4 MCP 19 工具表 | 进手册 | 同上 |
| XR5 | §5 sp-\*.mjs 脚本用法 | 进手册 | 路径更新为新同步布局（脚本本身列为机械共享件，一份正本三包拷贝） |
| XR6 | §6 并行细则 6.1-6.3 | 拆 | 6.1 数据字段判读→手册；6.2/6.3 已由 X6/X7 承接，本节不双份 |
| XR7 | §7 三层验收细则 | 进手册 | 手册收实操段；框架句在 skill |
| XR8 | §8 错误处理大表 | 进手册 | 手册错误处理章主干（承接 S13/X10 推来的行） |
| XR9 | §9 红线 STOP | 拆 | 手改 YAML/force/编造工具名/汇聚不等齐 → 手册红线；validate 失败继续走/只跑 validate 宣告完成 → skill 红线 |

---

## 五、新内容（重构引入的全新段落，均非迁移）

1. **skill 侧**：每个收缩版 skill 新增「派单模板」节（任务目标＋显式文件边界＋首行 Read 手册＋信息优先级声明）和「solo 分支」节（Read 对应 agent 提示词原地扮演＋主观判定汇总留人）。
2. **agent 提示词侧**：头部版本来源注释；首步 Read 手册指引行；solo 时被扮演的合同义务（机械自裁可、主观留人）。
3. **手册侧**：「solo 机械自裁边界清单」（checkpoint 聚合/artifact 存在性/状态层结构层）与「主观判定留人清单」（DoD 质量裁量、ADR accept/supersede）；「各工具手册寻址约定」（pi=Read `integrations/shared/manual.md` <章节>，相对仓库根——与蓝图 §3 一致；claude/zcode 插件包=Read `./manual.md` <章节>，包根相对且 Skill base-dir 可解析）。
4. **设计期发现的三处文档-实现漂移**（修复责任在手册重写）：DR1 的 entry/exit 节点做法过时；DR6 的 W2/W3 定义与代码颠倒；DR 旧 E6/E7 entry→exit 叙事已被根汇锚定取代。

## 覆盖自查（cp_list 判据）

- S 全 14 段 ✔｜DR 全 12 节 ✔｜X 全 11 段 ✔｜XR 全 9 节 ✔ —— 四文件共 46 个片段均有归属标签，无一悬挂
- 【删】类仅 1 处（S13 内指针行），其余全部换归属保留
