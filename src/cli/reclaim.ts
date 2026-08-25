import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { reclaimNode } from "../core/node.js";

export const reclaimCommand = new Command("reclaim").alias("rc")
  .description("回收死认领：running → pending（清空执行者并附回收记录）")
  .requiredOption("-i, --id <id>", "节点 ID")
  .option("--by <actor>", "回收操作者（记录进 execution_report.notes）")
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());
    try {
      const node = reclaimNode(rootDir, options.id, options.by);
      console.log(`✅ ${node.id}: running → pending（已回收死认领，可重新调度）`);
    } catch (err: any) {
      // S3-9（f16）：删除原 err?.code === "ENOENT" 死分支——getNode（node.ts）
      // 已把文件层 ENOENT 转成无 code 的普通 Error（`Node <id> not found`），
      // 该分支自转化引入起不可达；删除后缺失节点仍走通用分支输出
      // "❌ Node <id> not found"、退出码 1，输出与删除前完全一致。
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
