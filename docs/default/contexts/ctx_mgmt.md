# 多图存储与解析（ctx_mgmt）

工作区级多图状态：图目录解析（五级链）、扁平布局、一次性迁移、active 指针、workspace-events 审计、.trash 软删除；不负责任何命令面/协议面/渲染面

## 术语表

- **图目录**: .graph/<名>/（图内=graph.yaml+nodes+edges+snapshots+index+events+.locks）；旧布局 .graph/ 原地即 default 图目录
- **active 指针**: .graph/active 存工作区默认图名；区别于 MCP 进程内 active（不落盘、进程私有）
- **一次性迁移**: 建第二张图时把旧布局 7 项 renameSync 进 .graph/default/，锁内原子、幂等
- **软删除**: delete-graph 把图目录移入 .trash/<名>-<时间戳>/（可手工救回），区别于物理 rm

> 本文由 `graph export` 从 context 顶点 ctx_mgmt 生成（节点即文档，图是真相源）。
