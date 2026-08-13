import { Command } from "commander";
import { computeNextActions } from "../core/graph.js";

export const nextCommand = new Command("next").alias("n")
  .description("调度决策：列出可认领 / 等依赖 / 执行中 / 疑似卡住的节点")
  .option(
    "--stale-ms <ms>",
    "running 节点无更新阈值（毫秒，默认 1800000 = 30 分钟）",
    "1800000",
  )
  .option("--json", "输出稳定 JSON（供脚本/agent 消费）")
  .action((options) => {
    const rootDir = process.cwd();
    try {
      const result = computeNextActions(rootDir, {
        staleMs: parseInt(options.staleMs, 10),
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const s = result.summary;
      console.log(
        `📊 状态分布: 总 ${s.total} | pending ${s.pending} | ready ${s.ready} | running ${s.running} | passed ${s.passed} | failed ${s.failed} | blocked ${s.blocked} | cancelled ${s.cancelled}`,
      );
      console.log(`\n✅ 可认领 (ready):`);
      if (result.ready.length === 0) console.log(`   （无）`);
      for (const n of result.ready) console.log(`   ${n.id}: ${n.label}`);
      console.log(`\n⏳ 等依赖 (blocked 候选):`);
      if (result.blocked.length === 0) console.log(`   （无）`);
      for (const n of result.blocked) {
        console.log(
          `   ${n.id}: ${n.label} ← 未满足: ${n.unmet
            .map((u) => `${u.id}(${u.status})`)
            .join(", ")}`,
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
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
