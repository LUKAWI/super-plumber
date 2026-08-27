# 集成目录结构设计稿 — multitool-refactor v0.6.1

> 本文是 `l1_design_final` 的交付物二。三套集成的目标布局、机械共享件正本位置、
> 双通道接线与同步脚本映射。评审通过后由后续节点按图施工；本文本身即"三类文件在三包落位"的权威依据。

> ⚠️ **2026-08-27 用户裁决（adr_0002，接替 adr_0001）——插件包合二为一**：只保留单一插件包
> `integrations/plugin/`（清单 `.claude-plugin/plugin.json` 承载，插件命名 `super-plumber`，无渠道后缀），
> marketplace.json 收敛为单条目；zcode 经 `.claude-plugin` 兼容回退装载同一份清单（example-plugin
> 官方样板明文背书）。**原 §1 双包布局（`integrations/claude-code/`、`integrations/zcode-plugin/`）
> 整体作废**，§2 对等原则、§3 拷贝目标、§5 骨架中涉及双包的表述一并 superseded——现网布局以仓库
> 实际目录与 adr_0002 为准；pi 渠道 `.pi/` 直用不变。下文原稿保留作设计过程记录。

---

## 1. 仓库目标布局（全景）

```text
repo/
├─ .pi/                                  # 【pi 集成】现状维持，原地演进（v0.6.1 内容瘦身）
│  ├─ agents/sp-designer.md              #   瘦身版提示词（语法表→手册指针）
│  ├─ agents/super-mario.md              #   同上
│  ├─ skills/plumber-design/
│  │  ├─ SKILL.md                        #   编排剧本化重写（含派单模板+solo 分支）
│  │  └─ scripts/sp-check-design.mjs     #   体检脚本保留（本次已修 v0.5 语义）
│  └─ skills/plumber-execute/
│     ├─ SKILL.md                        #   同上收缩
│     └─ scripts/sp-*.mjs ×7             #   机械共享件，见 §3 同步映射
│
├─ .claude-plugin/marketplace.json       # 【通道①·市场清单】仓库根，收录三件集成
│
├─ integrations/
│  ├─ shared/                            # 【ctx_shared 正本区】
│  │  ├─ manual.md                       #   Operations 手册唯一正本
│  │  ├─ commands/plumber-design.md      #   斜杠命令正本
│  │  ├─ commands/plumber-execute.md
│  │  └─ sp-scripts/*.mjs                #   执行脚本正本（.pi/scripts 与两插件均为拷贝）
│  ├─ claude-code/                       # 【claude 插件包】plugin root
│  │  ├─ .claude-plugin/plugin.json      #   name=super-plumber, version=0.6.1
│  │  ├─ agents/sp-designer.md           #   格式适配自 .pi 终稿
│  │  ├─ agents/super-mario.md
│  │  ├─ skills/plumber-design/SKILL.md  #   编排剧本 + 引用 ./manual.md
│  │  ├─ skills/plumber-execute/SKILL.md
│  │  ├─ commands/plumber-design.md      #   ← 正本拷贝
│  │  ├─ commands/plumber-execute.md
│  │  ├─ manual.md                       #   ← 正本拷贝
│  │  └─ .mcp.json                       #   graph-mcp: npx -y @lukawi/super-plumber
│  └─ zcode-plugin/                      # 【zcode 插件包】与 claude 包同构
│     ├─ .zcode-plugin/plugin.json       #   实测 example-plugin：MCP 由根级 .mcp.json 承载（双 manifest 逐字节相同、均无 mcpServers），两包同构
│     ├─ skills/plumber-design/SKILL.md
│     ├─ skills/plumber-execute/SKILL.md
│     ├─ commands/plumber-design.md
│     ├─ commands/plumber-execute.md
│     ├─ manual.md
│     └─ agents/…                        # ⚠️ 路由待 l2_zcode_probe 实测后定稿(§4)
│
├─ docs/multitool-v061/                  # 本设计稿+归属清单+执行期 issue log
├─ scripts/sync-integrations.mjs         # 共享件构建期同步（§3 映射的执行者）
└─ package.json                          # files 增补：["integrations/", ".pi/"]
```

