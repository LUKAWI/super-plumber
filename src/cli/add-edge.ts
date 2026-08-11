// src/cli/add-edge.ts
import { Command } from "commander";
import { createEdge } from "../core/edge.js";
import { listNodes } from "../core/node.js";
import { EdgeType } from "../core/types.js";

export const addEdgeCommand = new Command("add-edge").alias("ae")
  .description("在节点之间添加边")
  .requiredOption("-i, --id <id>", "边 ID")
  .requiredOption("-s, --source <source>", "源节点 ID")
  .requiredOption("-t, --target <target>", "目标节点 ID")
  .option("--type <type>", "边类型", "depends_on")
  .action((options) => {
    const rootDir = process.cwd();
    const type = options.type as EdgeType;
    if (!Object.values(EdgeType).includes(type)) {
      console.error(
        `❌ 非法边类型: ${options.type}。允许的值: ${Object.values(EdgeType).join(", ")}`,
      );
      process.exit(1);
    }
    const nodeIds = new Set(listNodes(rootDir).map((n) => n.id));
    if (!nodeIds.has(options.source)) {
      console.error(`❌ 源节点不存在: ${options.source}`);
      process.exit(1);
    }
    if (!nodeIds.has(options.target)) {
      console.error(`❌ 目标节点不存在: ${options.target}`);
      process.exit(1);
    }
    try {
      const edge = createEdge(rootDir, {
        id: options.id,
        source: options.source,
        target: options.target,
        type,
      });
      console.log(`✅ 已添加边: ${edge.id} (${edge.source} → ${edge.target})`);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
