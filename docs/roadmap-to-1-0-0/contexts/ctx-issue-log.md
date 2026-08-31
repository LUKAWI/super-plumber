# 问题修复域（过程缺陷与用户反馈的节点化治理）（ctx-issue-log）

承载"设计/开发/验证/测试过程中每一次失败遇到的问题 + 用户修改要求"转化而来的修复任务节点（治理原则见 ADR-0012 前馈回路）。与 L1 修复层（fix-v080-*，产品缺陷，源自 docs/v0.8.0-issue-log.md）互补：产品缺陷归修复层，过程性问题归本域；两边账本 cross-reference、不重复建节点。条目真相源 = docs/issue-log.md（统一问题账本）；本域节点是可调度执行面——priority 按"越紧急越优先"排定，按一般节点方法流转（claim→checkpoint→report→verdict→passed），解决后 passed 并在账本销账；不可行动项只在账本记录处置理由、不建节点。不负责 roadmap 功能条目（归各技术域）与版本发布（归 ctx-release-ops）。

## 术语表

- **前馈回路（issue remediation loop）**: 前馈回路是 ADR-0012 确立的治理闭环——失败与用户反馈 → 问题账本（docs/issue-log.md）→ 图节点（越紧急越优先）→ 常规节点流转 → passed 销账；不是事后台账，是调度前排队的活。
- **过程性问题（process defect）**: 过程性问题是工具、脚本、流程、文档在设计与开发过程中暴露的坑与缺陷（如批量脚本 glob 污染、查询深度截断），区别于产品功能缺陷（走 fix 修复层）与执行期回归。

> 本文由 `graph export` 从 context 顶点 ctx-issue-log 生成（节点即文档，图是真相源）。
