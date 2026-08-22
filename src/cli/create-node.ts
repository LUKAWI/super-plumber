// src/cli/create-node.ts
import { Command } from "commander";
import { createNode } from "../core/node.js";
import { NodeType } from "../core/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const createNodeCommand = new Command("create-node").alias("cn")
  .description("创建新节点")
  .requiredOption("-i, --id <id>", "节点 ID")
  .requiredOption("-l, --label <label>", "节点标签")
  .option("-t, --type <type>", "节点类型", "task")
  .option("--level <level>", "拓扑层级", "1")
  .option("--priority <n>", "调度优先级（≥0，越小越先被推荐；缺省最低）")
  .option("--context <ctx_id>", "v0.5：归属的 context 顶点 id（工作流节点用）")
  .option("--assigned-to <agent>", "分配给哪个 agent")
  .option("--plan-desc <text>", "构建计划描述")
  .option(
    "--dod <item>",
    "完成标准 (可多次使用)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .action((options) => {
    const rootDir = process.cwd();
    const type = options.type as NodeType;
    if (!Object.values(NodeType).includes(type)) {
      console.error(
        `❌ 非法节点类型: ${options.type}。允许的值: ${Object.values(NodeType).join(", ")}`,
      );
      process.exit(1);
    }
    // 未初始化时拒绝创建（避免写入孤儿节点文件形成半初始化状态）
    if (!fs.existsSync(path.join(rootDir, ".graph", "graph.yaml"))) {
      console.error(
        `❌ 未找到 ${rootDir}/.graph/graph.yaml，请先运行 graph init`,
      );
      process.exit(1);
    }
    try {
      const node = createNode(rootDir, {
        id: options.id,
        type,
        label: options.label,
        level: parseInt(options.level, 10),
        ...(options.priority !== undefined
          ? { priority: parseInt(options.priority, 10) }
          : {}),
        ...(options.context !== undefined ? { context: options.context } : {}),
        assigned_to: options.assignedTo,
        plan_description: options.planDesc,
        definition_of_done: options.dod.length > 0 ? options.dod : undefined,
      }, { actor: "cli" });
      console.log(`✅ 已创建节点: ${node.id} (${node.status})`);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });
