// src/cli/update-status.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析
// 归 runner。状态枚举校验消费 assertEnum 单源（六份之一）；缺失节点由 core 落
// NODE_NOT_FOUND、runner 单源渲染。
import { updateNodeStatus } from "../core/node.js";
import { buildClaimNudgePackage } from "../core/scheduler.js";
import { NodeStatus, isKnowledgeType } from "../core/types.js";
import { defineCommand, assertEnum, type RunContext } from "./runner.js";

export const updateStatusCommand = defineCommand("update-status").alias("us")
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
  .action((options: {
    id: string;
    status: string;
    claimBy?: string;
    force?: boolean;
  }, _cmd, ctx: RunContext) => {
    const rootDir = ctx.rootDir;
    const status = options.status as NodeStatus;
    assertEnum(status, Object.values(NodeStatus), "状态");
    const node = updateNodeStatus(rootDir, options.id, status, options.claimBy, {
      force: !!options.force,
      actor: "cli",
    });
    ctx.out(`✅ [图 ${ctx.gctx!.name}] ${options.id}: ${node.status}`);
    // arch-c3a：claim 提示包改由 core 单源组装（buildClaimNudgePackage：
    // governing_adrs / adr_flags / review_flag + 0.9.1 requires_human 预留槽位），
    // CLI 只渲染——⚠️ 措辞与调度面 adr_flags / review_flag 同源，零手写变体
    if (status === NodeStatus.Running && !isKnowledgeType(node.type)) {
      const pkg = buildClaimNudgePackage(rootDir, options.id);
      if (pkg.governing_adrs !== undefined && pkg.governing_adrs.current.length > 0) {
        ctx.out(`📖 管辖 ADR（必读）: ${pkg.governing_adrs.current.map((g) => `${g.id} ${g.title}`).join(" | ")}`);
      }
      if (pkg.adr_flags !== undefined) {
        ctx.out(`⚠️  ${pkg.adr_flags.join(" | ")}`);
      }
      if (pkg.review_flag !== undefined) {
        ctx.out(`⚠️  ${pkg.review_flag}`);
      }
    }
  });
