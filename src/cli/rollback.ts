import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { rollbackToSnapshot } from "../core/snapshot.js";

export const rollbackCommand = new Command("rollback").alias("rol")
  .description("回滚到指定快照（自动备份当前状态；必须显式 --confirm）")
  .argument("<snapshot-id>", "目标快照 id（graph snapshots 查看）")
  .option("--confirm", "确认回滚（会覆盖当前 .graph/ 内容）")
  .option(
    "--design-only",
    "只回滚设计态（plan/DoD/checkpoints/label/边/graph.yaml），保留执行进度（status/attempts/execution_report）；快照后新增的节点会被删除",
  )
  .action((snapshotId: string, options) => {
    const rootDir = cliGraphDir(process.cwd());
    try {
      const { restored, backup } = rollbackToSnapshot(rootDir, snapshotId, {
        confirm: !!options.confirm,
        ...(options.designOnly ? { designOnly: true } : {}),
        actor: "cli",
      });
      console.log(`✅ 已回滚到快照: ${restored.id} (${restored.files.length} 个文件)`);
      console.log(`   回滚前状态已备份: ${backup.id}`);
      if (options.designOnly) {
        console.log(`   模式: design-only（执行进度已保留）`);
      }
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
