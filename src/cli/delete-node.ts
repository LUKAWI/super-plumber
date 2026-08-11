import { Command } from "commander";
import { deleteNode } from "../core/parser.js";

export const deleteNodeCommand = new Command("delete-node").alias("dn")
  .description("删除一个节点（soft delete，保留文件备份）")
  .requiredOption("-i, --id <id>", "要删除的节点 ID")
  .action((options) => {
    const rootDir = process.cwd();
    try {
      deleteNode(rootDir, options.id);
      console.log(`✅ 已删除节点: ${options.id}`);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
