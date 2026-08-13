import { Command } from "commander";
import { diffSnapshot, listSnapshots } from "../core/snapshot.js";

export const diffCommand = new Command("diff").alias("d")
  .description("比较拓扑差异（默认：最新快照 → 当前工作区）")
  .option("--from <snapshot-id>", "基线快照（默认最新快照）")
  .option("--to <snapshot-id>", "目标快照（默认当前工作区）")
  .option("--json", "输出稳定 JSON")
  .action((options) => {
    const rootDir = process.cwd();
    try {
      let fromId: string | null = options.from ?? null;
      if (fromId === null && options.to === undefined) {
        // 默认基线 = 最新快照
        const snaps = listSnapshots(rootDir);
        fromId = snaps.length > 0 ? snaps[snaps.length - 1].id : null;
      }
      if (fromId === null && options.to === undefined) {
        console.error(`❌ 没有可用快照，请先运行 graph snapshot 创建基线`);
        process.exit(1);
      }

      const result = diffSnapshot(
        rootDir,
        fromId,
        options.to ?? null,
      );

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`diff: ${result.from} → ${result.to}`);
      console.log(`  新增: ${result.added.length} | 删除: ${result.removed.length} | 修改: ${result.modified.length}`);
      for (const f of result.added) console.log(`  + ${f}`);
      for (const f of result.removed) console.log(`  - ${f}`);
      for (const f of result.modified) console.log(`  ~ ${f}`);
      if (result.status_changes.length > 0) {
        console.log(`\n状态变化:`);
        for (const c of result.status_changes) {
          console.log(`  ${c.node}: ${c.from} → ${c.to}`);
        }
      }
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
