import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { execSync } from "node:child_process";
import { createSnapshot, listSnapshots } from "../core/snapshot.js";

export const snapshotCommand = new Command("snapshot").alias("sp")
  .description("创建当前拓扑的版本快照（.graph/snapshots/<id>/）")
  .option("-m, --message <text>", "快照说明")
  .option("--git", "同时执行 git add .graph && git commit（验收标准 7：Git 快照）")
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());
    try {
      const snap = createSnapshot(rootDir, options.message, { actor: "cli" });
      console.log(`✅ 已创建快照: ${snap.id}`);
      console.log(`   ${snap.files.length} 个文件${snap.message ? ` | ${snap.message}` : ""}`);
      if (options.git) {
        try {
          execSync(`git add .graph && git commit -m "snapshot: ${snap.id}${options.message ? ` — ${options.message}` : ""}"`, {
            cwd: rootDir,
            stdio: "pipe",
          });
          console.log(`   ✅ 已创建 Git commit`);
        } catch (err: any) {
          console.warn(`   ⚠️  Git commit 失败（快照文件已保存）: ${err.stderr ?? err.message}`);
        }
      }
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

export const snapshotsCommand = new Command("snapshots").alias("sps")
  .description("列出全部版本快照")
  .option("--json", "输出稳定 JSON")
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());
    try {
      const snaps = listSnapshots(rootDir);
      if (options.json) {
        console.log(JSON.stringify(snaps, null, 2));
        return;
      }
      if (snaps.length === 0) {
        console.log("（无快照）使用 graph snapshot 创建第一个快照");
        return;
      }
      for (const s of snaps) {
        console.log(
          `${s.id} | ${s.created_at} | ${s.files.length} 文件${s.message ? ` | ${s.message}` : ""}`,
        );
      }
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
