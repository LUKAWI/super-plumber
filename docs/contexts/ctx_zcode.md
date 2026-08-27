# zcode 集成上下文（ctx_zcode）

面向 zcode 的 .zcode-plugin 插件包组装，与 claude 包同构。agents 文件的落位策略以 l2_zcode_probe 实测结论为准，不在本上下文内猜测。【探针结论 2026-08-27】结论 A（置信度高）：zcode 确实扫描项目级 <repo>/.zcode/agents/ ——主程序 bundle 中 loadZCodeAgentProfiles 的装载根硬编码了 {join(workingDirectory,".zcode","agents"),source:"project"} 与用户级并列，且有专属 sanitizeProjectAgentProfile 分支；README 影响决定：增补「免装插件的轻量路径」说明，但首选路由维持插件内置 agents 字段不变，降级链第 2 级改为「项目级 .zcode/agents（permissionMode 被剥离）」，用户级兜底复制法殿后。证据全文见 docs/multitool-v061/zcode-agents-probe.md。

## 术语表

- **agents 路由**: agents 文件在三处的落位策略选择：项目级目录 / 插件内置字段 / 用户级回退（附 README 说明）
- **探针**: 用含独特标记词的最小样本 md 实测某工具是否扫描特定目录的一锤定音实验

> 本文由 `graph export` 从 context 顶点 ctx_zcode 生成（节点即文档，图是真相源）。
