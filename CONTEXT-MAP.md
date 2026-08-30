# Context Map

> 本仓库有 4 个 bounded context（由 `graph export` 从图生成）。
> 术语表详情见各 context 文件；图为真相源，本文件是视图。

| Context | 边界 | 术语数 | 文档 |
|---------|------|--------|------|
| ctx-release-ops（发布与治理（版本/ADR/导出）） | 负责版本收口与决策治理：CHANGELOG/版本号/tag/npm publish 的发布工程、README/manual 计数收口、ADR 的转正裁决执行与  | 6 | docs/contexts/ctx-release-ops.md |
| ctx-skills-plugin（工作流与话术层（skills/plugin/文档）） | 负责提示词与文档资产：plumber-design / plumber-execute 两个 SKILL.md 及其插件包双副本、integrations/sh | 13 | docs/contexts/ctx-skills-plugin.md |
| ctx-tooling（工具与协议层（MCP/CLI/core）） | 负责 super-plumber 的机器面：core 引擎（src/core/）、CLI 命令（src/cli/）、MCP 工具（src/mcp/）及其测试—— | 12 | docs/contexts/ctx-tooling.md |
| ctx-webui（呈现层（web-ui 星空）） | 负责 web-ui/（只读星空前端）的呈现层：星图与图库、决策文档入口、前沿视图、雾区云团、术语 Avoid 呈现。不负责机器面与读接口实现（归 ctx-too | 3 | docs/contexts/ctx-webui.md |
