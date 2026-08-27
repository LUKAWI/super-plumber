# 分发与发布上下文（ctx_dist）

分发双通道与本机收口：npm files 随包接线、marketplace 市场接入、三工具装载冒烟、~/.zcode 迁移切换与发布文档。不改任何工作流内容的语义，只负责把这些内容送达用户。

## 术语表

- **双通道**: GitHub 仓库即插件市场（根 marketplace.json 一条命令接入）+ npm 包 files 兜底的组合分发方式
- **原位替换**: 冒烟通过后以 0.6.1 新版覆盖 ~/.zcode/agents 下两份漂移副本（用户指定完成后再动，不提前删除）

> 本文由 `graph export` 从 context 顶点 ctx_dist 生成（节点即文档，图是真相源）。
