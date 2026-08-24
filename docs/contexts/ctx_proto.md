# MCP 协议通道（ctx_proto）

agent 协议通道：22 工具 zod schema 与响应；graph_switch 进程内 active；全响应回显 graph 字段；跨图纠错提示（提示不代切）

## 术语表

- **进程内 active**: 每个 MCP server 进程（=每个 agent）私有的当前图；graph_switch 只改本进程，重启回落工作区默认
- **跨图纠错**: 操作当前图不存在的节点/边 id 时扫描兄弟图，命中则报错附『它存在于图 X，请先 graph_switch』

> 本文由 `graph export` 从 context 顶点 ctx_proto 生成（节点即文档，图是真相源）。
