// src/cli/verdict.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析归
// runner。原 isNodeNotFound 三副本之一已删（NODE_NOT_FOUND → runner 单源渲染）；
// verdict 枚举校验消费 assertEnum 单源（六份之一，verb="允许" 保持旧文案）。
import { updateExecutionReport } from "../core/node.js";
import { defineCommand, assertEnum, type RunContext } from "./runner.js";

const VERDICTS = ["pending", "passed", "failed"] as const;

export const verdictCommand = defineCommand("verdict").alias("vd")
  .description("记录节点裁决结论（Super Mario 用）：checkpoint 聚合 + 输出抽查后写入 verification")
  .requiredOption("-i, --id <id>", "节点 ID")
  .requiredOption("--verdict <v>", "pending|passed|failed")
  .option("--note <text>", "裁决说明")
  .action((options: { id: string; verdict: string; note?: string }, _cmd, ctx: RunContext) => {
    assertEnum(options.verdict, VERDICTS, "verdict", "允许");
    const node = updateExecutionReport(ctx.rootDir, options.id, {
      verification: {
        verdict: options.verdict as (typeof VERDICTS)[number],
        checked_at: new Date().toISOString(),
        ...(options.note ? { note: options.note } : {}),
      },
    }, { actor: "cli" });
    ctx.out(
      `✅ ${node.id}: verification=${options.verdict}${options.note ? ` (${options.note})` : ""}`,
    );
  });
