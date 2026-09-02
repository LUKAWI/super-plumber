// src/cli/graph-ops.ts — v0.5.2 多图工作区命令：switch / list / rename-graph / delete-graph
// （init 的带名创建在 init.ts）。rename/delete 是破坏性/结构变更操作，仅 CLI 人类通道。
// arch-c2 层次归位：graphDirOf/summarize 实现下沉 core/graph-summary.ts（此前
// mcp/server.ts 反向 import 本文件的层次倒挂随之消除）——本文件只保留命令壳与
// 兼容 re-export（既有 `from "../cli/graph-ops.js"` 消费方不受影响）。
import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  assertValidGraphName,
  listGraphNames,
  readWorkspaceDefault,
  writeWorkspaceDefault,
  readWorkspaceEvents,
  appendWorkspaceEvent,
  trashGraph,
  migrateLegacyLayout,
  didYouMean,
} from "../core/graph-dir.js";
import { cliGraphCtx } from "./graph-ctx.js";

// arch-c2：实现单源在 core/graph-summary.ts；此处 import 供命令消费 + re-export
// 保持既有模块面（`from "../cli/graph-ops.js"` 的消费方不受影响）
import { graphDirOf, summarize } from "../core/graph-summary.js";
export { graphDirOf, summarize };
export type { GraphSummary } from "../core/graph-summary.js";

/** rename/delete 目标不存在时的悬挂提示（查 workspace-events 近期记录） */
function danglingHint(wsRoot: string, name: string): string | null {
  const events = readWorkspaceEvents(wsRoot);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "rename" && e.detail.includes(`graph=${name} ->`)) {
      const to = e.detail.match(/-> ([a-z0-9-]+)/)?.[1] ?? "?";
      return `图 "${name}" 已更名为 "${to}"（${e.ts}）。请用新名操作`;
    }
    if (e.kind === "delete" && e.detail.includes(`graph=${name}`)) {
      return `图 "${name}" 已删除进 .graph/.trash/（${e.ts}，可手工救回）`;
    }
  }
  return null;
}

const SOURCE_LABEL: Record<string, string> = {
  explicit: "--graph 参数",
  env: "SUPER_PLUMBER_GRAPH 环境变量",
  process: "进程内 active",
  active: ".graph/active 工作区默认",
  default: "default 兜底",
};

