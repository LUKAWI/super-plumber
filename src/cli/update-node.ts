import { Command } from "commander";
import { getNode, updateNodeContent, updateCheckpoint } from "../core/node.js";
import * as fs from "node:fs";

export const updateNodeCommand = new Command("update-node")
  .description("更新节点的详细内容（plan、expected_outcome、checkpoints 等）")
  .requiredOption("-i, --id <id>", "节点 ID")
  .option("--plan-desc <text>", "设置构建计划描述")
  .option("--add-dod <item>", "追加一条完成标准 (definition_of_done)")
  .option("--clear-dod", "清空完成标准列表")
  .option("--add-checkpoint <json>", "追加一个检查点 (JSON: {\"id\":\"...\",\"label\":\"...\"})")
  .option("--set-assigned <agent>", "分配给哪个 agent")
  .option("--show", "显示当前节点内容")
  .action((options) => {
    const rootDir = process.cwd();

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
        ...(node.plan ? { input_from: node.plan.input_from, output_to: node.plan.output_to, required_context: node.plan.required_context } : {}),
        description: options.planDesc,
      };
    }

    // 更新 expected_outcome
    if (options.clearDod) {
      updates.expected_outcome = { definition_of_done: [] };
    }
    if (options.addDod) {
      const existing = node.expected_outcome?.definition_of_done ?? [];
      updates.expected_outcome = {
        ...(node.expected_outcome ? { quality_gates: node.expected_outcome.quality_gates } : {}),
        definition_of_done: [...existing, options.addDod],
      };
    }

    // 更新 assigned_to
    if (options.setAssigned) {
      updates.assigned_to = options.setAssigned;
    }

    // 追加 checkpoint
    if (options.addCheckpoint) {
      let cp: { id: string; label: string };
      try {
        cp = JSON.parse(options.addCheckpoint);
      } catch {
        console.error("❌ checkpoint 格式错误，需为 JSON: {\"id\":\"...\",\"label\":\"...\"}");
        process.exit(1);
      }
      const existing = node.checkpoints ?? [];
      updates.checkpoints = [
        ...existing,
        { id: cp.id, label: cp.label, status: "pending" as const, verifier: "auto" as const },
      ];
    }

    if (Object.keys(updates).length === 0) {
      console.log("⚠️  没有指定任何更新项");
      return;
    }

    updateNodeContent(rootDir, options.id, updates as any);
    console.log(`✅ 已更新节点: ${options.id}`);
  });
