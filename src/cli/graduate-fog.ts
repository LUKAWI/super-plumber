// src/cli/graduate-fog.ts — F05（adr_0007，0.9.0）：雾区毕业（CLI 通道）
// 与 MCP graph_graduate_fog 共用核心原语 graduateFog（实现在 src/core/fog.ts，
// 经 src/core/parser.ts 兼容 re-export——arch-c4a 雾区读/写/警告单家收敛）：
// 清除 graph.yaml 的 fog 字段 + fog_graduated 专用事件 + DEC-7 amend 守卫
// （自动快照 + graph_amended + review 回置）。毕业是事实陈述：无雾时报错。
// arch-c1（C1）全迁：错误/图解析归 runner——原 err.code === "ENOENT" 手写提示
// 已删（"ENOENT 提示六份归一"：readGraph 落 WORKSPACE_NOT_INITIALIZED 单源文案）。
import { graduateFog } from "../core/parser.js";
import { defineCommand, type RunContext } from "./runner.js";

export const graduateFogCommand = defineCommand("graduate-fog")
  .description("雾区毕业：清除图级 fog 字段 + fog_graduated 事件留痕（复用 DEC-7 amend 守卫）")
  .option("--produced <ids>", "毕业产物节点 id 列表（逗号分隔，如 r1,r2——雾想清楚后落成的票/决议）")
  .option("--reason <text>", "毕业理由/结论摘要（审计凭据，缺省不写）")
  .action((options: { produced?: string; reason?: string }, _cmd, ctx: RunContext) => {
    const rootDir = ctx.rootDir;
    const produced = options.produced
      ? String(options.produced)
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
      : undefined;
    const { fog, graph } = graduateFog(
      rootDir,
      { ...(produced ? { produced } : {}), ...(options.reason ? { reason: options.reason } : {}) },
      { actor: "cli" },
    );
    ctx.out(`✅ 雾区已毕业: ${fog.id}（图 ${graph.label}）`);
    if (produced && produced.length > 0) {
      ctx.out(`   毕业产物: ${produced.join(", ")}`);
    }
    if (options.reason) {
      ctx.out(`   结论: ${options.reason}`);
    }
    if (graph.review?.status === "unreviewed") {
      ctx.out(`   ℹ️ 毕业属结构修订：已自动快照并将 review 回置 unreviewed（增量人审提示，零门禁）`);
    }
  });
