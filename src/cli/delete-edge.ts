import { Command } from "commander";
import { deleteEdge } from "../core/parser.js";

export const deleteEdgeCommand = new Command("delete-edge").alias("de")
  .description("删除一条边（soft delete，保留 .deleted.yaml 历史）")
  .requiredOption("-i, --id <id>", "要删除的边 ID")
  .action((options) => {
    const rootDir = process.cwd();
    try {
      deleteEdge(rootDir, options.id, { actor: "cli" });
      console.log(`✅ 已删除边: ${options.id}`);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
