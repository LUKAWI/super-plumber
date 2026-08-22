# Plumber Design Reference — 拓扑设计规范与质量清单

本文件是 **plumber-design** skill 的配套参考：设计拓扑图时的规范、边类型选型、质量清单明细。流程协议（5 步）见 SKILL.md；执行阶段工具见 plumber-execute。

**一句话：设计期的错误最便宜。图上省一行，执行期贵十倍。**

---

## 1. 拓扑结构规范

### 1.1 entry 与 exit（第一优先级）

**两个动作都要做**（缺一个，边连不上或 validate 挂）：

1. **建节点文件**（让边可连、topo 排序能排）：

```bash
graph create-node -i entry -l "入口" -t task --level 0 --plan-desc "需求入口" --dod "需求已定义"
graph create-node -i exit -l "出口" -t task --level 0 --plan-desc "验收出口" --dod "验收通过"
```

1. **填 graph.yaml 的图级字段**（手写，CLI 无命令）：

```yaml
entry:
  description: "需求的一句话（做了什么、为谁、边界）"
  defined_by: human
  level: 0
exit:
  description: "整体交付物的完成定义"
  acceptance_criteria:
    - "可验证标准 1（能被机器或人客观检查）"
    - "可验证标准 2"
  defined_by: human
  level: 0
```

- entry/exit 都是 level 0，且**全图各只有一个**
- 首节点从 entry 接入（`entry → l1_*`），末节点汇入 exit（`l2_*/l1_* → exit`），边类型 `depends_on`
- acceptance_criteria 2–5 条为宜：每条必须是**可验证**的（"代码已部署"不如"`curl https://...` 返回 200"）
- 验收标准含糊 → 执行阶段无法裁决 → 设计期就要消除

### 1.2 分层与 id 命名

| 层 | 含义 | id 前缀 | 数量建议 |
|----|------|---------|---------|
| L0 | entry / exit | — | 各 1 |
| L1 | 动脉（大阶段） | `l1_*` | 3–6 |
| L2 | 毛细血管（L1 下的子任务） | `l2_*` | 每 L1 下 2–5 |
| L3+ | 树状延伸子任务 | `l3_*`/`l4_*`... | 按需，一般 ≤5 层 |

- id 用 snake_case，语义化：`l1_register`、`l2_auth_flow`，不要 `l1_task1`
- L2+ 必须挂在父层下（有边连接），不允许游离的子任务
- 图规模 3–20 节点为宜；超过说明拆得不够细或需求太大

### 1.3 节点三要素（每节点 MUST）

```yaml
plan:
  description: "这个节点做什么（一句可执行的指令，不是目标）"
checkpoints:
  - id: cp1
    label: "第一步子步骤"
  - id: cp2
    label: "第二步子步骤"
expected_outcome:
  definition_of_done:
    - "完成标准（可验证）"
```

- `plan.description`：写给执行者的指令（做什么），不是抽象目标（"实现登录" vs "设计登录 API 并写单测"）
- `checkpoints` ≥1：执行者逐步上报的依据。**没有 checkpoints 的节点无法汇报进度**
- `definition_of_done` ≥1：裁决节点是否真的完成的依据

### 1.4 边：先 topo 后运行时

设计顺序：**先连决定顺序的边（depends_on/validates），再加表达语义的边（fan_out/fan_in 等）**。

---

## 2. 九边类型选型表

| 类型 | 用在哪 | 参与排序 | 设计期判据 |
|------|--------|:---:|------|
| `depends_on` | 串行依赖：B 必须等 A 完成 | ✅ | 大部分主链都是它 |
| `validates` | 验证关系：B 验证 A 的产物 | ✅ | 测试/审核/校验节点对上游的验证 |
| `shares_context` | 共享上下文：A、B 共享一份材料 | ❌ | 并行但共享输入（不阻塞） |
| `fan_out` | 并行分发：一个节点拆出多个独立子任务 | ❌ | L1 拆 L2 并行干活的入口 |
| `fan_in` | 汇聚合并：多个子任务汇入一个节点 | ❌ | 并行完成后必须合并的汇聚点 |
| `fallback` | 失败兜底：A 失败走 B | ❌ | 降级/备选路径 |
| `iterates` | 迭代优化：A 循环打磨 B | ❌ | 反复优化的回路 |
| `decides`（v0.5） | 决策管辖：ADR → 它决定的节点/context | ❌ | 挂接架构决策；superseded 时沿此传播 adr_flags；source 必须是 adr 顶点 |
| `relates`（v0.5） | 领域关系：context ↔ context | ❌ | 上下文间上下游/共享内核等；rel_kind 自由标注，仅限两端都是 context 顶点 |

