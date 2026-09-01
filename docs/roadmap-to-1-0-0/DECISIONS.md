# DECISIONS

> 决议一行索引（由 `graph export` 从图顶点生成）：passed 的 task 节点 + accepted/superseded 的 ADR。
> 图为真相源，本文件是视图；改图不改文，重新导出即覆盖。

| 决议 | id | 标题 | 结论时间 |
|------|----|------|---------|
| ADR · accepted | adr_0001 | 设计审批：凭据 + 关键时刻提示，不做硬门禁（DEC-1） | 2026-08-30T23:32:49.659Z |
| ADR · accepted | adr_0002 | 三级工作类路由：quick / standard / program（DEC-2） | 2026-08-30T23:32:49.871Z |
| ADR · accepted | adr_0003 | 纪律分层判据：不变量归工具，流程归 skills（DEC-3） | 2026-08-30T23:32:50.091Z |
| ADR · accepted | adr_0004 | 自主入场：冷启动加入协议 + sp-executor subagent 定义（DEC-5） | 2026-08-30T23:32:50.322Z |
| ADR · accepted | adr_0005 | skills 入口策略修订 + 纪律技能族自建（DEC-6） | 2026-08-30T23:32:50.554Z |
| ADR · accepted | adr_0006 | 改图协议 amend：三级分流 + 三条轻机器约束，不新增 skill（DEC-7） | 2026-09-01T05:11:26.877Z |
| ADR · accepted | adr_0012 | 过程问题前馈回路：失败与用户反馈一律入账、转图节点、按常规流程治理 | 2026-08-30T09:33:39.056Z |
| ADR · accepted | adr_0013 | 多图工作区知识视图导出按图名分离存放（根治 A1 跨图视图挤占） | 2026-08-30T11:39:27.326Z |
| ADR · accepted | adr_0014 | sp-grilling 纪律技能：意图对齐与决策纠正的统一对话核心（替代 quiz 三问） | 2026-08-30T14:27:35.303Z |
| ADR · accepted | adr_0015 | Codex 渠道采用官方 .codex-plugin 插件路线 | 2026-08-31T12:08:23.380Z |
| task · passed | fix-v080-a1 | [fix·0.7.0] A1 根治：ADR 编号×共享知识视图目录冲突（方案系统测试后定） | 2026-08-30T11:39:27.258Z |
| task · passed | fix-v080-b1 | [fix·0.7.0] B1 短期门禁：skill 双副本 diff 检查项落地 | 2026-08-30T11:39:27.202Z |
| task · passed | fix-v080-b2 | [fix·0.7.0] B2 manual §2.3 契约边示例修订为实测形状 | 2026-08-30T11:39:27.229Z |
| task · passed | fix-v080-c1 | [fix·0.7.0] C1 领域建模防略过三层修复（派单清单+doctor W 项+报告自检） | 2026-08-30T11:39:27.293Z |
| task · passed | fix-v080-c2 | [fix·0.7.0] C2 super-mario spawn 缺工具的 SP 侧加固 | 2026-08-30T14:29:08.672Z |
| task · passed | g080-adr-promote | [0.8.0] ADR 转正（adr_0001~0005）+ docs/adr/v080 隔离导出 | 2026-08-30T23:46:05.434Z |
| task · passed | g080-approve-core | [0.8.0] approve 双通道 + review 凭据 + review_flag（F01/F12/F02 一体） | 2026-08-31T00:08:15.119Z |
| task · passed | g080-context-glossary | [0.8.0] CONTEXT.md 增补三术语（工作类/审批凭据/提示旗标） | 2026-08-30T23:46:05.469Z |
| task · passed | g080-design-skill | [0.8.0] plumber-design SKILL：Phase 0 路由表 + quiz 三问 + approve 话术（WF01+WF02） | 2026-08-31T00:31:50.028Z |
| task · passed | g080-execute-skill | [0.8.0] plumber-execute SKILL：上下文卫生节（WF04） | 2026-08-31T00:08:15.157Z |
| task · passed | g080-grilling | [0.8.0] sp-grilling 纪律技能：MP grilling 本体移植 + SP 落点附录（替代 quiz 三问） | 2026-08-30T23:36:34.820Z |
| task · passed | g080-lint-f16 | [0.8.0] F16 plan/DoD 文案 lint（core 规则组 + 三通道同源） | 2026-08-31T00:31:50.056Z |
| task · passed | g080-manual-writing | [0.8.0] manual 写作规范节 + 上下文卫生镜像 + sync（WF03+WF04 手册面） | 2026-08-31T00:08:15.192Z |
| task · passed | g080-release | [0.8.0] 发布工程收尾：计数/双表/CHANGELOG/版本/tag/publish | 2026-08-31T12:03:14.102Z |
| task · passed | g080-verify-approve | [0.8.0] 验收：approve 双通道端到端断言 | 2026-08-31T08:35:33.062Z |
| task · passed | g080-verify-bootstrap | [0.8.0] 验收：quick 与 standard 双档自举走通 | 2026-08-31T08:35:33.114Z |
| task · passed | g080-verify-lint | [0.8.0] 验收：坏 DoD 触发 lint warning 且退出码 0 | 2026-08-31T08:35:33.087Z |
| task · passed | il-001-level-encoding | [IL-001] 通用性问题：graph 置层准则缺失——sp-designer 不知道该置几层 | 2026-08-31T08:35:33.037Z |
| task · passed | il-002-batch-glob-guard | [IL-002] 批量脚本 glob 污染：.deleted.yaml 被当数据源（标签双重前缀事故） | 2026-08-31T00:47:04.967Z |
| task · passed | il-003-traverse-depth | [IL-003] traverse 深度截断静默丢节点（truncated 虚报） | 2026-08-31T13:06:49.569Z |
| task · passed | il-004-mermaid-phase | [IL-004] mermaid 导出无分期结构（平铺 80 节点难读） | 2026-08-31T13:11:35.365Z |
| task · passed | il-011-edge-type-ergonomics | [IL-011] 通用性问题：边类型选择面虚胖——9 种类型设计者实际只用 1 种，且 MCP/CLI 默认行为不一致 | 2026-08-30T14:53:54.656Z |
| task · passed | il-012-contract-by-context-pair | [IL-012] 通用性问题：跨 context 契约逐边手写——仪式成本应按 context 对收敛 | 2026-08-30T14:38:18.027Z |
| task · passed | il-016-manifest-version-gate | [IL-016] 发版版本面一致性门禁 | 2026-08-31T13:04:15.359Z |
| task · passed | v081-release | [0.8.1] 0.8.1 发布收尾 | 2026-08-31T14:29:04.697Z |
| task · passed | v081-skills | [0.8.1] WF05 出图前查拒绝理由 + WF06 Avoid 约定 + WF07 纪律互通映射 | 2026-08-31T13:50:32.861Z |
| task · passed | v081-tooling | [0.8.1] F14 delete-node --reason 双通道 + F15 DECISIONS.md 决议索引 | 2026-08-31T13:29:04.791Z |
| task · passed | v081-verify | [0.8.1] 0.8.1 交叉验证 | 2026-08-31T14:12:04.933Z |
| task · passed | v081-webui | [0.8.1] web-ui 前沿一键视图 + Avoid 呈现 | 2026-08-31T13:38:23.157Z |
| task · passed | v082-amend-skill | [0.8.2] WF16 execute 上报出口节 + 改图三级分流话术 | 2026-09-01T04:03:25.463Z |
| task · passed | v082-amend-tooling | [0.8.2] F21 改图三约束双通道 | 2026-09-01T04:40:43.986Z |
| task · passed | v082-fog-recon | [0.8.2] WF08 雾区约定版试跑 | 2026-09-01T04:09:43.373Z |
| task · passed | v082-join | [0.8.2] S10/WF15 plumber-join skill + 命令三通道（skills 2→3，commands 2→3） | 2026-09-01T04:27:23.489Z |
| task · passed | v082-tooling | [0.8.2] 待拍板收口：class 字段（F03/F13）+ review_flag 文案定稿 | 2026-09-01T04:51:01.942Z |
