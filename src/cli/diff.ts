// src/cli/diff.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析/JSON 切换
// 归 runner（无可用快照改抛 CliUsageError，消息与拆钩前逐字一致）。
import { diffSnapshot, listSnapshots } from "../core/snapshot.js";
import { defineCommand, CliUsageError, type RunContext } from "./runner.js";

export const diffCommand = defineCommand("diff").alias("d")
  .description("比较拓扑差异（默认：最新快照 → 当前工作区）")
  .option("--from <snapshot-id>", "基线快照（默认最新快照）")
  .option("--to <snapshot-id>", "目标快照（默认当前工作区）")
  .option("--json", "输出稳定 JSON")
  .action((options: { from?: string; to?: string; json?: boolean }, _cmd, ctx: RunContext) => {
    const rootDir = ctx.rootDir;
    let fromId: string | null = options.from ?? null;
    // S2-3（f11）：from 缺省一律回填最新快照（与 --help 描述一致）。
    // 此前仅当 --to 也缺省时才回填，`graph diff --to snapX` 实际执行
    // working→snapX 而帮助文本承诺 latest→snapX。无快照时保持 working。
    if (fromId === null) {
      const snaps = listSnapshots(rootDir);
      if (snaps.length > 0) fromId = snaps[snaps.length - 1].id;
    }
    if (fromId === null && options.to === undefined) {
      throw new CliUsageError(`没有可用快照，请先运行 graph snapshot 创建基线`);
    }

    const result = diffSnapshot(rootDir, fromId, options.to ?? null);

    ctx.emit(
      () => result,
      () => {
        ctx.out(`diff: ${result.from} → ${result.to}`);
        ctx.out(`  新增: ${result.added.length} | 删除: ${result.removed.length} | 修改: ${result.modified.length}`);
        for (const f of result.added) ctx.out(`  + ${f}`);
        for (const f of result.removed) ctx.out(`  - ${f}`);
        for (const f of result.modified) ctx.out(`  ~ ${f}`);
        if (result.status_changes.length > 0) {
          ctx.out(`\n状态变化:`);
          for (const c of result.status_changes) {
            ctx.out(`  ${c.node}: ${c.from} → ${c.to}`);
          }
        }
      },
    );
  });
