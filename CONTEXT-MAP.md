# Context Map

> 本仓库有 4 个 bounded context（由 `graph export` 从图生成）。
> 术语表详情见各 context 文件；图为真相源，本文件是视图。

| Context | 边界 | 术语数 | 文档 |
|---------|------|--------|------|
| ctx_cli（命令行通道） | 人类运维通道：命令解析与输出格式化；无业务规则（全部下沉 core）；force 等越权操作仅此通道可用 | 2 | docs/contexts/ctx_cli.md |
| ctx_core（核心引擎） | 数据模型、状态机、门禁、调度与存储原语——产品语义的唯一裁判；不含任何 I/O 面（CLI/MCP/Web 都只是它的视图） | 4 | docs/contexts/ctx_core.md |
| ctx_mcp（MCP 协议通道） | agent 协议通道：20 个工具的 zod schema 与响应；无业务规则；force 在协议层拒绝（FIX-A1） | 2 | docs/contexts/ctx_mcp.md |
| ctx_webui（Web 可视化） | 纯只读可视化：map 过滤与 D3 渲染；零写路径（裁决控制台是未来可选演进） | 2 | docs/contexts/ctx_webui.md |
