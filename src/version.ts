// src/version.ts — 版本单一来源：运行时读取 package.json，CLI / MCP / init 共用，
// 避免版本号在多处硬编码漂移（v0.1.x 的历史教训）。
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/** 当前包版本（与 package.json 完全一致） */
export const VERSION: string = pkg.version;
