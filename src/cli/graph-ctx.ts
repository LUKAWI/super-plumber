// src/cli/graph-ctx.ts — v0.5.2 CLI 图上下文：--graph 参数注入 + 五级链解析
// --graph 经 index.ts 的 preAction 钩子从每个命令注入（setGraphOverride），
// 优先级链与 MCP 一致：--graph > SUPER_PLUMBER_GRAPH > （CLI 无进程内层）> .graph/active > default
import {
  resolveGraphDir,
  type ResolvedGraphDir,
} from "../core/graph-dir.js";

let graphOverride: string | undefined;

export function setGraphOverride(name: string | undefined | null): void {
  graphOverride = name === null || name === "" ? undefined : name;
}

/** 解析当前 CLI 调用的目标图（cwd = 工作区根）。错名时 resolveGraphDir 报错含 did-you-mean。 */
export function cliGraphCtx(cwd: string = process.cwd()): ResolvedGraphDir {
  return resolveGraphDir(cwd, {
    name: graphOverride,
    env: process.env.SUPER_PLUMBER_GRAPH,
  });
}

export function cliGraphDir(cwd: string = process.cwd()): string {
  return cliGraphCtx(cwd).dir;
}
