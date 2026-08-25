// src/core/index.ts — 公开 API 桶文件（package.json exports "./core" 指向这里）
// 第三方（含 skill 脚本）应通过 "@lukawi/super-plumber/core" 消费，禁止深挖 dist 内部路径。
// S2-7（f12）：补齐 v0.5/v0.5.2 头号特性的模块导出——此前 graph-dir（多图管理）、
// domain（领域规则）、eventlog（审计日志）、docs-export（文档导出）、index-service
// （索引/调度决策）均未导出，库用户拿不到多图 API。
export * from "./types.js";
export * from "./state-machine.js";
export * from "./checkpoint.js";
export * from "./lock.js";
export * from "./schema.js";
export * from "./parser.js";
export * from "./node.js";
export * from "./edge.js";
export * from "./graph.js";
export * from "./snapshot.js";
export * from "./graph-dir.js";
export * from "./domain.js";
export * from "./eventlog.js";
export * from "./docs-export.js";
export * from "./index-service.js";
