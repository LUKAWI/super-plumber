// src/cli/update-graph.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析
// 归 runner。--class 枚举与 JSON 形状校验改抛 CliUsageError（消息与拆钩前逐字
// 一致）；未初始化错误由 readGraph 落 WORKSPACE_NOT_INITIALIZED 单源文案。
import { updateGraph } from "../core/parser.js";
import { GRAPH_CLASSES } from "../core/schema.js";
import { defineCommand, CliUsageError, type RunContext } from "./runner.js";

export const updateGraphCommand = defineCommand("update-graph").alias("ug")
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
    `工作类标注：${GRAPH_CLASSES.join(" | ")}（DEC-2 三级路由的机器可读面）`,
  )
  .option(
    "--by <name>",
    'class 变更的操作者凭据（缺省 "agent"；用户直发 /plumber-class 或对话批准时传 "user"——血统落 class_changed 事件，雾/档矛盾提示据此静默）',
  )
  .action((options: {
    label?: string;
    entryDesc?: string;
    exitDesc?: string;
    addCriteria: string[];
    clearCriteria?: boolean;
    setContext?: string;
    setFog?: string;
    class?: string;
    by?: string;
  }, _cmd, ctx: RunContext) => {
    const rootDir = ctx.rootDir;
    const params: Parameters<typeof updateGraph>[1] = {};
    if (options.label !== undefined) params.label = options.label;
    if (options.entryDesc !== undefined) params.entry_description = options.entryDesc;
    if (options.exitDesc !== undefined) params.exit_description = options.exitDesc;
    if (options.clearCriteria) params.clear_criteria = true;
    if (options.addCriteria.length > 0) params.add_criteria = options.addCriteria;
    if (options.setContext !== undefined) {
      let parsedCtx: Record<string, unknown>;
      try {
        parsedCtx = JSON.parse(options.setContext);
      } catch {
        throw new CliUsageError(`--set-context 需为合法 JSON 对象: ${options.setContext}`);
      }
      if (typeof parsedCtx !== "object" || parsedCtx === null || Array.isArray(parsedCtx)) {
        throw new CliUsageError(`--set-context 需为 JSON 对象（非数组）`);
      }
      params.root_context = parsedCtx;
    }
    if (options.setFog !== undefined) {
      let fog: Record<string, unknown>;
      try {
        fog = JSON.parse(options.setFog);
      } catch {
        throw new CliUsageError(`--set-fog 需为合法 JSON 对象: ${options.setFog}`);
      }
      if (typeof fog !== "object" || fog === null || Array.isArray(fog)) {
        throw new CliUsageError(`--set-fog 需为 JSON 对象（非数组）`);
      }
      params.fog = fog as unknown as Parameters<typeof updateGraph>[1]["fog"];
    }
    if (options.class !== undefined) {
      if (!(GRAPH_CLASSES as readonly string[]).includes(options.class)) {
        throw new CliUsageError(`--class 仅允许 ${GRAPH_CLASSES.join(" | ")}（收到: ${options.class}）`);
      }
      params.class = options.class as (typeof GRAPH_CLASSES)[number];
    }
    if (options.by !== undefined) {
      params.by = options.by;
    }
    if (Object.keys(params).length === 0) {
      ctx.out("⚠️  没有指定任何更新项");
      return;
    }
    const graph = updateGraph(rootDir, params);
    ctx.out(`✅ 已更新图: ${graph.label}`);
    ctx.out(`   entry: ${graph.entry.description || "(空)"}`);
    ctx.out(`   exit: ${graph.exit.description || "(空)"} (${graph.exit.acceptance_criteria.length} 条验收标准)`);
    if (graph.fog !== undefined) {
      ctx.out(`   fog: ${graph.fog.id}（毕业条件: ${graph.fog.graduation}）`);
    }
    if (graph.class !== undefined) {
      // v091：本次带 --class 时回显凭据血统（实际变更落 class_changed 事件，可查 events）
      const byEcho = params.class !== undefined ? `（by=${params.by ?? "agent"}）` : "";
      ctx.out(`   class: ${graph.class}${byEcho}`);
    }
  });
