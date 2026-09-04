// src/cli/rollback.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析归
// runner（缺 --confirm / 快照不存在由 core 报错，runner 统一渲染）。
import { rollbackToSnapshot } from "../core/snapshot.js";
import { defineCommand, type RunContext } from "./runner.js";

export const rollbackCommand = defineCommand("rollback").alias("rol")
  .description("回滚到指定快照（自动备份当前状态；必须显式 --confirm）")
  .argument("<snapshot-id>", "目标快照 id（graph snapshots 查看）")
  .option("--confirm", "确认回滚（会覆盖当前 .graph/ 内容）")
  .option(
    "--design-only",
    "只回滚设计态（plan/DoD/checkpoints/label/边/graph.yaml），保留执行进度（status/attempts/execution_report）；快照后新增的节点会被删除",
  )
  .action((snapshotId: string, options: { confirm?: boolean; designOnly?: boolean }, _cmd, ctx: RunContext) => {
    const { restored, backup } = rollbackToSnapshot(ctx.rootDir, snapshotId, {
      confirm: !!options.confirm,
      ...(options.designOnly ? { designOnly: true } : {}),
      actor: "cli",
    });
    ctx.out(`✅ 已回滚到快照: ${restored.id} (${restored.files.length} 个文件)`);
    ctx.out(`   回滚前状态已备份: ${backup.id}`);
    if (options.designOnly) {
      ctx.out(`   模式: design-only（执行进度已保留）`);
    }
  });
