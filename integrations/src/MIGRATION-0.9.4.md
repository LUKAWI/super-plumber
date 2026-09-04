# 0.9.4 S01 迁移清单：正本收拢 integrations/src/ + gen 门禁

节点 `v094-restructure`（adr_0008 单真相源重组）交付物。0.9.4 为**纯迁移重组 minor**：diff 审计口径 = 只动结构不改语义；下方「文档化内容对齐」一节是全部例外，逐条可追溯。

## 1. 文件级旧 → 新映射（正本位）

| 正本（旧位置） | 正本（新位置 integrations/src/） |
|---|---|
| `integrations/shared/manual.md` | `integrations/src/manual.md` |
| `integrations/shared/commands/plumber-{class,design,execute,join}.md` | `integrations/src/commands/` 同名 |
| `integrations/shared/sp-scripts/sp-{core,claim,checkpoint,get-node,report,traverse,update-status}.mjs` | `integrations/src/sp-scripts/` 同名 |
| `integrations/shared/sp-scripts/README.md` | `integrations/src/sp-scripts/README.md` |
| `.pi/skills/plumber-{design,execute,join}/SKILL.md`、`.pi/skills/sp-grilling/SKILL.md` | `integrations/src/skills/<name>/SKILL.md` |
| `.pi/skills/plumber-design/scripts/sp-check-design.mjs` | `integrations/src/skills/plumber-design/scripts/sp-check-design.mjs` |
| `.pi/agents/sp-designer.md`、`.pi/agents/super-mario.md` | `integrations/src/agents/` 同名 |

## 2. 生成产物（gen 面，全部禁止手改，`--check` 比对拦截）

| 产物位 | 来源 | 模板 |
|---|---|---|
| `.pi/skills/*/SKILL.md`（4） | src/skills 同名 | 是（渠道变量/条件块） |
| `.pi/skills/plumber-design/scripts/sp-check-design.mjs` | src 同路径 | 否（字节拷贝） |
| `.pi/skills/plumber-execute/scripts/sp-*.mjs`（7） | src/sp-scripts | 否 |
| `.pi/agents/*.md`（2） | src/agents 同名 | 是（frontmatter + 出处注释 + 寻址行） |
| `integrations/plugin/manual.md`、`integrations/plugin/commands/*.md`（4）、`integrations/plugin/scripts/sp-*.mjs`（7）、`integrations/plugin/skills/*/SKILL.md`（4）、`integrations/plugin/agents/*.md`（2） | src 对应正本 | manual/commands/scripts 否；SKILL/agents 是 |
| `integrations/shared/manual.md`、`integrations/shared/commands/`、`integrations/shared/sp-scripts/`（含 README） | src 对应正本 | 否（兼容投影，见 §5） |

仍为手写渠道资产、不进 gen 面：`.pi/settings.json`、`integrations/plugin/.claude-plugin/plugin.json`、`integrations/plugin/.mcp.json`、根 `.claude-plugin/marketplace.json`。

## 3. 管线变化（sync → gen）

- 旧：`scripts/sync-integrations.mjs`（0.6.1）以 sha256 断言「三方一致」，只管 manual/commands/sp-scripts 机械共享件，**提示词类文件不做任何处理**（SKILL/agents 双副本人工传导，0.9.1 曾漏传，issue log B1）。
- 新：同一路径脚本演进为 gen 引擎——唯一正本 `integrations/src/` → 渠道产物（.pi 视图 / 插件包视图 / shared 兼容投影），`--check` 把渲染结果与盘上产物逐字节比对，不一致 exit(1)。sha256 同步断言退役；IL-016 版本面断言原样保留在 `--check`。
- 提示词双副本传导从此是机器性质：SKILL/agents 与机械件同走 gen 面，`prepublishOnly` 的 `sync --check` 段（命令行零改动）即 SKILL 双副本传导门禁。

## 4. 文档化内容对齐（无语义变更夹带口径下的全部例外）

1. **插件渠道 SKILL 漏传补齐（B1 根治落地）**：`integrations/plugin/skills/plumber-execute/SKILL.md` 与 `sp-grilling/SKILL.md` 停在 0.9.0，缺 0.9.1 的 WF10 旅程告知两段、adr_0016 档位纪律段、IL-026 雾区豁免段——gen 单源后插件渠道自动补齐（主控增注 2026-09-03，源 IL-028 授权项）。
2. **插件渠道 agents 寻址行可解析（DoD 第 4 条）**：两份 plugin agents 副本的「首步指令/工具语法唯一来源」从 `Read integrations/shared/manual.md`（相对仓库根，插件包内不可解析）改为 `Read ./manual.md`（相对插件包根），与手册 §11 寻址约定一致。
3. **agents/SKILL 出处（provenance）注释更新**：旧的「正本（pi 渠道）/格式适配拷贝」表述在 gen 模型下失真，统一改为「gen 产物 + 唯一正本 integrations/src/ 路径 + 手改会被 gen --check 拦截」；super-mario 插件副本的 IL-021 tools 渠道适配注记原文保留。纯注释，无运行语义。
4. **manual.md 两处构建事实表述**：头部「分发」行与 §11「手册唯一正本在…」条目改为 gen 模型表述（正本住 integrations/src/manual.md）。操作内容零变更。
5. **sp-scripts/README.md**：正本区表述改为 integrations/src/sp-scripts/，下游位措辞更新（并修正 0.6.1 时代的 `integrations/{claude-code,zcode-plugin}` 旧路径残留）。
6. **pi 渠道正本字节恒等**：.pi 下全部 SKILL/scripts 产物与重组前逐字节一致；.pi 两份 agents 仅出处注释一行不同（第 3 条）。模板标记 `{{#pi}}/{{#plugin}}/{{manual}}/{{base}}` 只存在于正本，渲染后不出现在任何产物。

## 5. 兼容投影与已知遗留

- `integrations/shared/` 从「正本」降级为 **gen 兼容投影**（字节复制自正本）：`tests/sync-commands.test.ts`（正本清单/内容钉住 shared/commands）与 `tests/cli/sp-traverse-script.test.ts`（直接 spawn `integrations/shared/sp-scripts/sp-traverse.mjs`）钉住该路径，本节点边界不许改 tests/，故投影保留；tests 随后续节点迁移后可退役该投影，并把 .pi 寻址从 `integrations/shared/manual.md` 切到 `integrations/src/manual.md`。
- 因同一钉住，commands 正本头部的「正本唯一性…唯一权威源…禁止手改拷贝件」注释块按原文保留（对 integrations/src/ 正本为真，对 shared 投影为历史表述），待 tests 迁移一并修订。
- docs/（README、integration-blueprint、CONTEXT 等）对旧布局的描述由后续节点更新（v094-gov / C7b 范围），本节点不越界。
