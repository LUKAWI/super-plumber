---
description: 低上下文加入已有拓扑图：了解开发目标、工作进度和下一步，将候选节点置 ready 后交给 plumber-execute
---
<!-- 命令正本：integrations/src/commands/plumber-join.md；渠道副本由 sync-integrations 生成。 -->

# /plumber-join

加载 **plumber-join** 技能完成入场，止于候选节点 ready，不在本命令中认领或执行节点。已获执行授权则交接 plumber-execute，否则报告下一步后结束。

$ARGUMENTS 原样作为目标图名或范围限定。
