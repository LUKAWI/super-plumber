sp 执行脚本的唯一正本区：integrations/src/sp-scripts/（0.9.4 S01 单真相源重组起；S03 八脚本收敛为 sp.mjs 单入口 + sp-check-design.mjs 设计体检，adr_0008）。

- `sp.mjs` — 单入口子命令式薄封装：claim / update-status / get-node 调 CLI（stdio/退出码透传，语义 ≡ CLI）；checkpoint / report / traverse 单点调用核心公开 API（CLI 无对应子命令）；`check-design` 转发同目录体检脚本。
- `sp-check-design.mjs` — 设计质量体检 doctor（E1-E10/W1-W8 判据，手册 §2.6）；也可经 `node sp.mjs check-design` 调用。

零依赖（仅 node 内置；核心定位先项目本地安装/包自引用，回退 npm root -g）。旧 sp-{core,claim,update-status,checkpoint,report,get-node,traverse}.mjs 七件已退役，由 `scripts/sync-integrations.mjs` gen 构建期分发本目录到 `.pi/skills/plumber-execute/scripts/`（pi 运行位）与 `integrations/plugin/scripts/`（插件包运行位）；产物禁止手改，`node scripts/sync-integrations.mjs --check` 比对拦截。
