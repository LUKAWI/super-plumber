// super-plumber — 工作流拓扑图管理工具
// S2-7（f12）：根入口补齐——此前只转口 types 一行，库用户无法从根入口
// 使用多图/领域/审计等核心 API（多图管理 graph-dir 是 v0.5.2 头号特性）。
// types 经 core/index 桶传递导出（./core 子路径仍独立可用）。
export * from "./core/index.js";
