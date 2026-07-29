// src/cli/add-edge.ts
import { Command } from "commander";
import { createEdge } from "../core/edge.js";
import { EdgeType } from "../core/types.js";

export const addEdgeCommand = new Command("add-edge")
  .description("在节点之间添加边")
  .requiredOption("-i, --id <id>", "边 ID")
  .requiredOption("-s, --source <source>", "源节点 ID")
  .requiredOption("-t, --target <target>", "目标节点 ID")
  .option("--type <type>", "边类型", "depends_on")
  .action((options) => {
    const edge = createEdge(process.cwd(), {
      id: options.id,
      source: options.source,
      target: options.target,
      type: options.type as EdgeType,
    });
    console.log(`✅ 已添加边: ${edge.id} (${edge.source} → ${edge.target})`);
  });
