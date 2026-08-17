import { Command } from "commander";
import { deleteNode } from "../core/parser.js";

export const deleteNodeCommand = new Command("delete-node").alias("dn")
  .description("删除一个节点（soft delete，保留文件备份）")
  .requiredOption("-i, --id <id>", "要删除的节点 ID")
  .option(
    "--cascade",
    "连同引用该节点的所有边一起软删除（默认：有引用边时报错拒绝）",
  )
  .action((options) => {
    const rootDir = process.cwd();
    try {
      deleteNode(rootDir, options.id, { cascade: !!options.cascade, actor: "cli" });
      console.log(`✅ 已删除节点: ${options.id}`);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
