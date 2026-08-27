# Super Plumber Operations 手册（唯一正本）

> **定位**：三访问层（CLI / MCP / 脚本）操作语法、状态机、错误处理、solo 裁决边界的**唯一权威正本**。角色提示词与 skill 中的一切语法引用指向本文对应章节；本文不复述任何角色的判断力内容（边类型选型、设计甄别、DoD 质量裁量等归各自角色提示词，见 §10/§11）。
> **版本锚点**：super-plumber **0.6.0**（全部 CLI 参数经 `graph --help` 实测于 v0.6.1 重构期；与旧文档不符处以实测为准，表中以〔已校〕标注）。
> **分发**：正本住 `integrations/shared/manual.md`，由 `scripts/sync-integrations.mjs` 构建期同步进两个插件包（sha256 三方一致）；pi 侧只引用不拷贝。寻址写法见 §11。（该脚本属 W3 波次，接线中）

目录：§1 访问层总览｜§2 design-ops｜§3 九边语法注记｜§4 execute-ops｜§5 状态机｜§6 工具总表（CLI+MCP）｜§7 脚本章｜§8 三层验收实操｜§9 错误处理大表｜§10 solo 自裁边界｜§11 寻址约定｜§12 漂移修正常记

---

## §1 访问层总览

何时查这章：不确定某操作该走哪一层、或某层做不了什么时。

| 层 | 形态 | 能做什么 | 不能做什么 |
|----|------|---------|-----------|
| CLI `graph` | 27 个子命令入口（§6.1），bash 友好 | 全流程：init 建图、多图管理、设计读写、执行流转、verdict 裁决、快照回滚、events 审计、export/serve；**唯一人类运维通道**（--force、rename-graph、delete-graph） | agent 不使用 `--force`；非 JSON 的输出需 `--json` 供解析 |
| MCP `graph_*` | 24 个工具（§6.2），zod 强校验 | 设计+执行+裁决+版本几乎全能，校验最强——agent 首选 | 刻意不设通道：init 建新图、rename-graph、delete-graph、export --docs（走 CLI）；`force:true` 被**协议级拒绝** |
| 脚本 `sp-*.mjs` | 7 个文件（§7），薄包装 | 无 MCP 客户端时的 claim / checkpoint / report / 状态流转 / 读节点 / 遍历 | 只是核心引擎的包装，能力面窄于前两层；从含 `.graph/` 的 cwd 运行 |

优先级：**MCP > CLI > 脚本**。执行期一切状态流转必须经这三者之一——**绝不手改 `.graph/` YAML 伪造状态**。

---

## §2 design-ops：建图、领域顶点、ADR 与体检

何时查这章：设计或修改拓扑图、建 context/ADR、跑 validate 与体检、起 serve 预览时。（选型判断力与建模方法论在设计师角色提示词，这里只有语法。）

### 2.1 标准建图序列

```bash
graph init -l "<图显示名>" <图名>        # 图名 ^小写[a-z0-9-] 内容命名；旧仓库带名 init=一次性迁移
graph update-graph --entry-desc "<需求一句话>" --exit-desc "<交付完成定义>" \
  --add-criteria "<可验证验收标准1>" --add-criteria "<标准2>"
graph create-node -i l1_a -l "<标签>" --level 1 --plan-desc "<计划>" --dod "<标准>" --dod "<标准>"
graph add-edge -i e001 -s l1_a -t l1_b --type depends_on    # 先连 topo 边（排序用）
graph add-edge -i f01  -s l1_a -t l2_c --type fan_out       # 再加运行时边（并行语义）
graph validate                                               # 每次结构改动后必跑
graph serve                                                  # 预览，贯穿全程不关闭
```

- entry/exit 是**图级字段，不是节点文件**（v0.2 起 `update-graph` 直写 graph.yaml；详见 §12-1）
- 批量建图：MCP `graph_batch_create`（nodes+edges 先全量预校验再落盘）**每批 ≤200 个节点**，大图分段提交；CLI 侧循环 create-node/add-edge
- 验收标准 2–5 条，每条必须可机器或人客观验证

### 2.2 update-graph：图级字段编辑〔已校〕

```bash
graph update-graph \
  --label "<图名>" --entry-desc "<text>" --exit-desc "<text>" \
  --add-criteria "<item>" \
  --set-context '{"tech":"ts"}'
# --add-criteria 可重复追加；清空验收标准用 --clear-criteria；
# --set-context 设置 root_context（JSON 对象）。实测参数全集即上六项（MCP graph_update_graph 同名字段）。
```

### 2.3 节点与边的读写

