## 自检清单

### skill/agent 提示词双副本 diff 核对

**背景**：`.pi/skills/*/SKILL.md`（正本）与 `integrations/plugin/skills/*/SKILL.md`（插件拷贝）、`.pi/agents/*.md`（正本）与 `integrations/plugin/agents/*.md`（插件拷贝）为手工维护的双副本，暂不在 `scripts/sync-integrations.mjs` 的 sha256 同步门禁内（该脚本对提示词类文件不做任何处理，根治归 0.9.4 S01 单真相源重组）。改 `.pi/` 漏改 `integrations/plugin/` 会让 Claude/ZCode 插件渠道静默发布漂移话术，无任何门禁报警（见 `docs/v0.8.0-issue-log.md` B1）。

- [ ] **不涉及**：本次 PR 未改动 skill/agent 提示词文件（`.pi/skills/`、`.pi/agents/` 及 `integrations/plugin/` 对应拷贝）
- [ ] **已核对**：改动已列双路径并逐一 diff——`.pi/` 正本与 `integrations/plugin/` 拷贝同步修改，允许且仅允许渠道寻址行差异（如 `Read integrations/shared/manual.md §N` ↔ `Read ./manual.md §N`、`.pi/agents/sp-designer.md` ↔ `./agents/sp-designer.md`）；超出寻址行差异的部分须逐处说明理由