export const switchCommand = new Command("switch").alias("sw")
  .description("切换工作区默认图（写 .graph/active）；无参显示当前命中的图")
  .argument("[name]", "目标图名")
  .action((name: string | undefined) => {
    const wsRoot = process.cwd();
    try {
      if (name === undefined) {
        // 无参：显示当前命中的图（含来源标注；CLI 无进程内层）
        const cur = cliGraphCtx(wsRoot);
        console.log(`📍 当前图: ${cur.name}（来源: ${SOURCE_LABEL[cur.source]}）`);
        console.log(`   目录: ${cur.dir}`);
        const all = listGraphNames(wsRoot);
        if (all.length > 0) console.log(`   全部图: ${all.join(", ")}`);
        return;
      }
      assertValidGraphName(name);
      const names = listGraphNames(wsRoot);
      if (!names.includes(name)) {
        const hint = didYouMean(name, names);
        console.error(
          `❌ 图 "${name}" 不存在。可用: ${names.join(", ") || "（无）"}` +
            (hint.length ? `（你是想切 ${hint.join(" / ")} 吗？）` : ""),
        );
        process.exit(1);
      }
      // 切换前摘要：原图在途 running 提示（不阻止——认领是节点级状态，切换不影响执行）
      const prevDefault = readWorkspaceDefault(wsRoot) ?? "default";
      if (names.includes(prevDefault) && prevDefault !== name) {
        const prev = summarize(wsRoot, prevDefault);
        if (prev.running > 0) {
          console.log(`⚠️  原默认图 "${prevDefault}" 有 ${prev.running} 个 running 节点在途（切换不影响它们继续执行）`);
        }
      }
      writeWorkspaceDefault(wsRoot, name, "cli");
      const s = summarize(wsRoot, name);
      console.log(`✅ 工作区默认图 → ${name}`);
      console.log(`   ${s.label}｜${s.nodeCount} 节点（running ${s.running} / passed ${s.passed}）｜最近活动 ${s.lastActivity ?? "无"}`);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

export const listGraphsCommand = new Command("list").alias("ls")
  .description("列举工作区全部图（或查指定图详情）")
  .argument("[name]", "图名（缺省列全部）")
  .option("--json", "输出稳定 JSON")
  .action((name: string | undefined, options) => {
    const wsRoot = process.cwd();
    const names = listGraphNames(wsRoot);
    if (names.length === 0) {
      console.error(`❌ ${wsRoot}/.graph/ 下没有任何图，先 graph init <内容名> -l "<显示名>"`);
      process.exit(1);
    }
    const cur = cliGraphCtx(wsRoot);
    try {
      if (name !== undefined) {
        if (!names.includes(name)) {
          console.error(`❌ 图 "${name}" 不存在。可用: ${names.join(", ")}`);
          process.exit(1);
        }
        const s = summarize(wsRoot, name);
        if (options.json) {
          console.log(JSON.stringify({ ...s, isCurrent: name === cur.name, dir: graphDirOf(wsRoot, name) }, null, 2));
        } else {
          console.log(`图: ${s.name}${name === cur.name ? "（当前）" : ""}`);
          console.log(`  显示名: ${s.label}`);
          console.log(`  节点: ${s.nodeCount}（running ${s.running} / passed ${s.passed}）｜边: ${s.edgeCount}`);
          console.log(`  最近活动: ${s.lastActivity ?? "无"}`);
          console.log(`  目录: ${graphDirOf(wsRoot, name)}`);
        }
        return;
      }
      const rows = names.map((n) => {
        const s = summarize(wsRoot, n);
        return { ...s, isCurrent: n === cur.name };
      });
      if (options.json) {
        console.log(JSON.stringify({ current: cur.name, graphs: rows }, null, 2));
        return;
      }
      console.log(`图: ${cur.name}（当前）｜共 ${rows.length} 张`);
      console.log("名                当前  节点  running/passed  最近活动");
      console.log("────────────────  ────  ────  ──────────────  ─────────────────");
      for (const r of rows) {
        console.log(
          `${r.name.padEnd(17)} ${r.isCurrent ? "👉  " : "    "}${String(r.nodeCount).padStart(4)}  ${String(r.running).padStart(2)}/${String(r.passed).padStart(3)}          ${r.lastActivity ?? "无"}`,
        );
      }
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

export const renameGraphCommand = new Command("rename-graph").alias("rg")
  .description("重命名图（rename 目录 + 修正 active + 记审计）；仅 CLI 人类通道")
  .requiredOption("-o, --old <name>", "旧图名")
  .requiredOption("-n, --new <name>", "新图名（内容命名）")
  .action((options) => {
    const wsRoot = process.cwd();
    try {
      assertValidGraphName(options.new);
      const names = listGraphNames(wsRoot);
      if (!names.includes(options.old)) {
        const hint = danglingHint(wsRoot, options.old);
        console.error(
          `❌ 图 "${options.old}" 不存在。可用: ${names.join(", ") || "（无）"}` +
            (hint ? `\n💡 ${hint}` : ""),
        );
        process.exit(1);
      }
      if (names.includes(options.new)) {
        console.error(`❌ 新图名 "${options.new}" 已存在`);
        process.exit(1);
      }
      // 旧布局 default 原地重命名：先迁移成 .graph/default/ 再改目录
      if (options.old === "default" && fs.existsSync(path.join(wsRoot, ".graph", "graph.yaml"))) {
        const moved = migrateLegacyLayout(wsRoot, "cli");
        console.log(`📦 旧布局已迁移至 .graph/default/（${moved.length} 项）`);
      }
      const from = path.join(wsRoot, ".graph", options.old);
      const to = path.join(wsRoot, ".graph", options.new);
      fs.renameSync(from, to);
      // active 修正（直接改文件，rename 事件本身可追溯；不产生 switch 事件噪音）
      if (readWorkspaceDefault(wsRoot) === options.old) {
        fs.writeFileSync(path.join(wsRoot, ".graph", "active"), options.new, "utf-8");
        console.log(`📍 .graph/active 已随迁: ${options.old} → ${options.new}`);
      }
      appendWorkspaceEvent(wsRoot, "rename", `graph=${options.old} -> ${options.new}`, "cli");
      console.log(`✅ 图已重命名: ${options.old} → ${options.new}`);
      console.log(`   ⚠️ 正持有旧名的 MCP 进程下次调用会收到"图不存在+更名提示"`);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

export const deleteGraphCommand = new Command("delete-graph").alias("dg")
  .description("删除图（软删除至 .graph/.trash/<名>-<时间戳>/，可手工救回）；仅 CLI 人类通道")
  .requiredOption("-i, --id <name>", "图名")
  .option("--confirm", "确认删除（缺省拒绝并列出将删除的内容）")
  .action((options) => {
    const wsRoot = process.cwd();
    try {
      const names = listGraphNames(wsRoot);
      if (!names.includes(options.id)) {
        const hint = danglingHint(wsRoot, options.id);
        console.error(
          `❌ 图 "${options.id}" 不存在。可用: ${names.join(", ") || "（无）"}` +
            (hint ? `\n💡 ${hint}` : ""),
        );
        process.exit(1);
      }
      if (names.length === 1) {
        console.error(`❌ 拒绝删除最后一张图（"${options.id}" 是工作区仅剩的图）`);
        process.exit(1);
      }
      const active = readWorkspaceDefault(wsRoot) ?? "default";
      if (options.id === active) {
        console.error(
          `❌ 拒绝删除工作区默认图 "${options.id}"（.graph/active 指向它，删除会让默认图悬挂）。先 graph switch 到别的图`,
        );
        process.exit(1);
      }
      const s = summarize(wsRoot, options.id);
      if (!options.confirm) {
        console.log(`⚠️  将删除图 "${options.id}"（${s.label}）：${s.nodeCount} 节点 / ${s.edgeCount} 边`);
        console.log(`   软删除进 .graph/.trash/（可手工救回）。确认请加 --confirm`);
        process.exit(1);
      }
      const dest = trashGraph(wsRoot, options.id, "cli");
      console.log(`🗑️  图 "${options.id}" 已软删除: ${dest}`);
      console.log(`   救回：把该目录移回 .graph/ 并改名 <图名> 即可（workspace-events 有记录）`);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