```bash
# 建节点（一次带齐三要素）
graph create-node -i <id> -l "<标签>" [-t task] [--level N] [--priority <n>] \
  [--context ctx_x] [--assigned-to <agent>] --plan-desc "<计划>" --dod "<标准>"(可重复)
# 〔已校〕create-node 没有 --max-attempts；设上限走 update-node

# 补 checkpoints（JSON 可重复追加）
graph update-node -i <id> --add-checkpoint '{"id":"cp1","label":"第一步"}'

# 建边
graph add-edge -i <eid> -s <源id> -t <目标id> --type depends_on \
  [--rel-kind "<自由文本>"] \
  [--contract '{"produces":"...","consumed_by":[...],"validation":{...}}']
# --rel-kind 仅 relates 边用；两端跨不同 context 的工作流边 = 契约边，contract 必填（未填 validate 警告）

# 读单节点：返回 node 全文 + allowed_transitions + checkpoint_aggregate + ready_gate（+ governing_adrs）
graph get-node -i <id> --json [--neighbors up|down|none]

# 改节点内容的全部参数（实测）
graph update-node -i <id> [--plan-desc <text>] [--add-dod <item>]×N [--clear-dod] \
  [--add-checkpoint <json>]×N [--set-assigned <agent>] [--label <text>] \
  [--max-attempts <n>] [--set-priority <n>] [--set-context ctx_x|""] \
  [--boundary "<划界句>"] [--glossary-add '{"term":"..","definition":".."}']×N \
  [--reset-attempts] [--show]
```

软删除：`graph delete-node -i <id> [--cascade]`（有引用边默认拒绝）、`graph delete-edge -i <eid>`（保留 `.deleted.yaml` 历史）。索引损坏重建：`graph rebuild`。

### 2.4 领域顶点（context / ADR）语法

```bash
# context 顶点（节点即文档；无状态、不参与调度）
graph create-node -i ctx_<域名> -t context -l "<中文名>"
graph update-node -i ctx_ordering --boundary "负责订单生命周期；不负责计费（经契约边由 billing 消费）"
graph update-node -i ctx_ordering --glossary-add '{"term":"订单","definition":"带明细行的购买单据，区别于账单"}'
# 术语是内容字段不是顶点；同 context 内术语重复 → validate 警告；跨 context 同名合法
graph add-edge -i rel_1 -s ctx_a -t ctx_b --type relates --rel-kind "上游-下游"   # 仅 context↔context

# 工作流节点归属 context：创建时 --context ctx_x 或事后：
graph update-node -i task_form --set-context ctx_auth     # 悬空归属会被 validate 报 error

# ADR 命令组〔已校〕四子命令：create / accept / supersede / list
graph adr create -t "<标题>" -d "<决策>" [-b 背景] [-o "A→为何落选; B←选中"] [-w 为何] [-c 后果]
                                                          # 自动编号 adr_NNNN，状态落 proposed
graph add-edge -i d_1 -s adr_0001 -t <管辖的节点或ctx> --type decides   # 孤儿 ADR 会被警告
graph adr accept -i adr_0003                              # proposed→accepted（裁决方专用）
graph adr supersede -i adr_0003 --by adr_0007             # 原子一步：状态+接替者；--by 必填
graph adr list -s proposed                                # -s proposed|accepted|superseded
```

- MCP 侧创建用 `graph_create_adr`（同样自动编号+proposed）；**MCP 废弃须两步**：先 `graph_update_node {id, superseded_by:"adr_NNNN"}`，再 `graph_update_node_status {status:"superseded"}`。CLI `graph adr supersede` 是原子封装
- **提议/裁决分离**：设计与执行 agent 只 produce proposed；accept/supersede 归 super-mario/人类（见 §10）
- ADR 六字段 YAML 目标形态（格式示例；写得是否够格归设计师纪律）：`label`（短标题）/ `decision`（我们决定了什么）/ `background` / `considered_options`（备选取舍）/ `why` / `consequences`；废弃后出现 `superseded_by`
- CONTEXT 顶点目标形态：`id: ctx_<短名>` / `type: context` / `label` / `boundary`（负责 X，不负责 Y）/ `glossary[].{term, definition}`（定义要能划界）

### 2.5 快照与文档导出

```bash
graph snapshot -m "<定稿说明>"      # 快照即定稿点：自动导出 CONTEXT-MAP.md + docs/contexts/ + docs/adr/
graph export --docs [--adr-dir docs/adr] [--ctx-dir docs/contexts]   # 手动补导出
graph export --mermaid -o topology.mmd                # 默认 Mermaid 流程图
graph snapshots [--json]; graph diff [--from id] [--to id]; graph rollback <snapshot-id> --confirm [--design-only]
```

真相源是 YAML 字段，markdown 只是导出视图——别在图里存 markdown。rollback 必须显式 `--confirm`（自动备份当前状态）；`--design-only` 只回滚设计态、保留执行进度。

### 2.6 validate + doctor（体检）

```bash
graph validate          # 结构关：逐文件 schema 校验 + 幽灵边 + 循环依赖（含 fan 门控隐藏环）+ 领域规则六条 + graph.yaml 引用双向漂移；必须 0 error
node .pi/skills/plumber-design/scripts/sp-check-design.mjs [--json]   # 质量关（doctor），从含 .graph/ 的目录运行
```

两关都 0 error 才允许 serve 预览。doctor 体检项权威表（以现行代码为准）：