## 2. 为什么 zcode 包放 `integrations/zcode-plugin/` 而不是仓库根 `.zcode-plugin/`

- **市场可发现性**：claude marketplace 规范要求清单在**仓库根** `.claude-plugin/marketplace.json`，
  各插件以 `source` 路径指向插件目录；若把 claude 插件本体也平铺在仓库根 `.claude-plugin/`，
  其组件（agents/、skills/、commands/）会污染仓库根目录，且与 marketplace.json 同桶易混淆。
  → claude 插件本体住 `integrations/claude-code/`，根文件夹只放 marketplace 清单。
- **对等原则**：zcode 加市场同样指向 GitHub 仓库，插件源同理定位在 `integrations/zcode-plugin/`。
- 你说的「适配 claude 就放 .claude-plugin 文件夹」在本稿落实为：
  *claude 集成以 .claude-plugin 清单体系打包*——若你本意是字面把插件本体放仓库根 `.claude-plugin/`，
  请在评审时指出，施工前改名是零成本的一次 mv。

## 3. 机械共享件同步映射（sync-integrations.mjs 的规格）

| 正本（integrations/shared/） | 拷贝目标 ×3 | 断言 |
|---|---|---|
| `manual.md` | `.pi/skills/{plumber-design,plumber-execute}/` 下各一份？ | ❌ 不复制进 pi skill 目录——pi 以 `../../../integrations/shared/manual.md` 相对引用正本 |
| 同上 | `integrations/claude-code/manual.md`、`integrations/zcode-plugin/manual.md` | sha256 三方一致 |
| `commands/*.md` ×2 | `integrations/{claude-code,zcode-plugin}/commands/` | 内容一致 |
| `sp-scripts/*.mjs` ×7 | `.pi/skills/plumber-execute/scripts/`、两插件各自 `scripts/`（新增） | 一致 |

脚本行为：`--check` 模式仅断言（CI/prepublishOnly 用）；默认模式执行拷贝后断言零 diff；
任何漂移/缺失列出差异清单并以非零码退出。`prepublishOnly` 变为：
`node scripts/sync-integrations.mjs --check && npm test && npm run build && npm --prefix web-ui run build`。

pi 对手册的寻址：`.pi` 提示词/skill 中统一写 `Read integrations/shared/manual.md <章节>`（相对仓库根）；
两个插件包内写 `Read ./manual.md <章节>`（Skill base-dir / plugin root 可解析）。

## 4. zcode agents 路由预案（探针不通过的降级链）

1. **首选·插件内置**：`.zcode-plugin/plugin.json` 组件目录靠 zcode 约定默认名自动发现（探针实证：bundle 内 `loadPluginAgentProfiles` 读 `<plugin-root>/agents/*.md` 并命名空间化为 `插件名:名字`），装载即生效、不依赖项目级扫描行为，风险最低。
2. 若探针证实 `<repo>/.zcode/agents/` 也被扫描：README 增补免插件说明，不改包结构。
   ——探针已证实（`l2_zcode_probe` 结论 A，置信度高）：项目级 `.zcode/agents/` 确被扫描。
   README 落地措辞按用户裁决取**用户级**：「亦可仅复制 agents 到 `~/.zcode/agents/`」；无论用户级/项目级
   均须注明——项目级 frontmatter 的 `permissionMode` 会被强制剥离（权限字段仅用户级定义生效），
   保留名 `general-purpose`、`Explore` 不可占用。
3. 兜底·用户级：README 教程指导复制到 `~/.zcode/agents/`（注明同名遮蔽原理）。
   探针结论写入 `ctx_zcode.boundary` 备注；路由决定记录在 `l2_zcode_components.notes`。

## 5. 双通道接线

### 通道① GitHub 仓库即市场

```bash
# claude code
/plugin marketplace add lukawi/super-plumber     # 读根 .claude-plugin/marketplace.json
# zcode（Settings→Plugin Discover→添加市场源 lukawi/super-plumber）
```

