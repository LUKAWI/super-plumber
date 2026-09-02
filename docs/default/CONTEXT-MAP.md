# Context Map

> 本仓库有 4 个 bounded context（由 `graph export` 从图生成）。
> 术语表详情见各 context 文件；图为真相源，本文件是视图。

| Context | 边界 | 术语数 | 文档 |
|---------|------|--------|------|
| ctx_cmds（CLI 命令层） | 人类运维通道：init/switch/list/rename-graph/delete-graph 五命令 + --graph 参数注入；无业务规则（全部下沉  | 2 | docs/contexts/ctx_cmds.md |
| ctx_mgmt（多图存储与解析） | 工作区级多图状态：图目录解析（五级链）、扁平布局、一次性迁移、active 指针、workspace-events 审计、.trash 软删除；不负责任何命令面 | 4 | docs/contexts/ctx_mgmt.md |
| ctx_proto（MCP 协议通道） | agent 协议通道：22 工具 zod schema 与响应；graph_switch 进程内 active；全响应回显 graph 字段；跨图纠错提示（提示 | 2 | docs/contexts/ctx_proto.md |
| ctx_viz（Web 可视化） | 多图并行渲染：递归监听全部图目录、ws 消息按图路由、折叠任务栏选图器；纯只读观察窗，切图不影响 CLI/MCP 状态 | 2 | docs/contexts/ctx_viz.md |