| 级别 | 项 | 判据 |
|------|----|------|
| error | E1/E2/E3 | `entry.description` / `exit.description` / `exit.acceptance_criteria` 三者非空（应已由 §2.2 update-graph 设置；脚本提示文案仍写"graph.yaml 手写"，行为按 §12-1 修正理解） |
| error | E4 | 每个**工作流**节点三要素齐：plan.description 非空 + checkpoints ≥1 + definition_of_done ≥1（context/adr 知识顶点豁免） |
| error | E5 | 孤立节点：无入边且无出边 |
| error | E6 | 从任何根沿 topo 边不可达的节点；或全体都有入边（全环拓扑）〔已校：根汇锚定语义〕 |
| error | E7 | 无法到达任何汇的节点〔已校：根汇锚定语义〕 |
| error | E8 | topo 边成环（报出环路径） |
| error | E9 | 边 source/target 引用不存在的顶点 |
| error | E10 | 边类型 ∉ 9 种合法值 |
| warning | W1 | id 前缀与 level 不匹配（l1_/l2_/…） |
| warning | W2 | **无出边**（不通向任何下游）——非唯一汇才报〔已校：旧文档误作"密度"，代码为无出边〕 |
| warning | W3 | **无入边**（游离节点，谁触发它？）——非唯一根才报〔已校：旧文档误作"L2 无父"，代码为无入边〕 |
| warning | W4 | plan 较长但 checkpoints < 2（执行者无法逐步汇报） |
| warning | W5 | 磁盘存在但 graph.yaml 未引用（孤儿文件/幽灵边） |
| warning | W6 | 多个根 或 多个汇（建议收敛单一主干起点、单一收口） |

warning 都要看懂并修掉再走——可修的不该被放过。

### 2.7 serve 预览

```bash
graph serve                     # 默认端口 8934〔已校〕；启动自动开浏览器
graph serve -p 8940 --no-open   # 指定端口；无头环境不开浏览器；端口占用 → 换 -p
```

serve 贯穿全程不关闭、已在运行不重复启动（编排纪律在 skill）。

---

## §3 九边类型速查注记

何时查这章：连边前确认类型拼写与约束签名。

**选型判断力（什么场景该用哪种边）在设计师生角色提示词中，此处只列语法签名，防止两份漂移：**

`add-edge --type` ∈ `depends_on｜validates｜shares_context｜fan_out｜fan_in｜fallback｜iterates｜decides｜relates`

- `decides` 仅 ADR→任意顶点（source 必须是 adr）；`relates` 仅 context↔context 且须附 `--rel-kind` 自由标注
- `depends_on`/`validates` 参与 topo 排序与 ready 门禁；`fan_in`/`fan_out` 参与门控；`shares_context` 不参与排序与门禁（仅标注上下文共享）
- `fallback`/`iterates` 当前为**文档性标注**（运行时不实现其回退/迭代语义），validate 会逐条 warning——如实告知，不是 bug
- 两端跨 context 的工作流边必须带 `--contract`（未填 validate 警告）；契约形状见 §2.3

---

## §4 execute-ops：五步协议与并行判读

何时查这章：执行任何节点、claim/report/passed 报错、判断串行还是并行时。（每步纪律句留在 skill，这里只有调用语法与字段含义。）

### 4.1 五步协议的工具调用语法

**① PLAN — 调度决策**

```bash
graph_get_next_actions { }                       # MCP；可选 stale_ms（默认1800000）、limit（每桶默认100）、assigned_to
graph next [--stale-ms 1800000] [--json]         # CLI
```

一次返回五个桶：`ready`（可直接认领）/ `ready_eligible`（门禁已满足的 pending/failed，转 ready 即执行——**冷启动第一步从这里拿入口节点**）/ `blocked`（附 unmet 未满足前驱清单）/ `running`（附时长与执行者）/ `stale_running`（超阈值无更新的疑似卡死）。桶截断时 `truncated: true` → 加大 limit 翻页。条目可能带 `adr_flags`（⚠️ 所依据 ADR 已 superseded → 停下重审后再动工）。

**② CLAIM — 原子认领**

```bash
graph_update_node_status {id, status:"running", claim_by:"<你的agent名>"}   # 同一调用原子写入 assigned_to+started_at
graph update-status -i <id> -s running --claim-by <agent>                   # CLI 等价
node sp-claim.mjs <node_id> <claim_by>                                      # 脚本等价
```

- ready_eligible 节点先 `{status:"ready"}`（核心层再次校验门禁）再 claim；**绝不 claim 非 ready 节点**，`pending→running` 一步到位会被状态机拒绝
- 并发认领原子：败者收到 `already claimed by X` → 换节点，**不重试同节点**
- **force 协议拒绝机制**：MCP 通道对 `force:true` 一律协议级拒绝（v0.4 起，传了直接报错）；CLI `--force` 仅人类运维可用且必写 force_override 审计事件。agent 无 force 后门
- **governing_adrs 必读机制**：claim 成功的响应附 `governing_adrs`（decides 指向本节点或其 context、且未 superseded 的 ADR 标题级指针）。不为空则相关决策必须知悉，需要细节用 `graph_get_node` 取全文；若在 next 条目/claim 响应中看到 `adr_flags` ⚠️（依据已被接替）→ 先弄清新决策再动手。ADR 状态只能由裁决方改，执行 agent 不改

