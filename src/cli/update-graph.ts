import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { updateGraph } from "../core/parser.js";

export const updateGraphCommand = new Command("update-graph").alias("ug")
  .description("编辑图级字段（label / entry / exit / root_context / fog / class），不再手写 graph.yaml")
  .option("--label <text>", "图名称")
  .option("--entry-desc <text>", "入口(entry)描述")
  .option("--exit-desc <text>", "出口(exit)描述")
  .option(
    "--add-criteria <item>",
    "追加一条验收标准 (可多次使用)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option("--clear-criteria", "清空验收标准列表")
  .option("--set-context <json>", '设置 root_context（JSON 对象，如 {"tech":"ts"}）')
  .option(
    "--set-fog <json>",
    '登记/更新雾区（JSON 对象，如 {"id":"release-automation","description":"...","graduation":"..."}；整体 upsert，毕业走 graduate-fog）',
  )
  .option(
    "--class <class>",
    "工作类标注：quick | standard | program（DEC-2 三级路由的机器可读面）",
  )
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());
    try {
      const params: Parameters<typeof updateGraph>[1] = {};
      if (options.label !== undefined) params.label = options.label;
      if (options.entryDesc !== undefined) params.entry_description = options.entryDesc;
      if (options.exitDesc !== undefined) params.exit_description = options.exitDesc;
      if (options.clearCriteria) params.clear_criteria = true;
      if (options.addCriteria.length > 0) params.add_criteria = options.addCriteria;
      if (options.setContext !== undefined) {
        let ctx: Record<string, unknown>;
        try {
          ctx = JSON.parse(options.setContext);
        } catch {
          console.error(`❌ --set-context 需为合法 JSON 对象: ${options.setContext}`);
          process.exit(1);
        }
        if (typeof ctx !== "object" || ctx === null || Array.isArray(ctx)) {
          console.error(`❌ --set-context 需为 JSON 对象（非数组）`);
          process.exit(1);
        }
        params.root_context = ctx;
      }
      if (options.setFog !== undefined) {
        let fog: Record<string, unknown>;
        try {
          fog = JSON.parse(options.setFog);
        } catch {
          console.error(`❌ --set-fog 需为合法 JSON 对象: ${options.setFog}`);
          process.exit(1);
        }
        if (typeof fog !== "object" || fog === null || Array.isArray(fog)) {
          console.error(`❌ --set-fog 需为 JSON 对象（非数组）`);
          process.exit(1);
        }
        params.fog = fog as unknown as Parameters<typeof updateGraph>[1]["fog"];
      }
      if (options.class !== undefined) {
        if (!["quick", "standard", "program"].includes(options.class)) {
          console.error(`❌ --class 仅允许 quick | standard | program（收到: ${options.class}）`);
          process.exit(1);
        }
        params.class = options.class;
      }
      if (Object.keys(params).length === 0) {
        console.log("⚠️  没有指定任何更新项");
        return;
      }
      const graph = updateGraph(rootDir, params);
      console.log(`✅ 已更新图: ${graph.label}`);
      console.log(`   entry: ${graph.entry.description || "(空)"}`);
      console.log(`   exit: ${graph.exit.description || "(空)"} (${graph.exit.acceptance_criteria.length} 条验收标准)`);
      if (graph.fog !== undefined) {
        console.log(`   fog: ${graph.fog.id}（毕业条件: ${graph.fog.graduation}）`);
      }
      if (graph.class !== undefined) {
        console.log(`   class: ${graph.class}`);
      }
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        console.error(`❌ 未找到 .graph/graph.yaml，请先运行 graph init`);
      } else {
        console.error(`❌ ${err.message}`);
      }
      process.exit(1);
    }
  });
