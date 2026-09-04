// src/cli/snapshot.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析/JSON
// 切换归 runner。--git 的 git 部分失败降级为警告（不拦截快照成功），行为不变。
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { workspaceOf } from "../core/graph-dir.js";
import { createSnapshot, listSnapshots } from "../core/snapshot.js";
import { defineCommand, type RunContext } from "./runner.js";

export const snapshotCommand = defineCommand("snapshot").alias("sp")
  .description("创建当前拓扑的版本快照（.graph/snapshots/<id>/）")
  .option("-m, --message <text>", "快照说明")
  .option("--git", "同时执行 git add .graph && git commit（验收标准 7：Git 快照）")
  .action((options: { message?: string; git?: boolean }, _cmd, ctx: RunContext) => {
    const rootDir = ctx.rootDir;
    const snap = createSnapshot(rootDir, options.message, { actor: "cli" });
    ctx.out(`✅ 已创建快照: ${snap.id}`);
    ctx.out(`   ${snap.files.length} 个文件${snap.message ? ` | ${snap.message}` : ""}`);
    if (options.git) {
      try {
        // S0-1：消息经 argv 数组传给 git，不经 shell——用户文本中的元字符只是字面量
        // S0-2：rootDir 是图目录，git 仓库根在工作区级；add 图目录自身（非 .graph/.graph）
        const wsRoot = workspaceOf(rootDir);
        const graphRel = path.relative(wsRoot, rootDir) || ".";
        const msg = `snapshot: ${snap.id}${options.message ? ` — ${options.message}` : ""}`;
        execFileSync("git", ["add", graphRel], { cwd: wsRoot, stdio: "pipe" });
        execFileSync("git", ["commit", "-m", msg], { cwd: wsRoot, stdio: "pipe" });
        ctx.out(`   ✅ 已创建 Git commit`);
      } catch (err: any) {
        console.warn(`   ⚠️  Git commit 失败（快照文件已保存）: ${String(err.stderr ?? err.message)}`);
      }
    }
  });

export const snapshotsCommand = defineCommand("snapshots").alias("sps")
  .description("列出全部版本快照")
  .option("--json", "输出稳定 JSON")
  .action((options: { json?: boolean }, _cmd, ctx: RunContext) => {
    const snaps = listSnapshots(ctx.rootDir);
    ctx.emit(
      () => snaps,
      () => {
        if (snaps.length === 0) {
          ctx.out("（无快照）使用 graph snapshot 创建第一个快照");
          return;
        }
        for (const s of snaps) {
          ctx.out(
            `${s.id} | ${s.created_at} | ${s.files.length} 文件${s.message ? ` | ${s.message}` : ""}`,
          );
        }
      },
    );
  });
