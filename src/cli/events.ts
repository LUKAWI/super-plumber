// src/cli/events.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析/JSON
// 切换归 runner（coerceInt 已是纯函数，缺参数抛 CliUsageError 由 runner 收口）。
// FIX-C1：读取 append-only 事件日志（.graph/events.jsonl）。
// 长程任务流排障入口：谁在何时认领/流转/越权/重置/回滚了什么。
import { readEvents } from "../core/eventlog.js";
import { coerceInt } from "./coerce.js";
import { defineCommand, type RunContext } from "./runner.js";

export const eventsCommand = defineCommand("events")
  .description("查看事件日志（创建/删除/状态流转/裁决/快照/回滚/force 越权/attempts 重置）")
  .option("-n, --node <id>", "只看指定节点的事件")
  .option("-k, --kind <kind>", "只看指定类型（node_status/force_override/attempts_reset/...）")
  .option("--last <n>", "只显示最近 N 条", "50")
  .option("--json", "JSON 输出")
  .action((options: { node?: string; kind?: string; last: string }, _cmd, ctx: RunContext) => {
    const last = coerceInt("--last", options.last, { def: 50, min: 0 });
    const all = readEvents(ctx.rootDir, {
      ...(options.node ? { node: options.node } : {}),
      ...(options.kind ? { kind: options.kind } : {}),
    });
    const events = all.slice(-last);

    ctx.emit(
      () => events,
      () => {
        if (events.length === 0) {
          ctx.out("（无匹配事件）");
          return;
        }
        for (const e of events) {
          const where = e.node ? `node=${e.node}` : e.edge ? `edge=${e.edge}` : "";
          const transition = e.from || e.to ? ` ${e.from ?? "?"}→${e.to ?? "?"}` : "";
          const detail = e.detail ? `  (${e.detail})` : "";
          ctx.out(`${e.ts} [${e.actor}] ${e.kind} ${where}${transition}${detail}`);
        }
      },
    );
  });
