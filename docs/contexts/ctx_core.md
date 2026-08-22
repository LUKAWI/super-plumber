# 核心引擎（ctx_core）

数据模型、状态机、门禁、调度与存储原语——产品语义的唯一裁判；不含任何 I/O 面（CLI/MCP/Web 都只是它的视图）

## 术语表

- **知识顶点**: context/adr 类节点：一等公民但豁免调度与工作流状态机；区别于 task 等工作流顶点
- **门禁（gate）**: 进入 ready/认领前的硬校验：门控边前驱须全部 passed；区别于 validate 警告（软提示）
- **提议/裁决分离**: 执行 agent 只能提议（ADR 落 proposed），accept/supersede 归 Super Mario/人类——与 MCP 无 force 同构
- **索引缓存**: 两级缓存（内存+磁盘 graph.json），写路径必须主动失效（fix_index_cache），不赌文件系统 mtime

> 本文由 `graph export` 从 context 顶点 ctx_core 生成（节点即文档，图是真相源）。
