import { Command } from "commander";
import { cliGraphCtx } from "./graph-ctx.js";
import { updateNodeStatus, getGoverningAdrs } from "../core/node.js";
import { NodeStatus, isKnowledgeType } from "../core/types.js";

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
    "跳过 ready 前置门禁 / max_attempts 拦截（仅人类运维使用，agent 禁用）。" +
      "预算耗尽的 cancelled→pending 重开也走此通道（重开≠重置预算，attempts 保留），留 force_override 审计",
  )
  .action((options) => {
    const gctx = cliGraphCtx(process.cwd());
    const rootDir = gctx.dir;
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
      console.log(`✅ [图 ${gctx.name}] ${options.id}: ${node.status}`);
      // v0.5：claim 时注入管辖 ADR 指针（标题级；agent 按需 get-node 取全文）
      if (status === NodeStatus.Running && !isKnowledgeType(node.type)) {
        const gov = getGoverningAdrs(rootDir, options.id);
        if (gov.current.length > 0) {
          console.log(`📖 管辖 ADR（必读）: ${gov.current.map((g) => `${g.id} ${g.title}`).join(" | ")}`);
        }
        if (gov.superseded.length > 0) {
          console.log(`⚠️  决策依据已过时: ${gov.superseded.map((g) => `${g.id}${g.superseded_by ? `（由 ${g.superseded_by} 接替）` : ""}`).join(" | ")}`);
        }
      }
    } catch (err: any) {
      // S3-9（f16）：删除原 err?.code === "ENOENT" 死分支——getNode（node.ts）
      // 已把文件层 ENOENT 转成无 code 的普通 Error（`Node <id> not found`），
      // 该分支自转化引入起不可达；删除后缺失节点仍走通用分支输出
      // "❌ Node <id> not found"、退出码 1，输出与删除前完全一致。
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
