import { Command } from "commander";
import { getNode, checkReadyGate } from "../core/node.js";
import { getAllowedTransitions, aggregateCheckpointStatus } from "../core/state-machine.js";

export const getNodeCommand = new Command("get-node").alias("gn")
  .description("读取单个节点全部内容（解压压缩包）+ 合法转换 + 门禁状态")
  .requiredOption("-i, --id <id>", "节点 ID")
  .option("--json", "输出稳定 JSON（供脚本/agent 消费）")
  .action((options) => {
    const rootDir = process.cwd();
    try {
      const node = getNode(rootDir, options.id);
      const allowed = getAllowedTransitions(node.status);
      const gate = checkReadyGate(rootDir, node.id);
      const cpAgg = node.checkpoints?.length
        ? aggregateCheckpointStatus(node.checkpoints)
        : null;

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              node,
              allowed_transitions: allowed,
              checkpoint_aggregate: cpAgg,
              ready_gate: gate,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(`节点: ${node.id} (${node.label})`);
      console.log(`类型: ${node.type} | 层级: L${node.level} | 状态: ${node.status}`);
      console.log(`重试: ${node.attempts}/${node.max_attempts}${node.assigned_to ? ` | 执行者: ${node.assigned_to}` : ""}`);
      console.log(`合法转换: [${allowed.join(", ") || "无（终止态）"}]`);
      if (cpAgg !== null) {
        console.log(`checkpoint 聚合: ${cpAgg} (${node.checkpoints!.length} 个)`);
      }
      if (!gate.ok) {
        console.log(
          `⚠️  ready 门禁未满足: ${gate.unmet
            .map((u) => `${u.id}(${u.status}, via ${u.edgeType})`)
            .join(", ")}`,
        );
      }
      if (node.plan?.description) {
        console.log(`\n计划: ${node.plan.description}`);
      }
      if (node.expected_outcome?.definition_of_done?.length) {
        console.log(`完成标准:`);
        for (const d of node.expected_outcome.definition_of_done) {
          console.log(`  - ${d}`);
        }
      }
      if (node.checkpoints?.length) {
        console.log(`检查点:`);
        for (const c of node.checkpoints) {
          console.log(`  [${c.status}] ${c.id}: ${c.label}`);
        }
      }
      if (node.execution_report?.summary) {
        console.log(`\n执行报告: ${node.execution_report.summary}`);
        if (node.execution_report.artifacts?.length) {
          console.log(`产物: ${node.execution_report.artifacts.join(", ")}`);
        }
      }
    } catch (err: any) {
      if (err?.message?.includes("not found")) {
        console.error(`❌ 节点不存在: ${options.id}`);
      } else {
        console.error(`❌ ${err.message}`);
      }
      process.exit(1);
    }
  });
