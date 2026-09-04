// src/cli/delete-edge.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析归
// runner（Edge not found 无专属码，走通用 `❌ <message>` 通道，输出不变）。
import { deleteEdge } from "../core/parser.js";
import { defineCommand, type RunContext } from "./runner.js";

export const deleteEdgeCommand = defineCommand("delete-edge").alias("de")
  .description("删除一条边（soft delete，保留 .deleted.yaml 历史）")
  .requiredOption("-i, --id <id>", "要删除的边 ID")
  .action((options: { id: string }, _cmd, ctx: RunContext) => {
    deleteEdge(ctx.rootDir, options.id, { actor: "cli" });
    ctx.out(`✅ 已删除边: ${options.id}`);
  });
