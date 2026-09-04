// src/cli/reclaim.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析归
// runner（非 running 回收由 core 落 INVALID_TRANSITION；缺失节点 NODE_NOT_FOUND
// 由 runner 单源渲染 `节点不存在: <id>`）。
import { reclaimNode } from "../core/node.js";
import { defineCommand, type RunContext } from "./runner.js";

export const reclaimCommand = defineCommand("reclaim").alias("rc")
  .description("回收死认领：running → pending（清空执行者并附回收记录）")
  .requiredOption("-i, --id <id>", "节点 ID")
  .option("--by <actor>", "回收操作者（记录进 execution_report.notes）")
  .action((options: { id: string; by?: string }, _cmd, ctx: RunContext) => {
    const node = reclaimNode(ctx.rootDir, options.id, options.by);
    ctx.out(`✅ ${node.id}: running → pending（已回收死认领，可重新调度）`);
  });
