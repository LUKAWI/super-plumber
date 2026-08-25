import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { diffSnapshot, listSnapshots } from "../core/snapshot.js";

export const diffCommand = new Command("diff").alias("d")
  .description("比较拓扑差异（默认：最新快照 → 当前工作区）")
  .option("--from <snapshot-id>", "基线快照（默认最新快照）")
  .option("--to <snapshot-id>", "目标快照（默认当前工作区）")
  .option("--json", "输出稳定 JSON")
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());
    try {
      let fromId: string | null = options.from ?? null;
      // S2-3（f11）：from 缺省一律回填最新快照（与 --help 描述一致）。
      // 此前仅当 --to 也缺省时才回填，`graph diff --to snapX` 实际执行
      // working→snapX 而帮助文本承诺 latest→snapX。无快照时保持 working。
      if (fromId === null) {
        const snaps = listSnapshots(rootDir);
        if (snaps.length > 0) fromId = snaps[snaps.length - 1].id;
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