**③ WORK**：按 `plan.description` 干活，把 `checkpoints` 当逐条清单。取任务全文用 `graph_get_node {id}`（plan/checkpoints/DoD 与 governing_adrs 一次拿齐）。

**④ REPORT AS YOU GO — checkpoint 上报**

```bash
graph_update_checkpoint {node_id, checkpoint_id, status}     # status ∈ pending|running|passed|failed|skipped
node sp-checkpoint.mjs <node_id> <cp_id> <status>            # CLI 无子命令，脚本等价
```

每完成一个立即上报（绝不攒批）；同状态重复上报幂等成功；checkpoint 小状态机见 §5 尾。

**⑤ HAND OFF — 执行报告交接单**

```bash
graph_update_execution_report {node_id, summary, artifacts:["真实路径",...], blockers:[...], notes}
node sp-report.mjs <node_id> "<summary>" [artifacts.csv] [blockers.csv] [notes]
```

`artifacts` 填真实文件路径——主控会核验存在性并回报 `exists:false` 明示缺失，绝不填编造路径。
可选 `verification:{verdict:"passed|failed|pending", note}` 写裁决结论（**裁决方用**；也可 CLI `graph verdict -i <id> --verdict <v> [--note t]`）。

**passed 门禁与裁决顺序**：`running→passed` 受三条硬规则约束（全文见 §5 规则 3），所以裁决顺序铁律是**先 verdict 后 passed**：先 `graph_update_execution_report {verification:{verdict:"passed", note}}`（或 CLI `verdict`），再 `graph_update_node_status {id, status:"passed"}`；passed 之后没有"撤销为 running"的路径。下游推进用 `graph_update_node_status {status:"ready"}`（ready 门禁复校前置，错依赖不放行）。

### 4.2 并行结构判读法（next/get_graph 的数据怎么看）

- `ready` → 核心层已验门禁，直接认领；`ready_eligible` → 转 ready 即执行；`blocked.unmet` → 补齐后自然放行
- **fan_out 批**：同一上游发散出的多个无依赖目标 = 天然并行候选（前驱 passed 后同时进入 ready_eligible）
- **fan_in 汇聚**：多条 fan_in 入边的节点 = 汇合点，必须等**全部**上游 passed 且 execution_report 齐备才可认领（核心层门禁强制拦截提前 claim）
- 主链（depends_on/validates 串行段）无并行空间
- 在此之上叠加编排条件（工作量值得、不共享写冲突、≤3 个）属 skill 领土；调度器只提供以上结构事实

### 4.3 卡死回收与失败重试

```bash
graph_reclaim_node {id, by:"<操作者名>"}       # 只有 running 节点可回收
graph reclaim -i <id> --by <actor>
```

stale 处理三步：确认长时无更新（默认阈值 30 分钟 = 1800000ms）且执行者不可达 → reclaim（running→pending，attempts 不变，清空 assigned_to，回收记录写入 notes）→ 节点重回调度池。**绝不 cancel 一个可以回收的节点**（cancelled 会阻塞下游所有汇合点）。

重试链：`failed→pending` 时 attempts 自动 +1；`attempts ≥ max_attempts(>0)` 后拦截并提示人工介入；显式重置用 `graph update-node -i <id> --reset-attempts` 或 MCP `graph_update_node {reset_attempts:true}`（写 attempts_reset 审计事件；修改 plan.description **不再**自动归零）。`max_attempts=0` 表示不限。

---

## §5 状态机全章

何时查这章：任何状态流转报错、需要确认某转换合法性、裁决前查门禁时。

### 5.1 七态全图

```text
pending → ready → running → passed
                      ↘ failed → pending (retry, attempts+1)
                      ↘ pending (reclaim 死认领回收, attempts 不变)
        passed → blocked / cancelled
        blocked → ready / failed / cancelled
        any state → cancelled（终态可重开但阻塞下游门禁——不要随手 cancel）
        cancelled → pending (重开, attempts 保留〔已校：见 §12-4〕)
```

关键转换：

| 转换 | 含义 | 记录 |
|------|------|------|
| `ready → running` | **claim**（必须带 claim_by；锁内原子，并发只有一个赢） | assigned_to + started_at |
| `running → passed` | 完成（受硬规则 3 约束） | completed_at |
| `running → failed` | 失败 | completed_at |
| `running → pending` | **reclaim 回收死认领** | 清空 assigned_to，notes 附记录 |
| `failed → pending` | 重试；`attempts ≥ max_attempts(>0)` 拦截 | attempts +1 |
| `passed → blocked / cancelled` | 验收后挂起或终止（详见 allowed_transitions 直读） | — |
| `blocked → ready/failed/cancelled` | 解除阻塞 | — |
| `cancelled → pending` | 重开（attempts **保留**；已达上限的重开需人类 CLI `--force`）〔已校：§12-4〕 | — |

