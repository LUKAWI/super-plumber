# Context Map

> 本仓库有 9 个 bounded context（由 `graph export` 从图生成）。
> 术语表详情见各 context 文件；图为真相源，本文件是视图。

| Context | 边界 | 术语数 | 文档 |
|---------|------|--------|------|
| ctx-issue-log（问题修复域（过程缺陷与用户反馈的节点化治理）） | 承载"设计/开发/验证/测试过程中每一次失败遇到的问题 + 用户修改要求"转化而来的修复任务节点（治理原则见 ADR-0012 前馈回路）。与 L1 修复层（f | 2 | contexts/ctx-issue-log.md |
| ctx-phase-08x（开发顺序②：0.8.x 决策落地期） | 索引型上下文（分期域，不承载节点归属）：盘点 0.8.x 三个版本的全部工作——0.8.0「借力 skills 的工程判断」（审批凭据+三级路由+写作规范，P0 | 1 | contexts/ctx-phase-08x.md |
| ctx-phase-09x（开发顺序③：0.9.x 结构升级期） | 索引型上下文（分期域，不承载节点归属）：盘点 0.9.x 六个版本的全部工作——0.9.0「雾中绘图」（雾区 schema + chart/work 两模式）+ | 1 | contexts/ctx-phase-09x.md |
| ctx-phase-100（开发顺序④：1.0.0 收口期） | 索引型上下文（分期域，不承载节点归属）：盘点 1.0.0 收口期全部工作——统一入口 /plumber router + 纪律族补全（grilling-lite | 2 | contexts/ctx-phase-100.md |
| ctx-phase-debug（开发顺序①：0.7.0 debug 修复（0.8.0 开发前置）） | 索引型上下文（分期域，不承载节点归属——成员仍按技术域挂在 ctx-tooling/ctx-skills-plugin/ctx-release-ops/ctx- | 1 | contexts/ctx-phase-debug.md |
| ctx-release-ops（发布与治理（版本/ADR/导出）） | 负责版本收口与决策治理：CHANGELOG/版本号/tag/npm publish 的发布工程、README/manual 计数收口、ADR 的转正裁决执行与  | 6 | contexts/ctx-release-ops.md |
| ctx-skills-plugin（工作流与话术层（skills/plugin/文档）） | 负责提示词与文档资产：plumber-design / plumber-execute 两个 SKILL.md 及其插件包双副本、integrations/sh | 13 | contexts/ctx-skills-plugin.md |
| ctx-tooling（工具与协议层（MCP/CLI/core）） | 负责 super-plumber 的机器面：core 引擎（src/core/）、CLI 命令（src/cli/）、MCP 工具（src/mcp/）及其测试—— | 12 | contexts/ctx-tooling.md |
| ctx-webui（呈现层（web-ui 星空）） | 负责 web-ui/（只读星空前端）的呈现层：星图与图库、决策文档入口、前沿视图、雾区云团、术语 Avoid 呈现。不负责机器面与读接口实现（归 ctx-too | 4 | contexts/ctx-webui.md |
