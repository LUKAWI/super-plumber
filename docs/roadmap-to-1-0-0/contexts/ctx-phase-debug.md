# 开发顺序①：0.7.0 debug 修复（0.8.0 开发前置）（ctx-phase-debug）

索引型上下文（分期域，不承载节点归属——成员仍按技术域挂在 ctx-tooling/ctx-skills-plugin/ctx-release-ops/ctx-webui）：盘点"对当前已发布版本 0.7.0 的 debug/修复"工作。定位：关闭 docs/v0.8.0-issue-log.md 五项设计期缺陷，是 0.8.0 全部开发工作的前置条件（L1 修复层，方案按用户要求"系统测试后指定"）。成员（5）：fix-v080-a1（A1 ADR 编号×共享视图冲突根治）、fix-v080-b1（B1 skill 双副本 diff 检查项）、fix-v080-b2（B2 manual 契约边示例修订）、fix-v080-c1（C1 领域建模防略过三层修复）、fix-v080-c2（C2 super-mario SP 侧加固）。触达技术域：ctx-tooling（a1）、ctx-skills-plugin（b2/c1/c2）、ctx-release-ops（b1）。后续阶段：ctx-phase-08x。

## 术语表

- **设计期缺陷（design-time defect）**: 设计期缺陷是设计过程中发现的当前已发布版本（0.7.0）的缺陷与流程缺口，集中入档 docs/v0.8.0-issue-log.md；不是执行期回归，也不是 roadmap 功能条目，修复方案一律先系统测试复现再定稿。

> 本文由 `graph export` 从 context 顶点 ctx-phase-debug 生成（节点即文档，图是真相源）。
