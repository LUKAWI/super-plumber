import { Command } from "commander";
import { updateNodeStatus } from "../core/node.js";
import { NodeStatus } from "../core/types.js";

export const updateStatusCommand = new Command("update-status")
  .description("更新节点状态（状态机校验）")
  .requiredOption("-i, --id <id>", "节点 ID")
  .requiredOption(
    "-s, --status <status>",
    "新状态: pending|ready|running|passed|failed|blocked|cancelled",
  )
  .action((options) => {
    const rootDir = process.cwd();
    const status = options.status as NodeStatus;
    if (!Object.values(NodeStatus).includes(status)) {
      console.error(
        `❌ 非法状态: ${options.status}。允许的值: ${Object.values(NodeStatus).join(", ")}`,
      );
      process.exit(1);
    }
    try {
      const node = updateNodeStatus(rootDir, options.id, status);
      console.log(`✅ ${options.id}: ${node.status}`);
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        console.error(`❌ 节点不存在: ${options.id}`);
      } else {
        console.error(`❌ ${err.message}`);
      }
      process.exit(1);
    }
  });
