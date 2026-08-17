import { Command } from "commander";
import { rollbackToSnapshot } from "../core/snapshot.js";

export const rollbackCommand = new Command("rollback").alias("rol")
  .description("回滚到指定快照（自动备份当前状态；必须显式 --confirm）")
  .argument("<snapshot-id>", "目标快照 id（graph snapshots 查看）")
  .option("--confirm", "确认回滚（会覆盖当前 .graph/ 内容）")
  .action((snapshotId: string, options) => {
    const rootDir = process.cwd();
    try {
      const { restored, backup } = rollbackToSnapshot(rootDir, snapshotId, {
        confirm: !!options.confirm,
        actor: "cli",
      });
      console.log(`✅ 已回滚到快照: ${restored.id} (${restored.files.length} 个文件)`);
      console.log(`   回滚前状态已备份: ${backup.id}`);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
