import { Command } from "commander";
import { getNode, updateNodeContent, buildNodeUpdates } from "../core/node.js";
import { CHECKPOINT_STATUSES } from "../core/checkpoint.js";

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
  .option("--label <text>", "重命名节点标签")
  .option("--max-attempts <n>", "最大重试次数（0 = 不限）")
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

      // 解析 checkpoints（CLI 传 JSON 字符串，逐项校验）
      let checkpoints:
        | { id: string; label: string; status?: never; verifier?: never }[]
        | undefined;
      if (options.addCheckpoint.length > 0) {
        checkpoints = [];
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
          if (cp.status !== undefined && !CHECKPOINT_STATUSES.includes(cp.status)) {
            console.error(
              `❌ 非法 checkpoint 状态: ${cp.status}。允许的值: ${CHECKPOINT_STATUSES.join(", ")}`,
            );
            process.exit(1);
          }
          if (!cp.id || !cp.label) {
            console.error(
              '❌ checkpoint 需包含 id 和 label 字段: {"id":"...","label":"..."}',
            );
            process.exit(1);
          }
          checkpoints.push(cp);
        }
      }

      const updates = buildNodeUpdates(node, {
        ...(options.planDesc !== undefined
          ? { plan_description: options.planDesc }
          : {}),
        ...(options.addDod.length > 0 ? { add_dod: options.addDod } : {}),
        ...(options.clearDod ? { clear_dod: true } : {}),
        ...(checkpoints ? { add_checkpoints: checkpoints } : {}),
        ...(options.setAssigned !== undefined
          ? { set_assigned_to: options.setAssigned }
          : {}),
        ...(options.label !== undefined ? { label: options.label } : {}),
        ...(options.maxAttempts !== undefined
          ? { max_attempts: parseInt(options.maxAttempts, 10) }
          : {}),
      });

      if (Object.keys(updates).length === 0) {
        console.log("⚠️  没有指定任何更新项");
        return;
      }

      updateNodeContent(rootDir, options.id, updates);
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
