import { Command } from "commander";
import { cliGraphCtx } from "./graph-ctx.js";
import { computeNextActions } from "../core/graph.js";
import { coerceInt } from "./coerce.js";

// F09（adr_0017）：死节点读面标注渲染——ready_eligible/blocked 桶条目附
// attempts_exhausted（重试预算耗尽）与 fallback_routes（替代路线）。
// ⚠️ 前缀对齐本仓库 adr_flags/review_flag 的标注渲染习惯（仅提示、零门禁）。
function deadMarks(n: {
  attempts_exhausted?: boolean;
  fallback_routes?: { id: string; label: string }[];
}): string {
  if (!n.attempts_exhausted) return "";
  const parts = ["重试预算耗尽"];
  if (n.fallback_routes?.length) {
    parts.push(
      `fallback 路线: ${n.fallback_routes.map((f) => `${f.id}(${f.label})`).join(", ")}`,
    );
  }
  return ` ⚠️ ${parts.join(" | ")}`;
}

export const nextCommand = new Command("next").alias("n")
  .description("调度决策：列出可认领 / 等依赖 / 执行中 / 疑似卡住的节点")
  .option(
    "--stale-ms <ms>",
    "running 节点无更新阈值（毫秒；缺省基线 30 分钟，requires_human 节点默认放大 8 倍 = 4 小时；显式传值对全部节点生效）",
  )
  .option("--json", "输出稳定 JSON（供脚本/agent 消费）")
  .action((options) => {
    const gctx = cliGraphCtx(process.cwd());
    const rootDir = gctx.dir;
    try {
      // F07：--stale-ms 未显式给出时不透传（undefined）——core 缺省基线生效，
      // requires_human 节点享有人类节奏的放大阈值；显式传值则对全部节点生效
      const result = computeNextActions(rootDir, {
        ...(options.staleMs !== undefined
          ? { staleMs: coerceInt("--stale-ms", options.staleMs, { min: 0 }) }
          : {}),
      });

      if (options.json) {
        console.log(JSON.stringify({ graph: gctx.name, ...result }, null, 2));
        return;
      }
      console.log(`图: ${gctx.name}`);

      const s = result.summary;
      console.log(
        `📊 状态分布: 总 ${s.total} | pending ${s.pending} | ready ${s.ready} | running ${s.running} | passed ${s.passed} | failed ${s.failed} | blocked ${s.blocked} | cancelled ${s.cancelled}`,
      );
      console.log(`\n✅ 可认领 (ready):`);
      if (result.ready.length === 0) console.log(`   （无）`);
      for (const n of result.ready) {
        console.log(`   ${n.id}: ${n.label}${n.waiting_human ? " 🧑 等真人" : ""}`);
      }
      console.log(`\n🔓 可转 ready (门禁已满足):`);
      if (result.ready_eligible.length === 0) console.log(`   （无）`);
      for (const n of result.ready_eligible) {
        console.log(
          `   ${n.id}: ${n.label}${n.waiting_human ? " 🧑 等真人" : ""}${deadMarks(n)}`,
        );
      }
      console.log(`\n⏳ 等依赖 (blocked 候选):`);
      if (result.blocked.length === 0) console.log(`   （无）`);
      for (const n of result.blocked) {
        console.log(
          `   ${n.id}: ${n.label} ← 未满足: ${n.unmet
            .map((u) => `${u.id}(${u.status})`)
            .join(", ")}${deadMarks(n)}`,
        );
      }
      console.log(`\n🏃 执行中 (running):`);
      if (result.running.length === 0) console.log(`   （无）`);
      for (const n of result.running) {
        const mins =
          n.elapsed_ms === null ? "?" : Math.round(n.elapsed_ms / 60000);
        console.log(
          `   ${n.id}: ${n.label} (${n.assigned_to ?? "未认领"}, ${mins} 分钟)`,
        );
      }
      if (result.stale_running.length > 0) {
        console.log(`\n⚠️  疑似卡住 (超过阈值无更新):`);
        for (const n of result.stale_running) {
          console.log(`   ${n.id}: ${n.label} (${Math.round(n.elapsed_ms / 60000)} 分钟)`);
        }
      }
      // v091-verify 交叉验证补口：两类 nudge 此前只在 --json/MCP 面可见，人读面漏渲染
      if (result.class_nudge) {
        console.log(`\n⚠️  ${result.class_nudge}`);
      }
      if (result.fog_graduation_nudge) {
        console.log(`\n⚠️  ${result.fog_graduation_nudge}`);
      }
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
