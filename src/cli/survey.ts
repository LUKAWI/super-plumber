import { surveyWorkspace, writeSurveyReport } from "../core/graph.js";
import { coerceInt } from "./coerce.js";
import { defineCommand, type RunContext } from "./runner.js";

export const surveyCommand = defineCommand("survey", { workspace: true })
  .description("多图工作区体检：巡检 blocked / stale / ADR 冲突并落临时报告")
  .option(
    "--stale-ms <ms>",
    "running 节点无更新阈值（毫秒；缺省沿用 next 基线）",
  )
  .option("--json", "输出稳定 JSON（供脚本/agent 消费）")
  .action((options: { staleMs?: string }, _cmd, ctx: RunContext) => {
    const report = surveyWorkspace(ctx.rootDir, {
      ...(options.staleMs !== undefined
        ? { staleMs: coerceInt("--stale-ms", options.staleMs, { min: 0 }) }
        : {}),
    });
    const reportPath = writeSurveyReport(report);
    const result = { ...report, report_path: reportPath };
    ctx.emit(
      () => result,
      () => {
        ctx.out(`图体检报告: ${reportPath}`);
        for (const graph of report.graphs) {
          ctx.out(
            `图 ${graph.graph}（${graph.label}）: blocked ${graph.blocked.length} | stale ${graph.stale.length} | ADR 冲突 ${graph.adr_conflicts.length}`,
          );
        }
      },
    );
  });
