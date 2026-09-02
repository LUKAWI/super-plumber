# CLI 命令层（ctx_cmds）

人类运维通道：init/switch/list/rename-graph/delete-graph 五命令 + --graph 参数注入；无业务规则（全部下沉 core），破坏性操作（rename/delete）仅此通道

## 术语表

- **图名回显**: 关键输出首行标注图名（status/next/switch），脚本可解析（--json 附 graph 字段）
- **悬挂提示**: 操作不存在的图名时查 workspace-events 给出『已更名为 X』/『已删除进 .trash』提示

> 本文由 `graph export` 从 context 顶点 ctx_cmds 生成（节点即文档，图是真相源）。
