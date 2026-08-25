import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { updateExecutionReport } from "../core/node.js";

// S3-9（f16）：错误分类双通道——结构化 code 优先，message 兜底保持现状行为。
// getNode（node.ts）目前抛无 code 的普通 Error（`Node <id> not found`），
// node.ts 不在 f16 文件边界内，NODE_NOT_FOUND 落地前 message 通道继续兜底。
function isNodeNotFound(err: any): boolean {
  return (
    err?.code === "NODE_NOT_FOUND" ||
    (typeof err?.message === "string" && err.message.includes("not found"))
  );
}

export const verdictCommand = new Command("verdict").alias("vd")
  .description("记录节点裁决结论（Super Mario 用）：checkpoint 聚合 + 输出抽查后写入 verification")
  .requiredOption("-i, --id <id>", "节点 ID")
  .requiredOption("--verdict <v>", "pending|passed|failed")
  .option("--note <text>", "裁决说明")
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());
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
      }, { actor: "cli" });
      console.log(
        `✅ ${node.id}: verification=${options.verdict}${options.note ? ` (${options.note})` : ""}`,
      );
    } catch (err: any) {
      if (isNodeNotFound(err)) {
        console.error(`❌ 节点不存在: ${options.id}`);
      } else {
        console.error(`❌ ${err.message}`);
      }
      process.exit(1);
    }
  });
