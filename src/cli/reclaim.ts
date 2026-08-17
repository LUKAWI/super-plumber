import { Command } from "commander";
import { reclaimNode } from "../core/node.js";

export const reclaimCommand = new Command("reclaim").alias("rc")
  .description("回收死认领：running → pending（清空执行者并附回收记录）")
  .requiredOption("-i, --id <id>", "节点 ID")
  .option("--by <actor>", "回收操作者（记录进 execution_report.notes）")
  .action((options) => {
    const rootDir = process.cwd();
    try {
      const node = reclaimNode(rootDir, options.id, options.by);
      console.log(`✅ ${node.id}: running → pending（已回收死认领，可重新调度）`);
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        console.error(`❌ 节点不存在: ${options.id}`);
      } else {
        console.error(`❌ ${err.message}`);
      }
      process.exit(1);
    }
  });
