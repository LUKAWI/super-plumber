// src/cli/graduate-fog.ts — F05（adr_0007，0.9.0）：雾区毕业（CLI 通道）
// 与 MCP graph_graduate_fog 共用核心原语 graduateFog（实现在 src/core/fog.ts，
// 经 src/core/parser.ts 兼容 re-export——arch-c4a 雾区读/写/警告单家收敛）：
// 清除 graph.yaml 的 fog 字段 + fog_graduated 专用事件 + DEC-7 amend 守卫
// （自动快照 + graph_amended + review 回置）。毕业是事实陈述：无雾时报错。
import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { graduateFog } from "../core/parser.js";

export const graduateFogCommand = new Command("graduate-fog")
  .description("雾区毕业：清除图级 fog 字段 + fog_graduated 事件留痕（复用 DEC-7 amend 守卫）")
  .option("--produced <ids>", "毕业产物节点 id 列表（逗号分隔，如 r1,r2——雾想清楚后落成的票/决议）")
  .option("--reason <text>", "毕业理由/结论摘要（审计凭据，缺省不写）")
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());
    const produced = options.produced
      ? String(options.produced)
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
      : undefined;
    try {
      const { fog, graph } = graduateFog(
        rootDir,
        { ...(produced ? { produced } : {}), ...(options.reason ? { reason: options.reason } : {}) },
        { actor: "cli" },
      );
      console.log(`✅ 雾区已毕业: ${fog.id}（图 ${graph.label}）`);
      if (produced && produced.length > 0) {
        console.log(`   毕业产物: ${produced.join(", ")}`);
      }
      if (options.reason) {
        console.log(`   结论: ${options.reason}`);
      }
      if (graph.review?.status === "unreviewed") {
        console.log(`   ℹ️ 毕业属结构修订：已自动快照并将 review 回置 unreviewed（增量人审提示，零门禁）`);
      }
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        console.error(`❌ 未找到 .graph/graph.yaml，请先运行 graph init`);
      } else {
        console.error(`❌ ${err.message}`);
      }
      process.exit(1);
    }
  });