MCP 各节点类型的合法转换可用 `graph_get_node` 的 `allowed_transitions` 字段直读；`ready_gate` 直读前置是否满足。

### 5.2 三条硬规则（全文）

**规则 1 · ready 门禁**：`pending → ready` 与 `ready → running` 校验所有门控入边（depends_on / validates / fan_in / fan_out）的前驱必须全部 passed。不满足时报错点名前驱（如 `Node b 前置未满足: [a(pending, via depends_on)]`）——这是保护不是 bug，修正依赖顺序。`--force` 仅人类运维（CLI 通道；MCP 一律协议级拒绝），使用即写 force_override 审计。

**规则 2 · max_attempts**：`attempts ≥ max_attempts(>0)` 后 `failed → pending` 被拦截，提示人工介入。重置必须显式：CLI `--reset-attempts` / MCP `reset_attempts:true`（写审计事件）；改 plan.description 不自动重置。max_attempts=0 表示不限重试。

**规则 3 · passed 硬门禁**：`running → passed` 由核心层强制校验三项：
1. execution_report.summary 非空（无报告标 passed 直接拒绝）；
2. 无 `verification.verdict: failed` 裁决；
3. 有 checkpoints 时全部 passed/skipped（failed 或未完成都拒绝）。
任一不满足的报错与修法见 §9。

### 5.3 子状态机与例外

- **checkpoint 状态机**：`pending → running|passed|failed|skipped`；`running → passed|failed`；`passed|failed|skipped → pending`（重开）。同状态重复上报幂等成功
- **ADR 私有状态机**：`proposed → accepted → superseded`；supersede 必须先设接替者（CLI `--by` 一步 / MCP 两步，§2.4）；accept/supersede 归裁决方
- **知识顶点豁免**：context 顶点无状态，任何状态变更一律拒绝；改内容用 `graph_update_node`
- 完成判定口径：统计"全部 task 节点 passed"不含知识顶点（context/adr 永不进调度桶）

---

## §6 工具总表

何时查这章：拼写参数、找某能力在哪一层、核对工具是否存在时。**绝不发明工具名/参数**；以下两表经 v0.6.0 CLI `--help` 与 MCP 工具清单实测。行尾〔已校〕表示与旧版 reference 文档不一致、以实测为准。

### 6.1 CLI 子命令表（27 个入口〔已校〕，旧档记 20–21）

几乎所有子命令支持全局选项 `--graph <名>`（缺省按环境变量 SUPER_PLUMBER_GRAPH > `.graph/active` > default 解析）。

| 命令 | 用途 | 关键参数 |
|------|------|---------|
| `init` / `i` | 初始化图 / 旧仓库迁移 | `[name]`（新仓库必填）、`-l <label>`、`-f/--force` |
| `create-node` / `cn` | 建节点（可带全压缩包） | `-i -l -t --level --priority --context --assigned-to --plan-desc --dod ×N`〔已校：无 --max-attempts、新增 --priority/--context〕 |
| `get-node` / `gn` | 读节点全文+合法转换+门禁 | `-i --json --neighbors up/down/none` |
| `add-edge` / `ae` | 建边（校验端点存在） | `-i -s -t --type --rel-kind --contract` |
| `status` / `s` | 图状态总览 | `--json` |
| `export` / `x` | 导出（Mermaid/领域文档） | `--mermaid --docs --adr-dir --ctx-dir -o`〔已校：--docs 及目录参数〕 |
| `serve` / `sv` | Web UI 预览 | `-p`（默认 8934）`--no-open` |
| `delete-node` / `dn` | 软删除节点 | `-i --cascade` |
| `delete-edge` / `de` | 软删除边 | `-i` |
| `validate` / `v` | 结构完整性校验 | `--json` |
| `rebuild` / `rb` | 重建 index 派生索引 | — |
| `update-status` / `us` | 状态流转（门禁+次数拦截） | `-i -s --claim-by --force`(仅人类) |
| `reclaim` / `rc` | 回收死认领 running→pending | `-i --by` |
| `update-node` / `un` | 编辑节点内容全家桶 | 见 §2.3 参数清单 |
| `update-graph` / `ug` | 编辑图级字段 | 见 §2.2 |
| `next` / `n` | 调度五桶（ready/ready_eligible/blocked/running/stale_running） | `--stale-ms`（默认1800000）`--json` |
| `verdict` / `vd` | 记录裁决结论到 verification | `-i --verdict pending/passed/failed --note` |
| `snapshot` / `sp` | 版本快照（自动导出领域文档） | `-m --git` |
| `snapshots` / `sps` | 快照列表 | `--json` |
| `diff` / `d` | 拓扑差异对比 | `--from --to --json` |
| `rollback` / `rol` | 回滚快照（必须确认） | `<snapshot-id> --confirm --design-only` |
| `events` | 审计事件日志 | `-n/--node -k/--kind --last`(默认50) `--json` |
| `adr` | ADR 组命令 | `create(-t -d -b -o -w -c)` / `accept -i` / `supersede -i --by` / `list -s` |
| `switch` / `sw` | 切换工作区默认图（写 .graph/active） | `[name]`〔已校：新增〕 |
| `list` / `ls` | 列举工作区全部图/详情 | `[name] --json`〔已校：新增〕 |
| `rename-graph` / `rg` | 重命名图（仅人类通道） | `-o <旧名> -n <新名>`〔已校：新增〕 |
| `delete-graph` / `dg` | 删图（软删除至 .trash，仅人类通道） | `-i <图名> --confirm`〔已校：新增〕 |