**选型判据（设计期自问）：**

- 这个依赖是"必须等它完成才能开始"吗？→ `depends_on`/`validates`
- 只是"共享材料、可并行"？→ `shares_context`
- 一个节点要裂变成多个并行子任务？→ 出边用 `fan_out`
- 多个并行任务要汇合后再继续？→ 入边用 `fan_in`
- 主链断了是否有备选？→ `fallback`
- 产物需要反复打磨到达标？→ `iterates`
- 这条 ADR 管辖哪个对象？→ `decides`（ADR → 节点/context）
- 两个上下文什么关系？→ `relates`（+ rel_kind 标注）

> 常见反模式：把 `fan_out`/`fan_in` 当成 `depends_on` 用（语义全丢），或反过来用 `depends_on` 表达并行意图（执行期白白串行）；给 `relates` 之外的知识语义发明新边类型（一种类型+自由标注够了，防装饰边回潮）。

---

## 3. 设计质量清单（体检项明细）

`sp-check-design.mjs` 自动执行以下检查，报 error 必须修，warning 建议修：

### Error 级（必须全过）

| # | 检查 | 判据 |
|---|------|------|
| E1 | entry 已定义 | `graph.yaml` 有 `entry.description` 且非空 |
| E2 | exit 已定义 | `exit.description` 非空 |
| E3 | 验收标准存在 | `exit.acceptance_criteria` 非空数组（≥1 条） |
| E4 | 节点三要素 | 每节点 `plan.description` 非空 **且** `checkpoints` ≥1 **且** `expected_outcome.definition_of_done` ≥1 |
| E5 | 孤立节点 | 无入边且无出边的节点（entry 可无入边、exit 可无出边，其余必须有边） |
| E6 | entry 可达性 | 从 entry 沿 topo 边（depends_on/validates）能到达**每个**节点 |
| E7 | exit 可达性 | 每个节点沿 topo 边能到达 exit |
| E8 | 无 topo 环 | topo 边（depends_on/validates）无环 |
| E9 | 边引用完整 | 每条边的 source/target 都是存在的节点 |
| E10 | 边类型合法 | type ∈ 9 种（depends_on/validates/shares_context/fan_out/fan_in/fallback/iterates/decides/relates） |

### Warning 级（建议修）

| # | 检查 | 判据 |
|---|------|------|
| W1 | id 规范 | L1 节点 `l1_*`、L2 节点 `l2_*` 前缀匹配 level |
| W2 | 边密度 | 图太大而边太少（>10 节点但 topo 边 < 节点数）——可能有断链 |
| W3 | L2 无父 | L2 节点有入边但父 L1 不含它（游离 L2） |
| W4 | checkpoints 过少 | 节点 plan 较长但 checkpoints < 2（执行者无法逐步汇报） |

---

## 4. 验证命令速查

```bash
# 结构验证（官方）——每次改动图之后必跑
graph validate

# 设计质量体检（本 skill 专用）——从含 .graph/ 的目录运行
node .pi/skills/plumber-design/scripts/sp-check-design.mjs          # 人类可读报告
node .pi/skills/plumber-design/scripts/sp-check-design.mjs --json   # JSON 输出（脚本/agent 解析）
```

**顺序：先 `graph validate`（结构）→ 再体检脚本（质量）→ 都 0 error 才 serve 预览。**

## 5. 预览与审核

```bash
graph serve                  # 默认 8934；浏览器自动打开
graph serve -p 8940 --no-open  # 指定端口；不开浏览器（无头环境）
```

- serve **贯穿全程不关闭**：用户意见 → 改图 → watcher 自动推送刷新
- 审核 gate：`用户批准前不执行。` 批准后 → REQUIRED SUB-SKILL: plumber-execute

## 6. 常见设计反模式（每个都真实发生过）

