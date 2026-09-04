// src/cli/validate.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析/JSON
// 切换归 runner。
// arch-c3b：validate 编排单源（core/validate.ts）——步骤编排与警告文案正文住 core，
// 本命令只做呈现：错误/警告逐条渲染（加图标前缀，不改写正文）、进度行、退出码语义
// （errors 非空 → exit 1；未初始化/schema 损坏/目录损坏同属 errors，保持非 0 退出）。
import { validateGraphDir } from "../core/validate.js";
import { defineCommand, type RunContext } from "./runner.js";

export const validateCommand = defineCommand("validate").alias("v")
  .description("校验整个拓扑图的结构完整性（schema + 引用 + 拓扑 + 环）")
  .option("--json", "输出稳定 JSON（供脚本/agent 消费）")
  .action((_options: Record<string, unknown>, _cmd, ctx: RunContext) => {
    const r = validateGraphDir(ctx.rootDir);

    ctx.emit(
      // --json 输出形状保持不变（{ok, errors, warnings}），供脚本/agent 消费
      () => ({ ok: r.ok, errors: r.errors, warnings: r.warnings }),
      () => {
        for (const e of r.errors) {
          console.error(`❌  ${e}`);
        }
        for (const w of r.warnings) {
          console.warn(`⚠️  ${w}`);
        }
        // 进度行仅在全流程走完时渲染（提前终止阶段没有对应产出，不渲染假成功行）
        if (r.fatal_stage === null) {
          for (const cs of r.checkpoint_summaries) {
            ctx.out(
              `    · ${cs.node_id} checkpoint 聚合: ${cs.aggregate} (${cs.count} 个)`,
            );
          }
          ctx.out(`✅  节点: ${r.node_count} 个`);
          ctx.out(`✅  边: ${r.edge_count} 条`);
          if (r.node_count > 1) {
            if (r.topo_ok) ctx.out(`✅  拓扑排序: ${r.node_count} 节点通过`);
            if (!r.cycles_found) ctx.out(`✅  循环检测: 无环路`);
          }
        }
        ctx.out(`\n📊 结果: ${r.errors.length} 错误, ${r.warnings.length} 警告`);
      },
    );
    // 未初始化/schema 损坏/目录损坏均含 errors，非 0 退出供脚本/CI 判断
    process.exit(r.ok ? 0 : 1);
  });