### 6.2 MCP 工具表（24 个〔已校〕，旧档记 19）

| 分组 | 工具 | 用途 | 注意 |
|------|------|------|------|
| 调度 | `graph_get_next_actions` | 规划循环首选，一次返回五桶 | stale_ms 默认 30 分钟；桶上限 limit=100；支持 assigned_to 过滤 |
| 读 | `graph_get_node` | 节点全文+allowed_transitions+checkpoint_aggregate+ready_gate(+governing_adrs) | include_neighbors up/down |
| 读 | `graph_get_graph` | 图拓扑+邻接（索引缓存） | 默认 summary 紧凑模式；full 用 offset/limit 分页（页默认200） |
| 读 | `graph_traverse` | DFS 遍历邻居 | direction/max_depth/max_nodes；返回 nodes+truncated |
| 读 | `graph_search` | 按 query/status/type/assigned_to/level 过滤 | 返回 total+nodes（紧凑字段） |
| 写·设计 | `graph_create_node` | 建节点（一次带 plan/DoD/checkpoints） | 重复 id 报错绝不覆盖 |
| 写·设计 | `graph_batch_create` | 批量建 nodes+edges（先全量预校验） | 每批 ≤200 节点 |
| 写·设计 | `graph_add_edge` | 建边 | type/rel_kind/contract |
| 写·设计 | `graph_update_node` | 编辑 plan/DoD/checkpoints/归属/boundary/glossary 等 | reset_attempts 显式传 true |
| 写·设计 | `graph_update_graph` | 图级字段编辑 | 同 §2.2 六字段 |
| 写·设计 | `graph_create_adr` | 创建 ADR（自动编号+proposed） | 〔已校：新增〕孤儿 ADR 会被警告 |
| 写·设计 | `graph_delete_node` | 软删除节点 | cascade:true 连边删 |
| 写·设计 | `graph_delete_edge` | 软删除边 | — |
| 写·执行 | `graph_update_node_status` | 状态流转；claim=status running+claim_by | force 一律协议拒绝 |
| 写·执行 | `graph_update_checkpoint` | 上报单个 checkpoint | 幂等；完成即报 |
| 写·执行 | `graph_update_execution_report` | 交接单（artifacts 存在性核验）+ 可选 verification | verdict 写在转 passed 前 |
| 写·执行 | `graph_reclaim_node` | 回收死认领 running→pending | 只对 running 生效 |
| 版本 | `graph_snapshot` / `graph_diff` / `graph_rollback` | 快照/差异/回滚 | rollback 必须 confirm:true |
| 图管理 | `graph_validate` | 结构校验 | 〔已校：新增〕 |
| 图管理 | `graph_events` | 审计日志查询（kind/node/last 过滤） | 〔已校：新增〕 |
| 图管理 | `graph_switch` | 切换本 MCP 进程的目标图（类 git branch） | 〔已校：新增〕不动 .graph/active，进程重启回落 |
| 图管理 | `graph_list_graphs` | 列举工作区全部图/详情 | 〔已校：新增〕init/trash/export --docs 刻意无 MCP 通道，走 CLI |

---

## §7 脚本章：sp-\*.mjs

何时查这章：所在环境没有 MCP 客户端（纯 bash agent），需要 claim/report/流转时。

**路径布局（两处都要知道）**：

- **未来正本位**：`integrations/shared/sp-scripts/*.mjs` —— 构建期由 `scripts/sync-integrations.mjs` 把一份正本拷贝三方（sha256 一致）
- **当前运行地**：`.pi/skills/plumber-execute/scripts/`（全局安装版 `~/.pi/agent/skills/plumber-execute/scripts/`）——今天从这里运行；正本位接线完成后会随同步分发覆盖
- 全部是核心引擎薄包装（`sp-core.mjs` 统一加载公开 API，先项目本地后 npm root -g），跨平台；状态机/门禁/次数上限都在核心层强制，脚本不能绕过

