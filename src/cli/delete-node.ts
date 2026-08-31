import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { deleteNode } from "../core/parser.js";

export const deleteNodeCommand = new Command("delete-node").alias("dn")
  .description("删除一个节点（soft delete，保留文件备份）")
  .requiredOption("-i, --id <id>", "要删除的节点 ID")
  .option(
    "--cascade",
    "连同引用该节点的所有边一起软删除（默认：有引用边时报错拒绝）",
  )
  .option(
    "--reason <text>",
    "删除理由（F14 审计凭据：写入 .deleted.yaml 归档与 node_deleted 事件；缺省不拦截、行为不变）",
  )
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());
    try {
      deleteNode(rootDir, options.id, {
        cascade: !!options.cascade,
        actor: "cli",
        reason: options.reason,
      });
      console.log(`✅ 已删除节点: ${options.id}`);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
