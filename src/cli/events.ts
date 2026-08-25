// src/cli/events.ts
// FIX-C1：读取 append-only 事件日志（.graph/events.jsonl）。
// 长程任务流排障入口：谁在何时认领/流转/越权/重置/回滚了什么。
import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { readEvents } from "../core/eventlog.js";
import { coerceInt } from "./coerce.js";

export const eventsCommand = new Command("events")
  .description("查看事件日志（创建/删除/状态流转/裁决/快照/回滚/force 越权/attempts 重置）")
  .option("-n, --node <id>", "只看指定节点的事件")
  .option("-k, --kind <kind>", "只看指定类型（node_status/force_override/attempts_reset/...）")
  .option("--last <n>", "只显示最近 N 条", "50")
  .option("--json", "JSON 输出")
  .action((options) => {
    const last = coerceInt("--last", options.last, { def: 50, min: 0 });
    const all = readEvents(cliGraphDir(process.cwd()), {
      ...(options.node ? { node: options.node } : {}),
      ...(options.kind ? { kind: options.kind } : {}),
    });
    const events = all.slice(-last);

    if (options.json) {
      console.log(JSON.stringify(events, null, 2));
      return;
    }
    if (events.length === 0) {
      console.log("（无匹配事件）");
      return;
    }
    for (const e of events) {
      const where = e.node ? `node=${e.node}` : e.edge ? `edge=${e.edge}` : "";
      const transition = e.from || e.to ? ` ${e.from ?? "?"}→${e.to ?? "?"}` : "";
      const detail = e.detail ? `  (${e.detail})` : "";
      console.log(`${e.ts} [${e.actor}] ${e.kind} ${where}${transition}${detail}`);
    }
  });
