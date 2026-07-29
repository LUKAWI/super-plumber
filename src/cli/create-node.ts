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
  .option("--plan-desc <text>", "构建计划描述")
  .option("--dod <item>", "完成标准 (可多次使用)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .action((options) => {
    const node = createNode(process.cwd(), {
      id: options.id,
      type: options.type as NodeType,
      label: options.label,
      level: parseInt(options.level, 10),
      assigned_to: options.assignedTo,
      plan_description: options.planDesc,
      definition_of_done: options.dod.length > 0 ? options.dod : undefined,
    });
    console.log(`✅ 已创建节点: ${node.id} (${node.status})`);
  });
