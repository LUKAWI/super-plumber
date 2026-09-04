// src/cli/runner.ts — arch-c1（C1）：defineCommand 统一命令骨架（单源）
// 职责五件（2026-09-02 架构评审 C1 拍板）：
//   1. 图目录解析：命令 action 内不再各自 cliGraphDir(cliGraphCtx)——runner 统一解析，
//      解析失败（图名拼错/未初始化）与命令体错误走同一出口；
//   2. 枚举校验：assertEnum 单源（此前 6 份 if(!includes){console.error;exit} 手写变体）；
//   3. JSON-文本输出切换：ctx.emit(buildJson, renderText) 单源（此前各命令手写
//      if(options.json){console.log(JSON.stringify(...))}）；
//   4. 错误码 → 退出码映射：EXIT_BY_CODE 单源表，core 六枚 code + CliUsageError
//      统一在此渲染退出（❌ 前缀 / --json 模式 {error} 形状均单源）；
//   5. coerce 摘除 process.exit：coerce.ts 变纯函数，抛 CliUsageError 由本层收口。
// 命令文件因此退化为 flags 声明 + 纯格式化函数：process.exit/console.error 散点删除。
import { Command } from "commander";
import { cliGraphCtx } from "./graph-ctx.js";
import type { ResolvedGraphDir } from "../core/graph-dir.js";
import {
  type ErrorCode,
  isNodeNotFound,
  isWorkspaceNotInitialized,
} from "../core/errors.js";

/** CLI 参数用法错误（coerce/枚举/JSON 形状等入口校验）——渲染同 core 错误，退出码 1 */
export class CliUsageError extends Error {}

/** 单个 CLI 调用的运行上下文（runner 注入给 action 的最后一参） */
export interface RunContext {
  /** 已解析的图目录（工作区级命令 = 工作区根） */
  rootDir: string;
  /** 完整解析结果（name/source/dir）；工作区级命令为 null */
  gctx: ResolvedGraphDir | null;
  /** 是否 --json 模式 */
  json: boolean;
  /** 标准输出行（renderText 内用，替代散点 console.log） */
  out(line: string): void;
  /**
   * JSON-文本输出切换（单源）：json 模式输出 buildJson() 的稳定 JSON；
   * 否则执行 renderText() 的人读渲染。两态互斥，命令内不再手写 if(json)。
   */
  emit(buildJson: () => unknown, renderText: () => void): void;
}

/** 错误码 → 退出码映射（单源表）。当前全部 1 = 行为不变；未来细分在此改表。 */
const EXIT_BY_CODE: Record<ErrorCode, number> = {
  NODE_NOT_FOUND: 1,
  WORKSPACE_NOT_INITIALIZED: 1,
  INVALID_TRANSITION: 1,
  GATE_NOT_SATISFIED: 1,
  ATTEMPTS_EXHAUSTED: 1,
  VALIDATION_FAILED: 1,
};

/**
 * 统一错误出口（单源）：NODE_NOT_FOUND 渲染 `节点不存在: <id>`（原 get-node/
 * update-node/verdict 三份 isNodeNotFound 副本的唯一渲染点，副本已删）；
 * WORKSPACE_NOT_INITIALIZED 的提示语已是 core 单源文案，原样透出；
 * 其余一律 `❌ <message>`。--json 模式统一改输出 {error} 形状（同 status 旧例）。
 */
function fail(err: unknown, json: boolean): never {
  const e = err as (Error & { code?: string; entityId?: string }) | null;
  let message: string;
  if (isNodeNotFound(err)) {
    message = e?.entityId !== undefined ? `节点不存在: ${e.entityId}` : `节点不存在`;
  } else if (isWorkspaceNotInitialized(err)) {
    message = e?.message ?? "工作区未初始化";
  } else {
    message = e?.message ?? String(err);
  }
  if (json) {
    console.log(JSON.stringify({ error: message }, null, 2));
  } else {
    console.error(`❌ ${message}`);
  }
  const code = e?.code as ErrorCode | undefined;
  process.exit(code && code in EXIT_BY_CODE ? EXIT_BY_CODE[code] : 1);
}

/** 枚举字面量校验（单源）：非法即抛 CliUsageError，标准消息形状
 * `非法 <label>: <value>。允许的值: a, b`（verb 可换"允许"，verdict 命令旧文案）。 */
export function assertEnum(
  value: string,
  allowed: readonly string[],
  label: string,
  verb = "允许的值",
): void {
  if (!allowed.includes(value)) {
    throw new CliUsageError(
      `非法 ${label}: ${value}。${verb}: ${allowed.join(", ")}`,
    );
  }
}

/** 枚举字面量校验（自定义消息形状，如 approve/class 的 `仅允许 a | b（收到: x）`）：
 * 只收口抛错通道，消息由调用方按旧文案组装（零输出漂移）。 */
export function assertEnumMsg(ok: boolean, message: string): void {
  if (!ok) throw new CliUsageError(message);
}

export interface DefineCommandOpts {
  /**
   * 工作区级命令（init/switch/list/rename-graph/delete-graph/serve）：
   * 跳过图目录解析——rootDir = 工作区根（process.cwd()），gctx = null。
   * 这些命令自带图名参数或在未初始化工作区上工作，不能走图级解析。
   */
  workspace?: boolean;
}

/**
 * defineCommand：与 new Command(name) 同形，但 .action() 被 runner 包裹——
 * 其余 commander 方法（alias/option/addCommand/...）原样保留，命令文件仍是
 * 纯 flags 声明。action 的最后一参是 RunContext（此前 commander 传入的
 * (…args, options, command) 参数列原样保留在其前方）。
 */
export function defineCommand(name: string, opts: DefineCommandOpts = {}): Command {
  const cmd = new Command(name);
  const rawAction = cmd.action.bind(cmd);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cmd as any).action = (fn: (...args: any[]) => void | Promise<void>) => {
    return rawAction((...args: any[]) => {
      // commander 参数列尾部恒为 (options, command)
      const options = (args[args.length - 2] ?? {}) as Record<string, unknown>;
      const json = options.json === true;
      try {
        const gctx = opts.workspace === true ? null : cliGraphCtx();
        const ctx: RunContext = {
          rootDir: gctx ? gctx.dir : process.cwd(),
          gctx,
          json,
          out: (line: string) => console.log(line),
          emit: (buildJson, renderText) => {
            if (json) {
              console.log(JSON.stringify(buildJson(), null, 2));
              return;
            }
            renderText();
          },
        };
        const r = fn(...args, ctx);
        // 同步 action 直接返回；async action 的 rejection 也归统一出口
        if (r instanceof Promise) return r.catch((err: unknown) => fail(err, json));
        return r;
      } catch (err) {
        return fail(err, json);
      }
    });
  };
  return cmd;
}