| 文件 | 用法 | 说明 |
|------|------|------|
| `sp-core.mjs` | （被其余脚本 import，不单独调用） | 共享加载器：定位 `@lukawi/super-plumber/core` |
| `sp-claim.mjs` | `node sp-claim.mjs <node_id> <claim_by>` | ready→running 原子认领；非 ready 被核心拦截 |
| `sp-update-status.mjs` | `node sp-update-status.mjs <node_id> <status> [--force]` | 一般流转（含门禁校验） |
| `sp-checkpoint.mjs` | `node sp-checkpoint.mjs <node_id> <cp_id> <status>` | 上报一个 checkpoint（幂等） |
| `sp-report.mjs` | `node sp-report.mjs <node_id> <summary> [artifacts.csv] [blockers.csv] [notes]` | 提交 execution_report |
| `sp-get-node.mjs` | `node sp-get-node.mjs <node_id>` | 输出节点完整 JSON |
| `sp-traverse.mjs` | `node sp-traverse.mjs <node_id> [downstream/upstream/both] [max_depth=3]` | 从指定节点遍历邻居 |

设计侧体检脚本 `sp-check-design.mjs` 住在 `.pi/skills/plumber-design/scripts/`（用法见 §2.6）。装不上核心时先 `npm install -g @lukawi/super-plumber`。

---

## §8 三层验收实操

何时查这章：宣布"全部做完"之前；或任何一层不过需要定位问题时。框架铁律（成果层不信报告信 artifact）在 skill，这里是逐层手法。

| 层 | 命令手法 | 通过标准 |
|----|---------|---------|
| ① 状态层 | `graph status` 或 `graph next --json`（看残留桶） | 所有 **task 节点** passed；无 failed/blocked/pending 残留（entry/exit 为图级定义不执行属正常；知识顶点不计入；若有 cancelled 须用户知情） |
| ② 结构层 | `graph validate` | 0 error（执行期可能改过图，收尾必须重验；0 warning 更佳） |
| ③ 成果层 | 逐条对照 exit 的 acceptance_criteria：`ls`/读文件核实 artifact **真实存在且内容匹配**（可抽查 execution_report.artifacts 路径的存在性） | 每条标准都有可核验事实佐证，不是只读 summary 文本 |

任何一层不过 → 继续修，不宣告完成。成果层的含义：报告里写"已完成 X"但 X 文件不存在 = 未完成。

---

## §9 错误处理大表

何时查这章：看到工具报错不知道含义或下一步时。每行「报错 → 含义 → 修法」。**绝不忽略错误继续假装成功**——安静的假成功比响亮的失败更糟。

**参数与枚举**

| 报错 | 含义 | 修法 |
|------|------|------|
| `MCP error -32602: Input validation error` | 缺必填参数 | 对照 §6 表补字段 |
| `-32602 ... expected one of ...` | 非法枚举值 | 只用 §6 表内值 |
| `schema 校验失败: ...` | 手改 YAML 拼错字段 | 本就该走命令不改文件；按提示修正后 `graph validate` 定位 |
| `ENOENT ... .graph/graph.yaml` | 当前目录未 init（或 cwd 错） | `graph init` / cd 到含 .graph/ 的目录 |
| `Node X not found` / `Edge X not found` | id 不存在 | `graph_search` 核对 id |
| `already exists` | 重复 id | 换新 id，绝不覆盖 |

**状态机与认领（SKILL 常见表的工具类行并入于此）**

| 报错/行为 | 含义 | 修法 |
|-----------|------|------|
| `Invalid transition: X → Y. Allowed: [...]`（含 claim 非 ready、pending→running 一步到位） | 状态机顺序违反 | 走允许路径：先 ready 再 running；先用 graph_get_next_actions 确认 |
| `Node X 前置未满足，不能进入 ready/running: [...]` | ready 门禁（规则1）拦截 | 先完成点名的前驱；**不要试图绕过** |
| 冷启动找不到第一个节点 | 入口不在 ready 桶而在 ready_eligible | 对 eligible 节点置 ready 后再 claim |
| `force` 经 MCP 传入直接报错 | force 协议级拒绝（规则1/2/3 无 MCP 后门） | agent 不传 force；人类运维走 CLI `--force` 并接受审计 |
| `Node X already claimed by Y` | 并发认领竞争失败（原子保护） | 换一个 ready 节点，不重试同节点 |
| `Node X 已达最大重试次数` | attempts 用尽（规则2） | 人工介入；或显式 `--reset-attempts` / `{reset_attempts:true}`（写审计） |

**passed 硬门禁（规则3的三种报错）**

| 报错 | 含义 | 修法 |
|------|------|------|
| `Node X 无执行报告，不能标记 passed` | summary 为空或缺报告 | 先 graph_update_execution_report，再 passed |
| `Node X 存在未完成 checkpoint，不能标记 passed` | 有 failed/running/pending checkpoint | 补完或合理 skipped 后再 passed |
| `Node X 已有 failed 裁决，不能标记 passed` | verification.verdict=failed | 修复缺陷，重新 verdict 为 passed 后再流转 |

**ADR 与知识顶点**

| 报错 | 含义 | 修法 |
|------|------|------|
| `Invalid ADR transition: X → Y` | ADR 只有 proposed→accepted→superseded | 走合法转换；这两步归裁决方，执行/设计 agent 不做 |
| `ADR X 置 superseded 前必须设置 superseded_by` | 废弃必须带接替者 | CLI `graph adr supersede -i X --by Y` 一步；MCP 两步（§2.4） |
| `Node X 是 context 顶点：…不支持任何状态变更` | 知识顶点豁免状态机 | 别动它状态；改内容用 graph_update_node |

