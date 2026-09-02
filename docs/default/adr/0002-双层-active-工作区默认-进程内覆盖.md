# 0002 — 双层 active：工作区默认 + 进程内覆盖

active 分两层：.graph/active 是工作区默认（新进程与 CLI 无参的起点，graph switch 改写）；MCP 进程内 active 是每个 agent 私有的当前图（graph_switch 只改本进程内存，重启回落默认）。优先级链 --graph > SUPER_PLUMBER_GRAPH > 进程内 > active 文件 > default。

**Status：** accepted

**Context：** 类 git branch 的切换语义。备选：工作区全局单 active（同 git HEAD）。

**Considered Options：** 工作区全局→多 agent 并发互踩（A 切图 B 的调用全部改道，且无感知）; 双层←选中（每 agent=独立 MCP 进程=独立当前图，互不干扰且保留工作区默认的确定性）

**Why：** 核心场景是多 agent 并发，全局 active 会让并发切图造成静默数据错乱；进程内覆盖在不牺牲确定性（无覆盖时回落默认）的前提下隔离了互踩。

**Consequences：** 语义比 git 多一层（默认 vs 进程覆盖），README/skill 需讲清；跨图纠错与回显兜底成为必要的第二道防线

> 本文由 `graph export` 从图顶点 adr_0002 生成；改图不改文，重新导出即覆盖。
