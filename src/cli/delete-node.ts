// src/cli/delete-node.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析归
// runner（缺失节点由 core 落 NODE_NOT_FOUND，runner 单源渲染）。
import { deleteNode } from "../core/parser.js";
import { defineCommand, type RunContext } from "./runner.js";

export const deleteNodeCommand = defineCommand("delete-node").alias("dn")
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
  .action((options: { id: string; cascade?: boolean; reason?: string }, _cmd, ctx: RunContext) => {
    deleteNode(ctx.rootDir, options.id, {
      cascade: !!options.cascade,
      actor: "cli",
      reason: options.reason,
    });
    ctx.out(`✅ 已删除节点: ${options.id}`);
  });
