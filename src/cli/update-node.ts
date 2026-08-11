import { Command } from "commander";
import { getNode, updateNodeContent } from "../core/node.js";

export const updateNodeCommand = new Command("update-node").alias("un")
  .description("更新节点的详细内容（plan、expected_outcome、checkpoints 等）")
  .requiredOption("-i, --id <id>", "节点 ID")
  .option("--plan-desc <text>", "设置构建计划描述")
  .option(
    "--add-dod <item>",
    "追加一条完成标准 (可多次使用)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option("--clear-dod", "清空完成标准列表")
  .option(
    "--add-checkpoint <json>",
    '追加一个检查点 (可多次使用, JSON: {"id":"...","label":"..."})',
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option("--set-assigned <agent>", "分配给哪个 agent")
  .option("--show", "显示当前节点内容")
  .action((options) => {
    const rootDir = process.cwd();

    try {
      if (options.show) {
        const node = getNode(rootDir, options.id);
        console.log(JSON.stringify(node, null, 2));
        return;
      }

      const node = getNode(rootDir, options.id);
      const updates: Record<string, any> = {};

      // 更新 plan.description
      if (options.planDesc) {
        updates.plan = {
          ...(node.plan
            ? {
                input_from: node.plan.input_from,
                output_to: node.plan.output_to,
                required_context: node.plan.required_context,
              }
            : {}),
          description: options.planDesc,
        };
      }

      // 更新 expected_outcome
      if (options.clearDod) {
        updates.expected_outcome = { definition_of_done: [] };
      }
      if (options.addDod.length > 0) {
        const existing = node.expected_outcome?.definition_of_done ?? [];
        updates.expected_outcome = {
          ...(node.expected_outcome
            ? { quality_gates: node.expected_outcome.quality_gates }
            : {}),
          definition_of_done: [...existing, ...options.addDod],
        };
      }

      // 更新 assigned_to
      if (options.setAssigned) {
        updates.assigned_to = options.setAssigned;
      }

      // 追加 checkpoint（可多次）
      if (options.addCheckpoint.length > 0) {
        const existing = node.checkpoints ?? [];
        const parsed: { id: string; label: string; status?: string }[] = [];
        for (const raw of options.addCheckpoint) {
          let cp: any;
          try {
            cp = JSON.parse(raw);
          } catch {
            console.error(
              '❌ checkpoint 格式错误，需为 JSON: {"id":"...","label":"..."}',
            );
            process.exit(1);
          }
          // 校验 status 枚举（合法则保留，非法报错，不再静默强制 pending）
          const CP_STATUSES = [
            "pending",
            "running",
            "passed",
            "failed",
            "skipped",
          ];
          if (cp.status !== undefined && !CP_STATUSES.includes(cp.status)) {
            console.error(
              `❌ 非法 checkpoint 状态: ${cp.status}。允许的值: ${CP_STATUSES.join(", ")}`,
            );
            process.exit(1);
          }
          if (!cp.id || !cp.label) {
            console.error(
              '❌ checkpoint 需包含 id 和 label 字段: {"id":"...","label":"..."}',
            );
            process.exit(1);
          }
          parsed.push(cp);
        }
        updates.checkpoints = [
          ...existing,
          ...parsed.map((cp) => ({
            id: cp.id,
            label: cp.label,
            status: cp.status ?? ("pending" as const),
            verifier: "auto" as const,
          })),
        ];
      }

      if (Object.keys(updates).length === 0) {
        console.log("⚠️  没有指定任何更新项");
        return;
      }

      updateNodeContent(rootDir, options.id, updates as any);
      console.log(`✅ 已更新节点: ${options.id}`);
    } catch (err: any) {
      if (err?.message?.includes("not found")) {
        console.error(`❌ 节点不存在: ${options.id}`);
      } else {
        console.error(`❌ ${err.message}`);
      }
      process.exit(1);
    }
  });