| 反模式 | 后果 | 修正 |
|--------|------|------|
| 只有 L1 没有 L2 | 节点太大无法逐步汇报 | 每 L1 拆 2–5 个 L2 |
| 验收标准是形容词（"体验好"） | 无法裁决 | 改成可验证的客观标准 |
| 节点只有 plan 没有 checkpoints | 执行期无法报进度 | 三要素齐备 |
| 所有边都是 depends_on | 明明可并行却串行 | 并行意图用 fan_out/shares_context |
| entry 不连任何节点 | 图无法启动 | entry → 首个 L1 必连 depends_on |
| 修改图后不跑 validate | 结构错误带进执行期 | 每次改动后必跑 |

---

## 7. 领域文档书写模板（v0.5.1）

> **格式决策**：本工具的真相源是 YAML 顶点字段，**不是 markdown**——模板以"字段书写范式"给出；
> markdown 只是导出视图（`graph export --docs` 手动、`graph snapshot` 自动），别在图里存 markdown。

### 7.1 CONTEXT 顶点模板（节点即文档）

```yaml
# .graph/nodes/ctx_<域名>.yaml 的目标形态（用命令逐步填充，不手写文件）
id: ctx_<短名小写>            # 如 ctx_ordering / ctx_storage；与 label 呼应
type: context
label: <中文名>               # 如 "订单上下文"——领域地图与 CONTEXT-MAP.md 里显示的名字
boundary: <一句话划界>        # 句式："负责 X；不负责 Y（Y 归 <别的 context> / 经契约边由 Z 消费）"
                              # 必须同时说清"是"与"不是"，只写一半边界就不成立
glossary:                     # 术语表：每条 1-2 句，术语是内容字段不是独立节点
  - term: <术语>
    definition: <定义句式："是……，区别于……（划界）">
                              # 反例："订单：跟订单有关的东西"（没划界，等于没定义）
```

**书写纪律**：
- boundary 与每条 definition 都要**能划界**——写完自问："读到这句话的人能判断一个东西归不归这里吗？"
- 同一 context 内术语不重复（validate 警告）；**跨 context 同名合法**（DDD 本义——同一词在两个上下文各说各话是边界存在的证据，不是错误）
- 术语数 2-5 条起步即可，宁缺毋滥：只收录在节点 plan/执行中真实会用到的词
- context 无状态、无 plan/DoD——它是文档不是任务

### 7.2 ADR 顶点模板（对齐手写 ADR 的段落传统）

```yaml
# graph adr create 自动生成骨架，各字段的写法：
label: <短标题，名词短语>      # 会成为导出文件 "# 000N — 标题" 与 adr list 的显示
decision: <1-3 句>            # "我们决定了什么"——直陈句式，能独立成立，不依赖其它字段
background: <决策时的上下文>   # 导出为 **Context：**——未来读者不知道的背景才值得写
considered_options: <备选项>   # 导出为 **Considered Options：**
                              # 句式："A→为何落选; B→为何落选; C←选中"；没有真实备选就别建 ADR
why: <为何选它>               # 导出为 **Why：**——与 considered_options 呼应，讲取舍理由
consequences: <后果与代价>     # 导出为 **Consequences：**——诚实写代价（"丧失了 X"比"更加灵活"有价值）
```

**书写纪律（同 domain-modeling ADR 传统）**：
- **三判据缺一不建**：难逆转 + 脱离上下文令人费解 + 真实权衡——不满足的决策写进节点 plan 即可
- **极简**：1-3 句说清的事不写 5 句；ADR 的价值在"记下做过这个决定以及为什么"，不在填满字段
- 建完必须挂 decides 边（孤儿 ADR 会被 validate 警告）；**只 propose 不裁决**——accept/supersede 归 super-mario/人类
- 导出视图示例（自动生成，勿手改）：`docs/adr/0003-xxx.md` = `# 0003 — 标题` + decision 段 + `**Status：**` + 四个可选段落 + 生成注脚

### 7.3 快照即定稿点

`graph snapshot -m "<定稿说明>"` 会**自动导出**全部领域文档视图（CONTEXT-MAP.md + docs/contexts/*.md + docs/adr/*.md，v0.5.1 起无需手动 export）——设计完成 → 快照 → md 视图随快照点落盘，git 提交即冻结"图 + 文档"一致的状态。图为真相源，md 永远可由重导出再生。
