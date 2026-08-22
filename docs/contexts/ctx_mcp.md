# MCP 协议通道（ctx_mcp）

agent 协议通道：20 个工具的 zod schema 与响应；无业务规则；force 在协议层拒绝（FIX-A1）

## 术语表

- **工具（tool）**: MCP server 注册的具名操作（graph_create_node 等 20 个）；与 CLI 命令一一或多对一映射
- **claim**: ready→running 的原子认领（记录 assigned_to+started_at）；响应附 governing_adrs 指针

> 本文由 `graph export` 从 context 顶点 ctx_mcp 生成（节点即文档，图是真相源）。
