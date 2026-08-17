import { Command } from "commander";
import { updateNodeStatus } from "../core/node.js";
import { NodeStatus } from "../core/types.js";

export const updateStatusCommand = new Command("update-status").alias("us")
  .description("更新节点状态（状态机校验 + ready 前置门禁）")
  .requiredOption("-i, --id <id>", "节点 ID")
  .requiredOption(
    "-s, --status <status>",
    "新状态: pending|ready|running|passed|failed|blocked|cancelled",
  )
  .option(
    "--claim-by <agent>",
    "认领者（status=running 时记录 assigned_to + started_at）",
  )
  .option(
    "--force",
    "跳过 ready 前置门禁 / max_attempts 拦截（仅人类运维使用，agent 禁用）",
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
      const node = updateNodeStatus(rootDir, options.id, status, options.claimBy, {
        force: !!options.force,
        actor: "cli",
      });
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
