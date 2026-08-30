# 发布与治理（版本/ADR/导出）（ctx-release-ops）

负责版本收口与决策治理：CHANGELOG/版本号/tag/npm publish 的发布工程、README/manual 计数收口、ADR 的转正裁决执行与 docs 视图隔离导出。不负责功能实现（归 ctx-tooling）与话术/文档内容撰写（归 ctx-skills-plugin），二者经契约边向本层汇口。

## 术语表

- **三层验收（three-layer acceptance）**: 三层验收是宣布完成前的验收框架——状态层（task 节点全 passed）、结构层（validate 0 error）、成果层（逐条对照验收标准核实 artifact 真实存在且内容匹配）；不是只读执行报告 summary 的文字确认。
- **ADR 转正（accept）**: ADR 转正是把 proposed 决策记录升格为 accepted 的裁决动作，依据设计文档 §5 的用户预批执行；不是设计/执行 agent 可自行落笔的状态变更，复核有异议时停在 proposed。
- **隔离导出（isolated docs export）**: 隔离导出是以 --adr-dir 指定图专属目录导出 ADR 视图的做法——因为 ADR 编号按图独立，共享默认目录会让不同图的同号 ADR 经 retireStaleSlugFiles 互相挤进 .retired/；不是可选的目录偏好，而是多图工作区的硬要求。
- **协议冻结承诺**: 1.0.0 起 MCP 工具面与 CLI 语义冻结为 v1，deprecation 政策成文。
- **双通道交付清单（S06）**: 每个面向 agent 的新能力必须列 MCP 工具/CLI 命令/脚本封装三行，缺任一写明理由。
- **决议索引（DECISIONS.md）**: export --docs 增发的决议一行索引（passed task + accepted/superseded ADR）。

> 本文由 `graph export` 从 context 顶点 ctx-release-ops 生成（节点即文档，图是真相源）。
