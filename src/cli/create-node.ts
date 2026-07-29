// src/cli/create-node.ts
import { Command } from "commander";
import { createNode } from "../core/node.js";
import { NodeType } from "../core/types.js";

export const createNodeCommand = new Command("create-node")
  .description("创建新节点")
  .requiredOption("-i, --id <id>", "节点 ID")
  .requiredOption("-l, --label <label>", "节点标签")
  .option("-t, --type <type>", "节点类型", "task")
  .option("--level <level>", "拓扑层级", "1")
  .option("--assigned-to <agent>", "分配给哪个 agent")
  .action((options) => {
    const node = createNode(process.cwd(), {
      id: options.id,
      type: options.type as NodeType,
      label: options.label,
      level: parseInt(options.level, 10),
      assigned_to: options.assignedTo,
    });
    console.log(`✅ 已创建节点: ${node.id} (${node.status})`);
  });
