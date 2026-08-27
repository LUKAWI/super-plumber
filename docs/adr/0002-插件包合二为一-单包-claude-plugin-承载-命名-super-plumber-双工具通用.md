# 0002 — 插件包合二为一：单包 .claude-plugin 承载，命名 super-plumber，双工具通用

只保留一个插件包：目录 integrations/plugin/，清单 .claude-plugin/plugin.json（zcode 以兼容回退读取同一份），插件命名 super-plumber（不带渠道后缀）。marketplace.json 收敛为单条目。废除 super-plumber-claude 与 super-plumber-zcode 双包分装。pi 渠道维持 .pi/ 直用不变。

**Status：** proposed（待裁决）

**Context：** 双包组装与冒烟均已完成并各自过审后，用户在实测反馈中裁决：两包骨架与内容高度同构（仅清单文件名/插件名/渠道标注三处差异），双包并行维护是重复负担；且探针与官方样实证 zcode 以兼容回退方式直接读取 .claude-plugin 清单（example-plugin 官方样板明文），单包即可双工具通用。

**Considered Options：** 维持双包（claude/zcode 各一份，分别维护清单与渠道标注）→ 重复维护成本高、漂移面大; 双 manifest 同目录（example-plugin 式合体）→ 仍是两个插件名两次安装; 单包单清单（选中）→ 一个名字一次安装，zcode 经 .claude-plugin 兼容回退装载，agents 走包内约定目录自动发现

**Why：** 用户明确裁决"合二为一，免得重复维护，只留 claude-plugin（向上兼容），命名不加 claude 或 zcode"。双包内容经 R3/R4 两轮独立评审证实字节级同构，分装无信息增益；zcode 兼容回退有官方样板与引擎代码双重实证。

**Consequences：** zcode 侧安装路径依赖 .claude-plugin 兼容回退行为（探针与官方样板双重背书，冒烟由用户 GUI 复验）；已装 super-plumber-zcode 的环境需卸载并改装 super-plumber；marketplace 由两条目收敛为一条；scripts/sync-integrations.mjs 映射表从 10×27 收敛为 10×17；integrations/zcode-plugin/ 目录已删除（其内容与单包完全同构，无信息丢失）。

> 本文由 `graph export` 从图顶点 adr_0002 生成；改图不改文，重新导出即覆盖。
