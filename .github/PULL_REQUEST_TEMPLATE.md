## 自检清单

### skill/agent 提示词副本一致性（B1，0.9.4 S01 起由 gen 门禁根治）

**背景**：0.8.x 时代 `.pi/skills`、`.pi/agents`（正本）与 `integrations/plugin/`（插件拷贝）为手工维护双副本，改 `.pi/` 漏改插件拷贝会让 Claude/ZCode 插件渠道静默发布漂移话术且无任何门禁报警（`docs/v0.8.0-issue-log.md` B1），当时以人工双路径 diff 核对作短期门禁。**0.9.4 S01 单真相源重组已根治**：唯一正本 `integrations/src/`，`.pi/`、`integrations/plugin/`、`integrations/shared/` 全部为 gen 构建产物，`node scripts/sync-integrations.mjs --check`（生成完整性比对）已入 CI 第一道与 prepublishOnly 门禁——手改产物、改正本漏生成双渠道一律拦截。本核对项保留为兜底自检：

- [ ] **不涉及**：本次 PR 未改动 skill/agent 提示词文件（`integrations/src/skills/`、`integrations/src/agents/` 及各 gen 产物面）
- [ ] **已核对**：提示词改动只落在正本 `integrations/src/`，未手改任何 gen 产物（`.pi/`、`integrations/plugin/`、`integrations/shared/`）；本地 `node scripts/sync-integrations.mjs --check` 通过

### 面向 agent 新能力：双通道三行清单（S06）

**纪律行（源自 2026-09-02 架构评审 C3 决策，不立 ADR、以清单纪律承载）**：**语义（校验/编排/提示文案）core 单源，渠道只做渲染差异**——新能力先落 core 单源实现，CLI/MCP/脚本各渠道只做薄渲染或封装，禁止在渠道侧双写校验逻辑、编排流程或提示文案。

本次 PR 每引入一个**面向 agent 的新能力**（新 MCP 工具、新 CLI 命令/旗标、新脚本或 hook 资产、新 skill/agent 定义），逐能力列三行；缺任一通道写明理由：

| 能力 | MCP 工具 | CLI 命令 | 脚本封装 |
|---|---|---|---|
| 示例：0.9.4 F18 一行图状态 | `graph_list_graphs` 增 `oneline` 参数（同键同值，不新增工具） | `graph status --oneline` | 无——轻量读面，hook（session-brief）与人直接调 CLI；统一脚本面归 S03 sp.mjs 收敛后随主表补齐 |
| （本 PR 能力 1） |  |  |  |
| （本 PR 能力 2） |  |  |  |

- [ ] 上表已逐能力填满三行，缺任一通道均写明理由
- [ ] 无渠道侧双写语义：校验/编排/提示文案只在 core 单源，渠道只做渲染差异