**生命周期辅助**

| 报错 | 含义 | 修法 |
|------|------|------|
| `Node X 当前状态为 Y，只有 running 节点可回收` | reclaim 目标不对 | 只对 stale 的 running 节点 reclaim |
| `Node X 被 N 条边引用` | 软删除会留悬挂引用 | `--cascade` 连边删，或先删边 |

**红线 STOP**：手改 YAML 绕状态机/门禁｜传 force 绕校验｜编造工具名或参数（先查 §6 表或 `--help`）｜fan_in 汇聚点未等齐上游就开工。

---

## §10 solo 机械自裁边界 + 主观判定留人清单

何时查这章：solo 模式（主线程原地扮演角色、无独立裁决方在场）需要决定"这个结论我能不能自己拍板"时。原则：**机械核算可自裁，裁量与裁决必须留人**。

### 10.1 机械可自裁（agent 独立核对即可下结论）

| 项 | 手段（全部来自本文） |
|----|---------------------|
| checkpoint 聚合核对 | `graph_get_node` 读 `checkpoint_aggregate`：全 passed / 有 failed / 部分 pending / 有 running —— 纯计数判断 |
| artifact 存在性抽查 | 对 execution_report.artifacts 逐条 `ls`/读文件核验存在性（exists 与否是客观事实） |
| 三层验收的状态层 | §8 第①层：task 节点全 passed、无残留桶，读数说话 |
| 三层验收的结构层 | §8 第②层：`graph validate` 0 error，机器判据 |
| 状态流转/幂等上报/attempts 计数 | 状态机规则机械可判（§5） |

### 10.2 必须留人（即使 solo 也停下列单呈报）

| 项 | 为什么留人 |
|----|-----------|
| DoD 主观质量裁量 | artifact "存在"之外的正确性/符合度是语义判断，不是计数；自查合格也要把裁量点和证据列给人复核 |
| 一切 ADR accept / supersede | 提议/裁决分离是硬规则；执行与设计 agent 永远只停在 proposed |
| 用户审核 gate（批准执行与否） | S12 硬性 gate：批准是人给的，agent 绝不自批 |
| max_attempts 耗尽后的处置 / force 类越权动作 | 预算追加与越权是人类运维专属通道 |

solo 合同义务一句话：机械项自己核对并在 notes 留证据；主观项汇总成清单呈人拍板，不得代签。

---

## §11 手册寻址约定

何时查这章：角色提示词/skill/派单里出现"Read 手册 §N"时，按环境取正确路径。

| 环境 | 引用写法 | 解析基准 |
|------|---------|---------|
| pi | `Read integrations/shared/manual.md §<章节>` | 相对**仓库根** |
| claude / zcode 插件包 | `Read ./manual.md §<章节>` | 相对**插件包根**（Skill base-dir / plugin root 可解析） |

- 手册唯一正本在 `integrations/shared/manual.md`；插件包内的是构建期同步的正本拷贝（内容一致），pi 侧不放副本以防漂移
- **信息优先级**：任务派单 ＞ 角色提示词 / 本手册 ＞ skill 正文（冲突时上位胜出；本手册专管操作语法，不管角色裁量）

---

## §12 文档-实现漂移修正常记

何时查这章：读到旧教程/SKILL 老话与实际行为不符、怀疑文档过期时。本次重写已修正的三处，常记防回潮：

1. **entry/exit 是图级字段，不是节点文件**。旧 DR1 教 `create-node -i entry/-i exit` 建任务节点 + 手写 graph.yaml——均过时。正确做法只有一条：`graph update-graph --entry-desc … --exit-desc … --add-criteria …`（doctor 的 E1-E3 检的就是这些图级字段；其报错文案里"graph.yaml 手写"字样也按此理解）。
2. **doctor 的 W2/W3 以代码为准**：W2 = 无出边（不通向下游），W3 = 无入边（游离节点）。旧文档写成"W2 边密度 / W3 L2 无父"恰好颠倒，勿再抄旧表。
3. **可达性语义 =「无入边根 → 无出边汇」锚定**。唯一根 = 主干起点、唯一汇 = 收口（E6/E7 沿此判定，多根多汇总 W6 提示收敛）。旧的"entry 节点 → exit 节点双向可达"叙事已被取代——没有 entry/exit 文件节点这回事。
4. **cancelled → pending 重开时 attempts 保留，不是归零**。引擎刻意如此：归零会让 fail→cancel→reopen 循环每轮绕过重试预算；已达 max_attempts 的重开被拦，须人类走 CLI `--force` 通道。旧 reference.md 写"attempts 归零"系继承错误，勿再抄。

发现新的文档-实现漂移时：以 `--help` 实测与代码为准修本手册，再在 issue log 登记——手册是唯一正本，改一处即全网生效。
