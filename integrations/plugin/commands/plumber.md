---
description: 统一入口：判断是否使用 Super Plumber、选择工作类、定位目标图和当前步骤；只给路由提示，不自动点火
---
<!-- 命令正本：integrations/src/commands/plumber.md；渠道副本由 sync-integrations 生成。 -->

# /plumber

加载 **plumber** router skill，回答四个问题：是否该用 SP、走 `quick|standard|program` 哪一档、使用哪张图、现在处于该档哪一步。只给只读路由提示和下一直接入口，不创建/切换图、不认领节点、不启动设计或执行。

需要继续时，按提示进入 `/plumber-design`、`/plumber-execute` 或 `/plumber-join`；三个直达入口保持有效。纪律技能仍由模型按触发语命中，不新增独立命令。

$ARGUMENTS 原样作为需求、图名或范围限定，不做模板展开。
