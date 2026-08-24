// src/cli/adr.ts — v0.5 ADR 生命周期命令组
// 提议（create，任何 agent/人）与裁决（accept/supersede，Super Mario/人类）分离：
// 创建即落 proposed；accept/supersede 是裁决动作，事件日志全程留痕。
import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { createAdr, supersedeAdr, updateNodeStatus, listNodes } from "../core/node.js";
import { AdrStatus, NodeType } from "../core/types.js";

export const adrCommand = new Command("adr")
  .description("ADR（架构决策记录）生命周期：create/accept/supersede/list")
  .addCommand(
    new Command("create")
      .description("创建 ADR（自动编号 adr_NNNN，状态落 proposed 待裁决）")
      .requiredOption("-t, --title <title>", "决策标题（落 label）")
      .requiredOption("-d, --decision <text>", "决策内容（我们决定了什么）")
      .option("-b, --background <text>", "背景（决策时的上下文）")
      .option("-o, --options <text>", "考虑过的备选项与取舍（considered_options）")
      .option("-w, --why <text>", "为什么选这个（Why）")
      .option("-c, --consequences <text>", "后果与代价（Consequences）")
      .action((options) => {
        const rootDir = cliGraphDir(process.cwd());
        try {
          const adr = createAdr(
            rootDir,
            {
              title: options.title,
              decision: options.decision,
              ...(options.background !== undefined
                ? { background: options.background }
                : {}),
              ...(options.options !== undefined
                ? { considered_options: options.options }
                : {}),
              ...(options.why !== undefined ? { why: options.why } : {}),
              ...(options.consequences !== undefined
                ? { consequences: options.consequences }
                : {}),
            },
            { actor: "cli" },
          );
          console.log(`✅ 已创建 ADR ${adr.id}: ${adr.label}（proposed，待裁决）`);
          console.log(`   用 graph add-edge --type decides 把它挂到管辖的节点/context 上`);
        } catch (err: any) {
          console.error(`❌ ${err.message}`);
          process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command("accept")
      .description("采纳 ADR（proposed → accepted；裁决方 Super Mario/人类用）")
      .requiredOption("-i, --id <adr_id>", "ADR ID（如 adr_0003）")
      .action((options) => {
        const rootDir = cliGraphDir(process.cwd());
        try {
          const adr = updateNodeStatus(rootDir, options.id, AdrStatus.Accepted, undefined, {
            actor: "cli",
          });
          console.log(`✅ ADR ${adr.id} 已采纳（accepted）`);
        } catch (err: any) {
          console.error(`❌ ${err.message}`);
          process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command("supersede")
      .description("废弃 ADR 并指向接替者（原子：状态 + superseded_by 一步完成）")
      .requiredOption("-i, --id <adr_id>", "要废弃的 ADR ID")
      .requiredOption("--by <adr_id>", "接替者 ADR ID（必填；superseded 必须有接替者）")
      .action((options) => {
        const rootDir = cliGraphDir(process.cwd());
        try {
          const adr = supersedeAdr(rootDir, options.id, options.by, { actor: "cli" });
          console.log(
            `✅ ADR ${adr.id} 已废弃（superseded，接替者 ${adr.superseded_by}）` +
              `——下游 next-actions 将对受影响任务打 adr_flags`,
          );
        } catch (err: any) {
          console.error(`❌ ${err.message}`);
          process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command("list")
      .description("列出 ADR 顶点（默认全部，可按状态过滤）")
      .option("-s, --status <status>", "proposed | accepted | superseded")
      .action((options) => {
        const rootDir = cliGraphDir(process.cwd());
        const adrs = listNodes(rootDir).filter((n) => n.type === NodeType.Adr);
        const filtered =
          options.status !== undefined
            ? adrs.filter((a) => a.status === options.status)
            : adrs;
        if (filtered.length === 0) {
          console.log(options.status ? `（无 ${options.status} 状态的 ADR）` : "（图中没有 ADR）");
          return;
        }
        console.log("ID        状态         标题");
        console.log("────────  ───────────  ──────────────────────────────");
        for (const a of filtered.sort((x, y) => x.id.localeCompare(y.id))) {
          const title = a.superseded_by ? `${a.label}（→ ${a.superseded_by}）` : a.label;
          console.log(
            `${a.id.padEnd(9)} ${String(a.status).padEnd(12)} ${title}`,
          );
        }
      }),
  );
