import { Command } from "commander";
import { updateExecutionReport } from "../core/node.js";

export const verdictCommand = new Command("verdict").alias("vd")
  .description("记录节点裁决结论（Super Mario 用）：checkpoint 聚合 + 输出抽查后写入 verification")
  .requiredOption("-i, --id <id>", "节点 ID")
  .requiredOption("--verdict <v>", "pending|passed|failed")
  .option("--note <text>", "裁决说明")
  .action((options) => {
    const rootDir = process.cwd();
    const verdicts = ["pending", "passed", "failed"];
    if (!verdicts.includes(options.verdict)) {
      console.error(`❌ 非法 verdict: ${options.verdict}。允许: ${verdicts.join(", ")}`);
      process.exit(1);
    }
    try {
      const node = updateExecutionReport(rootDir, options.id, {
        verification: {
          verdict: options.verdict,
          checked_at: new Date().toISOString(),
          ...(options.note ? { note: options.note } : {}),
        },
      });
      console.log(
        `✅ ${node.id}: verification=${options.verdict}${options.note ? ` (${options.note})` : ""}`,
      );
    } catch (err: any) {
      if (err?.message?.includes("not found")) {
        console.error(`❌ 节点不存在: ${options.id}`);
      } else {
        console.error(`❌ ${err.message}`);
      }
      process.exit(1);
    }
  });