marketplace.json 骨架（**单条真实插件条目**——pi 无插件系统，注册伪 source 条目会导致 add 校验失败，其发现通道走 README/npm 兜底；R-MANIFEST 评审后修正原"三件"表述，双包合并后由原"两件"再收敛为一件，见顶部 adr_0002 裁决）：

```jsonc
{
  "name": "lukawi-super-plumber",
  "owner": { "name": "lukawi" },
  "plugins": [
    { "name": "super-plumber", "source": "./integrations/plugin", "version": "0.6.1",
      "description": "Super Plumber workflow orchestration (design graphs, execute nodes) for Claude Code & ZCode" }
  ]
}
```

（l2_marketplace_smoke 冒烟实测回填：source 必须带 `./` 前缀——缺前缀报 `source: Invalid input`；`strict` 字段缺省可用——条目省略该字段、安装成功实证。）

### 通道② npm 随包兜底

`package.json.files = ["dist/", "web-ui/dist/", "integrations/", ".pi/"]`
装包用户接入路径：`node_modules/@lukawi/super-plumber/integrations/<pkg>` 复制到自身项目对应位置；
README（双语）按工具给三条 two-step 接入指南（含 pi 直接用仓内 `.pi/` 的 git subtree 或手动拷贝）。

### MCP 自动接线

- claude 包：`.mcp.json` → `{ "mcpServers": { "graph": { "command": "npx", "args": ["-y","@lukawi/super-plumber","graph-mcp"] } } }`？——以 example-plugin 的 mcp/hello-server.mjs + .mcp.json 实际格式为准（组装时对照，冒烟验证自动连接）。
- zcode 包：plugin.json `mcpServers` 字段内联同款启动项（workspace 级 MCP 自动连接已由官方文档确认）。

## 6. 施工波次（并行计划，供 plumber-execute 循环参考）

| 波次 | 节点 | 执行者 | 说明 |
|---|---|---|---|
| W0（当前） | l1_design_final | main-agent | 本文+归属清单，**停人工评审门** |
| W1 | l2_manual_write ‖ l2_claude_manifest ‖ l2_zcode_probe | 3 个 subagent 并行 | 手册撰稿最重，派专职写手 agent；manifest 是 JSON 小活可与探针同批；交叉评审：manifest 写手↔probe 执行者互查对方产物 |
| W2 | l2_commands_src ‖ l2_pi_prompts ‖ l2_pi_skills | 3 个 subagent 并行 | 等 W1 三节点全 passed 后启动（e05-e10 门禁）；交叉评审：每份产物由非原作者的 agent 复核（对应 cross_review 检查点） |
| W3 | l2_sync_script ‖ l2_claude_components | 2 并行 | sync 脚本可与 claude 组装同批（脚本只依赖手册正本路径约定）；产出互查 |
| W4 | l2_zcode_components ‖ l2_npm_files | 探针+claude 组件齐备后 | npm pack 试跑与 zcode 组装互为独立 |
| W5 | l2_marketplace_smoke | main-agent | 四项验收留证（截图/日志路径入 execution_report.artifacts） |
| W6 | l2_env_migration ‖ l2_release_docs | 2 并行 | 本机替换与文档写作无冲突 |
| W7 | l1_release_final | main-agent + super-mario 式裁决流程 | bump→回归→三层验收；主观判定汇总呈你拍板 |

**交叉质量检查纪律**（你点名的硬要求）：每个 `cross_review` verifier 的检查点，必须由**未参与该产物撰写**的另一 agent 实例执行并在节点 notes 留下"审了什么/结论/证据"；汇合点由我按 Mario 协议做 checkpoint 聚合 + artifact 抽查后才 verdict→passed。主线程自己的 auto 检查不得替代交叉评审。

## 覆盖自查（cp_struct 判据）

- 三类文件落位：角色文本（agents×6 处布局）、编排文本（skills×6）、操作语法（manual 正本+3 寻址规则）✔
- 双通道接线：marketplace + npm files 均有具体文件与骨架 ✔
- 同步映射表覆盖全部机械共享件 ✔｜zcode 路由降级链有决策树 ✔
