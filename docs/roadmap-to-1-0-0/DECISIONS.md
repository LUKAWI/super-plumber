# DECISIONS

> 决议一行索引（由 `graph export` 从图顶点生成）：passed 的 task 节点 + accepted/superseded 的 ADR。
> 图为真相源，本文件是视图；改图不改文，重新导出即覆盖。

| 决议 | id | 标题 | 结论时间 |
|------|----|------|---------|
| ADR · accepted | adr_0001 | 设计审批：凭据 + 关键时刻提示，不做硬门禁（DEC-1） | 2026-08-30T23:32:49.659Z |
| ADR · superseded | adr_0002 | 三级工作类路由：quick / standard / program（DEC-2） | 2026-09-05T09:02:08.667Z |
| ADR · accepted | adr_0003 | 纪律分层判据：不变量归工具，流程归 skills（DEC-3） | 2026-08-30T23:32:50.091Z |
| ADR · accepted | adr_0004 | 自主入场：冷启动加入协议 + sp-executor subagent 定义（DEC-5） | 2026-08-30T23:32:50.322Z |
| ADR · accepted | adr_0005 | skills 入口策略修订 + 纪律技能族自建（DEC-6） | 2026-08-30T23:32:50.554Z |
| ADR · accepted | adr_0006 | 改图协议 amend：三级分流 + 三条轻机器约束，不新增 skill（DEC-7） | 2026-09-01T05:11:26.877Z |
| ADR · accepted | adr_0007 | 雾区进 schema：轻字段 + 只提示不阻止（0.9.0 设计基准） | 2026-09-01T16:15:49.179Z |
| ADR · accepted | adr_0008 | 单真相源重组：正本唯一化 integrations/src/，双视图变构建产物（0.9.4） | 2026-09-04T07:03:46.405Z |
| ADR · accepted | adr_0009 | hooks 是可选 harness 资产，不是 SP 机制（0.9.4） | 2026-09-04T07:03:50.880Z |
| ADR · accepted | adr_0012 | 过程问题前馈回路：失败与用户反馈一律入账、转图节点、按常规流程治理 | 2026-08-30T09:33:39.056Z |
| ADR · accepted | adr_0013 | 多图工作区知识视图导出按图名分离存放（根治 A1 跨图视图挤占） | 2026-08-30T11:39:27.326Z |
| ADR · accepted | adr_0014 | sp-grilling 纪律技能：意图对齐与决策纠正的统一对话核心（替代 quiz 三问） | 2026-08-30T14:27:35.303Z |
| ADR · accepted | adr_0015 | Codex 渠道采用官方 .codex-plugin 插件路线 | 2026-08-31T12:08:23.380Z |
| ADR · accepted | adr_0016 | 档位凭据命令 /plumber-class：用户直发 class + class_changed 凭据 + 方向性请示纪律 | 2026-09-01T23:39:45.659Z |
| ADR · accepted | adr_0017 | fallback 最小读语义 + iterates 维持文档性标注（F09 纸面边清偿） | 2026-09-03T12:28:21.415Z |
| ADR · accepted | adr_0018 | 工作类按可信交付计划定档（修订 DEC-2） | 2026-09-05T09:02:08.656Z |
| task · passed | arch-c1-cli-runner | [0.9.1-0.9.2·架构] C1 核心错误码六枚 + CLI defineCommand 统一骨架（全迁） | 2026-09-04T00:26:16.806Z |
| task · passed | arch-c2-scheduler-split | [0.9.1·架构] C2 调度策略与索引缓存分家（scheduler.ts 新家） | 2026-09-02T16:31:19.594Z |
| task · passed | arch-c3a-claim-nudges | [0.9.1·架构] C3a 认领提示包 core 单源（CLI 补齐 review_flag） | 2026-09-02T14:27:38.813Z |
| task · passed | arch-c3b-validate-core | [0.9.1·架构] C3b validate 七步编排下沉 core（单源结果、双渠道薄渲染） | 2026-09-02T14:55:24.731Z |
| task · passed | arch-c4a-fog-home | [0.9.1·架构] C4a 雾区概念成家（fog.ts 收写路径）+ class 枚举单源 | 2026-09-02T15:16:39.559Z |
| task · passed | arch-c4b-review-home | [0.9.2·架构] C4b 审批凭据成家（review.ts）+ parser 减负解环 | 2026-09-02T23:41:03.563Z |
| task · passed | arch-c5-amend-combinator | [0.9.2·架构] C5 改图守卫组合器（skipAmendGuard 通道退役） | 2026-09-03T00:43:55.722Z |
| task · passed | arch-c7a-view-tree-gate | [0.9.1·架构] C7a ADR 导出视图合树 + export --check 门禁 + 散文锚点即修 | 2026-09-02T14:55:24.764Z |
| task · passed | arch-c7b-anchor-gate | [0.9.4·架构] C7b sync --check 增散文锚点断言（manual 版本锚点 + README 计数器） | 2026-09-04T01:01:12.709Z |
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
| task · passed | il-017-sp-traverse-drift | [IL-017] sp-traverse.mjs 脚本层 DFS 语义漂移（与 MCP traverse 修复不同步） | 2026-09-02T14:27:38.763Z |
| task · passed | v081-release | [0.8.1] 0.8.1 发布收尾 | 2026-08-31T14:29:04.697Z |
| task · passed | v081-skills | [0.8.1] WF05 出图前查拒绝理由 + WF06 Avoid 约定 + WF07 纪律互通映射 | 2026-08-31T13:50:32.861Z |
| task · passed | v081-tooling | [0.8.1] F14 delete-node --reason 双通道 + F15 DECISIONS.md 决议索引 | 2026-08-31T13:29:04.791Z |
| task · passed | v081-verify | [0.8.1] 0.8.1 交叉验证 | 2026-08-31T14:12:04.933Z |
| task · passed | v081-webui | [0.8.1] web-ui 前沿一键视图 + Avoid 呈现 | 2026-08-31T13:38:23.157Z |
| task · passed | v082-adr | [0.8.2] S08：accept adr_0006（改图协议经 WF16/F21 实践检验） | 2026-09-01T05:13:36.260Z |
| task · passed | v082-amend-skill | [0.8.2] WF16 execute 上报出口节 + 改图三级分流话术 | 2026-09-01T04:03:25.463Z |
| task · passed | v082-amend-tooling | [0.8.2] F21 改图三约束双通道 | 2026-09-01T04:40:43.986Z |
| task · passed | v082-fog-recon | [0.8.2] WF08 雾区约定版试跑 | 2026-09-01T04:09:43.373Z |
| task · passed | v082-join | [0.8.2] S10/WF15 plumber-join skill + 命令三通道（skills 2→3，commands 2→3） | 2026-09-01T04:27:23.489Z |
| task · passed | v082-release | [0.8.2] 0.8.2 发布收尾 | 2026-09-01T06:11:05.784Z |
| task · passed | v082-tooling | [0.8.2] 待拍板收口：class 字段（F03/F13）+ review_flag 文案定稿 | 2026-09-01T04:51:01.942Z |
| task · passed | v082-verify | [0.8.2] 0.8.2 交叉验证 | 2026-09-01T05:24:28.338Z |
| task · passed | v090-chartwork | [0.9.0] WF09 chart/work 两模式进 skill | 2026-09-01T15:59:51.645Z |
| task · passed | v090-fog-schema | [0.9.0] F04/F05/F17 雾区机器面 | 2026-09-01T15:44:26.780Z |
| task · passed | v090-fogui | [0.9.0] web-ui 雾区呈现（虚线云团） | 2026-09-01T16:08:45.400Z |
| task · passed | v090-release | [0.9.0] 0.9.0 发布收尾 | 2026-09-01T23:43:11.069Z |
| task · passed | v090-verify | [0.9.0] 0.9.0 交叉验证 + accept adr_0007 | 2026-09-01T16:16:56.409Z |
| task · passed | v091-class-command | [0.9.1] F22 /plumber-class 档位凭据命令（用户直发 class + provenance 事件） | 2026-09-02T15:41:47.039Z |
| task · passed | v091-release | [0.9.1] 0.9.1 发布收尾 | 2026-09-02T18:04:10.637Z |
| task · passed | v091-skills | [0.9.1] WF10 journey prompts + WF11 人机介入正交决策表 | 2026-09-02T14:27:38.788Z |
| task · passed | v091-tooling | [0.9.1] F06 requires_human 派生标注 + F07 等真人标记与 human stale 阈值 | 2026-09-02T17:17:03.986Z |
| task · passed | v091-verify | [0.9.1] 0.9.1 交叉验证 | 2026-09-02T17:34:29.424Z |
| task · passed | v092-progressive | [0.9.2] F08 approve --level 分批准入（仅 program 类） | 2026-09-03T00:06:11.054Z |
| task · passed | v092-release | [0.9.2] 0.9.2 发布收尾 | 2026-09-03T01:10:22.915Z |
| task · passed | v092-verify | [0.9.2] 0.9.2 交叉验证 | 2026-09-03T00:53:02.961Z |
| task · passed | v093-fallback | [0.9.3] F09 fallback 最小语义 或 降级出枚举（按 DEC-3 判据拍板） | 2026-09-03T12:16:18.014Z |
| task · passed | v093-release | [0.9.3] 0.9.3 发布收尾 | 2026-09-03T12:51:21.030Z |
| task · passed | v093-verify | [0.9.3] 0.9.3 交叉验证 | 2026-09-03T12:25:40.202Z |
| task · passed | v094-agents | [0.9.4] S05 subagent 瘦身 + S09 sp-executor 定义 | 2026-09-04T06:39:56.288Z |
| task · passed | v094-attachments | [0.9.4] S02 SKILL.md 分层：主文档 <100 行 + attachments 七件 | 2026-09-04T08:14:56.864Z |
| task · passed | v094-disciplines | [0.9.4] S11 纪律族起步：plumber-tdd + plumber-review | 2026-09-04T06:06:57.405Z |
| task · passed | v094-gov | [0.9.4] S06 PR 双通道清单 + S08 accept adr_0008/adr_0009 + DEC-4 修订记录 | 2026-09-04T07:05:45.782Z |
| task · passed | v094-hooks | [0.9.4] S04 hooks 适配层（默认关闭） | 2026-09-04T06:18:36.501Z |
| task · passed | v094-oneline | [0.9.4] F18 graph status --oneline 双通道 | 2026-09-04T00:56:47.616Z |
| task · passed | v094-release | [0.9.4] 0.9.4 发布收尾 | 2026-09-04T08:55:16.382Z |
| task · passed | v094-restructure | [0.9.4] S01 正本收拢 integrations/src/ + gen 门禁 | 2026-09-04T00:04:12.387Z |
| task · passed | v094-scripts | [0.9.4] S03 八脚本收敛 sp.mjs 薄封装（≡ CLI 语义面） | 2026-09-04T07:38:47.985Z |
| task · passed | v094-verify | [0.9.4] 0.9.4 交叉验证 | 2026-09-04T08:31:43.887Z |
| task · passed | v095-docs | [0.9.5] Codex 渠道文档与寻址 | 2026-09-04T13:56:46.151Z |
| task · passed | v095-manifest | [0.9.5] Codex 官方插件三件套落地 | 2026-09-04T13:56:05.809Z |
| task · passed | v095-release | [0.9.5] 0.9.5 发布收尾 | 2026-09-04T23:54:48.771Z |
| task · passed | v095-verify | [0.9.5] 交叉验证 | 2026-09-04T14:30:00.961Z |
| task · passed | v096-concurrency-identity | [0.9.6] 图身份与跨实体并发一致性 | 2026-09-05T06:59:05.622Z |
| task · passed | v096-index-consistency | [0.9.6] Index 缓存与写入代际一致性 | 2026-09-05T06:50:27.711Z |
| task · passed | v096-release | [0.9.6] 0.9.6 修复版发布收口 | 2026-09-05T09:37:38.111Z |
| task · passed | v096-schema-contract | [0.9.6] Schema 与审批契约收口 | 2026-09-05T05:21:45.593Z |
| task · passed | v096-snapshot-integrity | [0.9.6] Snapshot 路径隔离与原子回滚 | 2026-09-05T06:13:35.167Z |
| task · passed | v096-verify | [0.9.6] 交叉验证：一致性与边界修复 | 2026-09-05T08:38:23.816Z |
| task · passed | v096-webui-boundary | [0.9.6] Web API/WS 与 UI 状态边界加固 | 2026-09-05T07:31:16.664Z |
