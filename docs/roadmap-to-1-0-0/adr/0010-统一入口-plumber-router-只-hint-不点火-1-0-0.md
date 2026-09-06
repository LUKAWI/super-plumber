# 0010 — 统一入口 /plumber router：只 hint 不点火（1.0.0）

新增 /plumber router skill，只回答「该不该用 SP/走哪档/用哪张图/现在在该档哪一步」；只 hint 不点火；/plumber-design 与 /plumber-execute 保留直达入口；这是 DEC-4 入口冻结的第二次解除（首次为 0.9.4 sp-executor 定义）。

**Status：** accepted

**Context：** 无统一入口，「该不该建图/走哪档」无路由器；MP router 论证——路由器是认知负载的净削减但只能提示。

**Considered Options：** router 直接点火（越权，否）；维持两入口无路由（引导式断裂，否）；本方案（采纳）。

**Why：** program 档已存在可供路由；quick 类「不画图直接用纪律技能干」的路由落点存在（DEC-6 纪律族）；用户拍板。

**Consequences：** commands 终态 4（design/execute/join/plumber）；与 journey prompts 互补（入场路由 vs 阶段出场）；本 ADR 于 1.0.0 裁决（v100-freeze accept）。

> 本文由 `graph export` 从图顶点 adr_0010 生成；改图不改文，重新导出即覆盖。
