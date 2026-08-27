# Context Map

> 本仓库有 5 个 bounded context（由 `graph export` 从图生成）。
> 术语表详情见各 context 文件；图为真相源，本文件是视图。

| Context | 边界 | 术语数 | 文档 |
|---------|------|--------|------|
| ctx_claude（claude-code 集成上下文） | 面向 Claude Code 的 .claude-plugin 插件包（plugin.json + agents/skills/commands/.mcp.js | 2 | docs/contexts/ctx_claude.md |
| ctx_dist（分发与发布上下文） | 分发双通道与本机收口：npm files 随包接线、marketplace 市场接入、三工具装载冒烟、~/.zcode 迁移切换与发布文档。不改任何工作流内容的 | 2 | docs/contexts/ctx_dist.md |
| ctx_pi（pi 集成上下文） | pi 工具的原生集成文本资产：.pi/agents 两份角色提示词与 .pi/skills 双 skill 的编排化重写。不含 claude/zcode 的适配 | 2 | docs/contexts/ctx_pi.md |
| ctx_shared（共享工件上下文） | 跨工具复用的机械共享件：Operations 手册唯一正本、斜杠命令文案正本、构建期同步脚本。不承载任何工具特有格式，也不做任何工具的流程裁决。 | 6 | docs/contexts/ctx_shared.md |
| ctx_zcode（zcode 集成上下文） | 面向 zcode 的 .zcode-plugin 插件包组装，与 claude 包同构。agents 文件的落位策略以 l2_zcode_probe 实测结论为 | 2 | docs/contexts/ctx_zcode.md |
