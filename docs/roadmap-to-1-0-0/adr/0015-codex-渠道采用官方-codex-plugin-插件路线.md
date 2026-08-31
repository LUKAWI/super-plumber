# 0015 — Codex 渠道采用官方 .codex-plugin 插件路线

仓库以 OpenAI Codex 官方插件形态进入第四渠道（pi/claude/zcode/codex）：在 integrations/plugin 根并置 .codex-plugin/plugin.json 清单（skills ./skills/、mcpServers 内联 graph-mcp、interface 元数据），仓库根新增 .agents/plugins/marketplace.json（entry local 指向 ./integrations/plugin，policy AVAILABLE/ON_INSTALL）；skills/manual/scripts/agents 整包复用零拷贝，用户侧 codex plugin marketplace add lukawi/super-plumber 一条命令安装。不建安装器、不做技能拷贝落位。

**Status：** accepted

**Context：** 2026-08-31 渠道调研：Codex 已官方采用 Anthropic SKILL.md 开放标准（2025-12 起）并推出插件体系（.codex-plugin/plugin.json 唯一必需清单 + skills/.mcp.json/hooks 组件指针 + marketplace 安装链），组件指针与 Claude 插件几乎同构，连 .claude-plugin/marketplace.json 都在 legacy 兼容读取路径上。调研期曾以 graph install --tool codex 安装器（拷技能进 .codex/skills + 合并 config.toml）为首选方案，官方插件体系出现后作废。Codex 技能发现依赖真拷贝（symlink 不可靠，openai/codex#11314），官方安装链天然代管此事。

**Considered Options：** ①（采纳）官方插件路线：两个纯增量 JSON 文件，marketplace add 一条命令分发，skills 零拷贝复用；② graph install 安装器：拷技能进用户 .codex/skills + 合并 config.toml——维护面大、升级靠重跑、要自管 Windows npx 与 TOML 合并，被官方体系整体取代；③ config.toml [[skills.config]] 直挂 node_modules 内技能路径：零拷贝但依赖用户本地依赖布局，npx-only 用户不可用；④ 纯 README 手工三步：违背零配置即用原则，仅作兜底文档。

**Why：** 与现有 integrations/plugin 结构同构，增量最小（清单 + marketplace 两个 JSON）；Codex 整包缓存安装使 ./manual.md 既有寻址零改动成立；安装/升级/卸载全由官方 CLI 代管，我方零维护面；官方 hooks schema 与 CLAUDE_PLUGIN_ROOT 兼容先例表明其对 Claude 形态的兼容是长期姿态。

**Consequences：** 插件清单无 subagent 定义位：Codex 渠道缺省走技能内建 solo 分支，sp-designer/super-mario 以 .codex/agents/*.toml（developer_instructions 内联）作文档级进阶项；.mcp.json 双格式冲突（Claude mcpServers 键名是否被 Codex 默认发现宽容）需在 v095-manifest 安装实测定夺，不宽容则 manifest 指向独立 .mcp.codex.json；marketplace.json 与 .codex-plugin/plugin.json 的 version 成为发版同步清单项；Codex 插件体系尚年轻，发现路径/清单校验仍在演进，安装实测是每个版本的回归项。

> 本文由 `graph export` 从图顶点 adr_0015 生成；改图不改文，重新导出即覆盖。
