// src/core/index.ts — 公开 API 桶文件（package.json exports "./core" 指向这里）
// 第三方（含 skill 脚本）应通过 "@lukawi/super-plumber/core" 消费，禁止深挖 dist 内部路径。
// S2-7（f12）：补齐 v0.5/v0.5.2 头号特性的模块导出——此前 graph-dir（多图管理）、
// domain（领域规则）、eventlog（审计日志）、docs-export（文档导出）、index-service
// （索引缓存）均未导出，库用户拿不到多图 API；arch-c2 起调度决策在 scheduler。
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
export * from "./style-lint.js";
export * from "./eventlog.js";
export * from "./docs-export.js";
export * from "./index-service.js";
// arch-c2：调度决策与旗标装配单源（自 index-service 分家；符号集与其不相交，
// 桶文件可同时 re-export 两个模块而不撞名）
export * from "./scheduler.js";
// arch-c2 层次归位：图目录定位（graphDirOf）与图摘要（summarize）自 cli/graph-ops
// 下沉 core——MCP 不再引用 cli 层
export * from "./graph-summary.js";
// arch-c3b：validate 编排单源（命名避让 schema.ts 的 validateGraph——后者是
// graph.yaml schema 校验器，早已由本桶文件公开）
export * from "./validate.js";
