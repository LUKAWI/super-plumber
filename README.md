# Super Plumber

> 把复杂的软件交付变成一张可以设计、执行、检查和回溯的工作流图。

[![npm version](https://img.shields.io/npm/v/@lukawi/super-plumber)](https://www.npmjs.com/package/@lukawi/super-plumber)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-LUKAWI%2Fsuper--plumber-black)](https://github.com/LUKAWI/super-plumber)

Super Plumber 是一个面向开发者、自动化工具和 coding agent 的工作流编排工具。它把一份容易被遗漏的任务清单，转换成带有依赖关系、执行状态、验收标准和交接记录的任务图。

你可以只用 CLI 管理一张图，也可以接入 MCP，让 agent 读取图、认领节点、逐步上报进度；需要长期观察时，再打开只读的 Web UI。所有核心数据都是 YAML 文件，能够直接用 Git 查看、评审、分支和恢复。

English: [README.en.md](README.en.md) · npm: [@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber) · 文档手册：[integrations/src/manual.md](integrations/src/manual.md)

## 它能解决什么问题？

很多开发任务失败，并不是因为没人写代码，而是因为工作过程缺少这些信息：

- 哪些事情必须先做，哪些事情可以并行？
- 什么结果才算完成，而不是“代码已经改过了”？
- 一个 agent 换手后，另一个 agent 能否继续？
- 设计决定、接口契约和失败原因在哪里可查？
- 任务卡住时，是依赖没完成、执行者失联，还是方案本身需要改变？

Super Plumber 把这些信息放到同一个可校验的结构里：

~~~text
需求与验收目标
        │
        ▼
entry → 澄清范围 → 实现 → 测试与验证 → exit
           │          │
           └─ depends_on / validates / fan_out / fan_in
                          │
                   交接单 + 审计事件 + Git diff
~~~

图不是项目管理界面的另一种画法。图中的依赖会参与调度和门禁，节点中的完成标准会参与验收，状态变更会留下审计记录。

## 什么时候适合使用？

| 场景 | 你可以怎样使用 Super Plumber |
| --- | --- |
| 新功能开发 | 把需求拆成澄清、实现、测试、发布等节点，明确先后顺序和每一步的完成标准。 |
| 重构或迁移 | 用依赖边表达迁移顺序，用验证节点确认旧路径、新路径和回滚方案。 |
| 多人或多 agent 协作 | 每个人认领独立节点，交付摘要和真实产物路径，后来者按图继续。 |
| 研究驱动的方案 | 把研究结果、技术决策和实现分开；关键未知会影响计划时，用 program 工作流逐步解雾。 |
| 发布和验收 | 用状态机、检查点、verdict 和导出文档记录从“可运行”到“可交付”的证据链。 |
| 长时间观察 | 用 Web UI 观察 running、blocked、failed 和 ready 节点，必要时打开节点详情或快照差异。 |

如果只是查一个问题、改一行配置或运行一次命令，直接处理通常更快；不需要为了一个小动作建立完整的任务图。

## 产品特色

| 特色 | 你得到什么 |
| --- | --- |
| 图驱动的执行顺序 | 依赖关系直接参与调度，不需要靠聊天记录记住先后。 |
| 有证据的完成状态 | 每个节点都有完成标准、检查点和交接单，完成结论可以复核。 |
| 适合换手和并行 | 每个执行者领取独立节点，交付真实产物路径，下一位可以从图上继续。 |
| 三种访问方式 | CLI 适合人类操作，MCP 适合 agent，Web UI 适合只读观察；三者读取同一份图。 |
| 文件优先 | YAML 可读、可 diff、可放进 Git，不依赖数据库或云端账号。 |
| 领域信息和工作信息放在一起 | context、术语表和 ADR 与任务关联，决定不会散落在项目之外。 |

## 核心概念

### 一张图

一张图有一个入口 entry 和一个出口 exit：

- entry 描述要解决的需求；
- exit 描述最终交付物和验收标准；
- 节点表示可执行的工作或领域知识；
- 边表示依赖、验证、并行、回退或领域关系。

图的内容存放在 .graph/ 下。一个工作区可以有多张命名图，例如 feature-auth、data-migration 和 release-1-0。

### 一个节点

一个 task 节点通常包含：

| 字段 | 作用 |
| --- | --- |
| id / label | 稳定标识和人类可读名称。 |
| plan | 做什么、输入来自哪里、结果交给谁。 |
| definition_of_done | 可观察、可复核的完成标准。 |
| checkpoints | 执行期间逐步上报的检查点。 |
| execution_report | 交接摘要、产物路径、阻塞信息和验收结论。 |
| status | pending、ready、running、passed 等状态机状态。 |

节点像一个小型交付包：下一位执行者不需要从聊天记录里猜上下文。

### 两类边

参与拓扑排序和 ready 门禁的边：

| 边 | 含义 |
| --- | --- |
| depends_on | B 必须等待 A 完成。 |
| validates | 一个节点验证另一个节点的结果。 |
| fan_out | 一个节点完成后，多个下游节点可以并行。 |
| fan_in | 多个上游完成后，汇聚节点才可以开始。 |

用于运行时表达或领域建模的边：

| 边 | 含义 |
| --- | --- |
| shares_context | 传递共享上下文，但不构成 ready 门禁。 |
| fallback | 源节点耗尽重试预算时，列出替代路线。 |
| iterates | 标记需要反复优化的关系。 |
| decides | ADR 对任务或领域顶点的管辖关系。 |
| relates | bounded context 之间的领域关系。 |

### 状态机

任务节点常见路径是：

~~~text
pending → ready → running → passed
                         └→ failed → pending   （重试）
running → pending                              （回收失联认领）
任意状态 → cancelled
~~~

有三条重要规则：

1. ready 需要满足所有门控前驱；
2. failed 重试受 max_attempts 约束；
3. running 不能直接“口头完成”：必须有 execution report，检查点必须聚合，且不能有 failed verdict。

context 是无状态的领域顶点，ADR 使用 proposed → accepted → superseded 三态机。ADR 的接受和废弃属于治理裁决，不会被普通执行步骤静默完成。

## 五分钟快速开始

### 1. 安装

前置要求：Node.js 20 或更高版本，以及 npm。

~~~bash
npm install -g @lukawi/super-plumber
graph --version
~~~

如果你要运行当前仓库中的源码版本：

~~~bash
git clone https://github.com/LUKAWI/super-plumber
cd super-plumber
npm ci
npm run build
npm --prefix web-ui ci
npm --prefix web-ui run build
npm link
~~~

### 2. 创建一张图

下面用“给报告增加 CSV 导出”作为例子：

~~~bash
mkdir csv-export-demo
cd csv-export-demo

graph init csv-export -l "报告 CSV 导出"
graph update-graph \
  --entry-desc "为报告增加可下载的 CSV 导出" \
  --exit-desc "用户可以下载正确编码的 CSV，测试和验收证据齐全" \
  --add-criteria "导出的列和筛选结果与报告一致" \
  --add-criteria "浏览器下载和 API 调用均有测试"
~~~

### 3. 把工作拆成节点

~~~bash
graph create-node -i clarify -l "澄清导出契约" -t task --level 1 \
  --plan-desc "确定列顺序、编码、日期格式和空值规则" \
  --dod "导出字段和示例文件已确定"

graph create-node -i implement -l "实现 CSV 导出" -t task --level 1 \
  --plan-desc "实现服务端导出和下载响应" \
  --dod "API 能返回可下载的 CSV" \
  --dod "错误输入有明确响应"

graph create-node -i verify -l "验证导出结果" -t task --level 1 \
  --plan-desc "覆盖字段、编码、筛选和下载行为" \
  --dod "自动化测试通过" \
  --dod "真实导出文件可复核"

graph add-edge -i e1 -s clarify -t implement --type depends_on
graph add-edge -i e2 -s implement -t verify --type depends_on
~~~

### 4. 检查图并查看下一步

~~~bash
graph validate
graph status
graph next
~~~

validate 会检查 schema、节点和边的引用、拓扑关系以及循环。next 会把可认领、等待依赖、执行中和疑似卡住的节点分桶显示；脚本或 agent 可以使用 JSON 输出：

~~~bash
graph next --json
~~~

刚创建的节点通常会出现在 ready_eligible。它表示前置条件已经满足，可以进入待执行状态，但还没有被执行者认领：

~~~bash
graph update-status -i clarify -s ready
~~~

之后由执行者通过 MCP 或执行脚本把节点原子认领为 running。

### 5. 打开可视化面板

~~~bash
graph serve
~~~

默认打开 http://localhost:8934。CI、远程终端或无头环境使用：

~~~bash
graph serve --no-open
~~~

## 一次完整交付怎么进行？

设计阶段完成图和验收标准后，执行阶段按下面的顺序推进：

### 认领

先从 next 找到 ready 节点，再原子认领。并发情况下只有一个执行者会成功：

~~~text
graph_update_node_status({
  id: "clarify",
  status: "running",
  claim_by: "backend-agent"
})
~~~

也可以在有执行脚本的环境中使用：

~~~bash
node .pi/skills/plumber-execute/scripts/sp.mjs claim clarify backend-agent
~~~

### 上报检查点

一个节点有多个步骤时，每完成一步就上报一次：

~~~text
graph_update_checkpoint({
  node_id: "implement",
  checkpoint_id: "cp1",
  status: "passed"
})
~~~

### 提交交接单

交接单应指向真实产物，而不是只写“已完成”：

~~~text
graph_update_execution_report({
  node_id: "implement",
  summary: "CSV 导出接口已完成并接入报告筛选",
  artifacts: [
    "src/export/csv.ts",
    "tests/export/csv.test.ts",
    "tmp/examples/report.csv"
  ],
  blockers: [],
  notes: "UTF-8 with BOM，日期统一为 ISO 格式"
})
~~~

没有 MCP 客户端时，可用脚本提交：

~~~bash
node .pi/skills/plumber-execute/scripts/sp.mjs report \
  implement \
  "CSV 导出接口已完成" \
  "src/export/csv.ts,tests/export/csv.test.ts" \
  "" \
  "UTF-8 with BOM；日期为 ISO 格式"
~~~

### 验收与完成

交付者提交报告后，由裁决者或人类根据完成标准检查证据，记录 verdict，再将节点置为 passed。图会拒绝没有报告、检查点未完成或已有失败裁决的 passed 状态。

例如，裁决通过后：

~~~bash
graph verdict -i implement --verdict passed --note "CSV 文件和自动化测试已核对"
graph update-status -i implement -s passed
~~~

## 选择工作流档位

先问两个问题：

1. 是否存在会改变交付范围、主要方案或关键依赖的未知？
2. 如果没有，一个会话是否可以完成并验收？

| 档位 | 适合情况 | 典型做法 |
| --- | --- | --- |
| quick | 目标清晰，一次会话可以完成 | 小图或单节点；可以省略复杂的设计审核。 |
| standard | 目标清晰，但需要多个节点、会话或执行者 | 完整设计、审核、执行和验收流程。 |
| program | 关键未知会让当前计划失效 | 先记录未知和毕业条件，再用研究节点取得证据，逐步形成可信计划。 |

可以在初始化时写入档位：

~~~bash
graph init csv-export -l "报告 CSV 导出" --class standard
~~~

使用插件时，/plumber 只负责判断是否需要 Super Plumber、选择档位、定位图和给出下一入口；它不会自动建图、认领节点或启动执行。需要直接工作时，使用 /plumber-design、/plumber-execute 或 /plumber-join。

## 多图工作区

一个项目可以同时维护多张图：

~~~bash
graph init feature-auth -l "认证功能"
graph init data-migration -l "数据迁移"
graph list
graph switch feature-auth
graph status
~~~

需要一次命令访问指定图时，使用 --graph：

~~~bash
graph status --graph data-migration
graph next --graph feature-auth --json
~~~

目标图解析顺序是显式 --graph、SUPER_PLUMBER_GRAPH、工作区 active、default。切图和读图不会悄悄把命令指向另一张图；非法图名会直接报错并列出可用图。

## Web UI：只读的拓扑观察面板

graph serve 提供一个本地 Web UI。它读取同一份 .graph 数据，不承担写入状态的职责，因此适合在开发过程中长时间打开：

- 按状态、层级和关键词过滤节点；
- 查看工作流图或领域图；
- 点开节点、边、context 和 ADR 的详细信息；
- 查看 running 节点和依赖关系；
- 比较快照，识别新增、删除和修改；
- 断线后自动重连，支持键盘导航和 reduced-motion。

画布上的颜色表示状态，界面上的写操作仍通过 CLI 或 MCP 完成。你可以让团队成员只打开面板查看进度，而不授予他们修改图状态的权限。

## MCP：让客户端直接操作工作流

启动内置 MCP Server：

~~~bash
graph-mcp
~~~

通用 MCP 配置示例：

~~~json
{
  "mcpServers": {
    "super-plumber": {
      "command": "npx",
      "args": ["-y", "@lukawi/super-plumber", "graph-mcp"]
    }
  }
}
~~~

如果使用当前源码而不是已发布 npm 包：

~~~json
{
  "mcpServers": {
    "super-plumber": {
      "command": "node",
      "args": ["/absolute/path/to/super-plumber/dist/mcp/server.js"]
    }
  }
}
~~~

MCP 工具覆盖四类操作：

| 类别 | 典型操作 |
| --- | --- |
| 读取与调度 | 读取节点、遍历依赖、搜索图、查看 next 和多图前沿。 |
| 设计 | 建图、建节点、建边、设置 entry/exit、创建 ADR。 |
| 执行 | 原子 claim、checkpoint、execution report、回收失联认领。 |
| 验收与版本 | verdict、validate、事件日志、snapshot、diff、rollback。 |

读取接口支持分页和紧凑模式，适合大图；所有参数经过 schema 校验，错误会返回可解析的错误信息。

## Agent 工具接入

仓库提供几种工作方式，核心图数据保持一致：

| 接入方式 | 用法 |
| --- | --- |
| CLI | 人类直接使用 graph 命令设计和检查图。 |
| MCP | Claude、Codex、OpenCode 等支持 MCP 的客户端调用 graph_* 工具。 |
| pi | 把仓库根目录的 .pi/ 复制到目标项目，使用 skills 和 sp.mjs。 |
| Claude Code / ZCode | 安装 integrations/plugin/ 中的插件，使用 plumber-design、plumber-execute 等入口。 |
| Codex | 通过官方插件市场安装；插件包内包含 graph-mcp 和 6 个 skills。 |

插件安装：

~~~text
/plugin marketplace add lukawi/super-plumber
~~~

Codex 插件市场：

~~~bash
codex plugin marketplace add lukawi/super-plumber
codex plugin add super-plumber --marketplace lukawi-super-plumber
~~~

主要入口的分工：

- plumber-design：把需求拆成图，填写依赖和验收标准，并在执行前请求审核；
- plumber-execute：按依赖顺序认领节点、上报检查点和交接单；
- plumber-join：在缺少上下文时进入已有图，确定下一步后交给执行阶段；
- plumber：只做只读路由提示；
- plumber-tdd：节点明确要求测试先行时，约定 seam 并执行红绿循环；
- plumber-review：由第二双眼复核节点产物。

## 领域建模：context 和 ADR

除了任务节点，图还可以记录两个领域对象：

- bounded context：记录边界和术语表，导出后成为领域文档；
- ADR：记录决策、背景、备选方案、理由和后果。

创建 ADR：

~~~bash
graph adr create \
  --title "导出服务使用 UTF-8 with BOM" \
  --decision "统一生成带 BOM 的 UTF-8 CSV"
~~~

导出领域文档：

~~~bash
graph export --docs
~~~

多图工作区会按图名生成 docs/<图名>/adr、contexts、CONTEXT-MAP.md 和 DECISIONS.md。图是事实来源，Markdown 是可阅读、可提交的视图。

## Git 和文件存储

图数据是普通文件：

~~~text
.graph/
├── active                 # 工作区默认图
├── workspace-events.jsonl
└── csv-export/
    ├── graph.yaml
    ├── nodes/*.yaml
    ├── edges/*.yaml
    ├── events.jsonl
    ├── snapshots/
    └── index/
~~~

因此你可以：

- 用 git diff 评审一次图变更；
- 用分支隔离不同方案；
- 用 snapshot、diff 和 rollback 对比或恢复设计；
- 在 code review 中同时评审代码和交付计划。

index/ 是可重建的派生数据；节点和边 YAML、graph.yaml 与事件日志才是需要重点管理的内容。本仓库的 .gitignore 忽略运行时 .graph，实际项目是否提交它由团队的审计和恢复要求决定。

## CLI 速查

所有命令都有 --help。下面按用途列出完整命令面：

| 类别 | 命令 |
| --- | --- |
| 工作区和图 | init、switch、list、rename-graph、delete-graph、serve |
| 设计 | create-node、get-node、update-node、delete-node、add-edge、delete-edge、update-graph、approve、graduate-fog、adr |
| 执行 | next、survey、update-status、reclaim、verdict |
| 检查和版本 | status、validate、rebuild、export、snapshot、snapshots、diff、rollback、events |

常用命令：

~~~bash
graph create-node --help
graph get-node -i implement --json
graph status --json
graph events --node implement --last 20
graph snapshot -m "CSV export before release"
graph diff --json
~~~

## 常见问题

### 为什么 graph init 要求图名？

图名应该描述内容或范围，例如 feature-auth、billing-migration。命名图能让同一个工作区同时维护多个主题，也能避免 default 这种无法说明用途的图名。

### 为什么不能直接把 pending 改成 running？

running 表示节点已经被某个执行者认领。先进入 ready，系统才能检查前置依赖；再进入 running，系统才会记录执行者和开始时间。

### 为什么 passed 被拒绝？

检查节点是否已经有非空 execution_report，所有 checkpoint 是否为 passed 或 skipped，以及 verification 是否存在 failed verdict。执行阶段不要跳过交接单。

### MCP 升级后行为没有变化

MCP Server 是常驻进程。升级 npm 包后重启客户端或重新连接 MCP Server，才能加载新版本。

### 页面是空的

确认当前目录或 MCP workspace root 中存在 .graph，并检查是否切到了正确的图：

~~~bash
graph list
graph status --graph <name>
~~~

### 图校验出现警告

warning 和 error 的含义不同。先运行 graph validate --json，按文件和节点定位；悬空引用、非法边端点和循环通常需要立即修复，术语重复或缺少契约可能只是需要确认的提醒。

## 开发和测试

~~~bash
git clone https://github.com/LUKAWI/super-plumber
cd super-plumber
npm ci
npm run typecheck
npm run build
npm test

npm --prefix web-ui ci
npm --prefix web-ui run typecheck
npm --prefix web-ui run build
npm --prefix web-ui test
~~~

集成资产的唯一正本在 integrations/src/。如果修改了 skill、脚本、命令或手册，运行：

~~~bash
node scripts/sync-integrations.mjs
node scripts/sync-integrations.mjs --check
node dist/cli/index.js export --docs --check
~~~

## 项目状态

当前源码包含 CLI、MCP、Web UI、纯文件存储、多图工作区、领域 context/ADR、快照和审计日志。稳定协议约定见手册中的 1.0.0 协议冻结章节。

~~~text
Tests: 876（后端）+ 122（前端）⚠️ | CLI: 30 命令 | MCP: 27 工具 | 状态机: 7 态 + ready 门禁 + max_attempts + passed 硬门禁 | 边类型: 9 种 | 存储: YAML + Git
~~~

- GitHub：[LUKAWI/super-plumber](https://github.com/LUKAWI/super-plumber)
- npm：[@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber)
- 操作手册：[integrations/src/manual.md](integrations/src/manual.md)
- 领域文档：[docs/roadmap-to-1-0-0/](docs/roadmap-to-1-0-0/)

## License

MIT © 2026 Super Plumber contributors
