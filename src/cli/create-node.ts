// src/cli/create-node.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析归
// runner。未初始化拒绝（防孤儿节点文件）复用 core workspaceNotInitialized 单源文案
// （"ENOENT 提示六份归一"）；类型枚举校验消费 assertEnum 单源（六份之一）。
import { createNode } from "../core/node.js";
import { NodeType } from "../core/types.js";
import { workspaceNotInitialized } from "../core/errors.js";
import { coerceInt } from "./coerce.js";
import { defineCommand, assertEnum, type RunContext } from "./runner.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const createNodeCommand = defineCommand("create-node").alias("cn")
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
  .action((options: {
    id: string;
    label: string;
    type: string;
    level: string;
    priority?: string;
    context?: string;
    assignedTo?: string;
    planDesc?: string;
    dod: string[];
  }, _cmd, ctx: RunContext) => {
    const rootDir = ctx.rootDir;
    const type = options.type as NodeType;
    assertEnum(type, Object.values(NodeType), "节点类型");
    // 未初始化时拒绝创建（避免写入孤儿节点文件形成半初始化状态）
    // v0.5.2：rootDir 已是图目录——直接检查 graph.yaml 存在性
    if (!fs.existsSync(path.join(rootDir, "graph.yaml"))) {
      throw workspaceNotInitialized(rootDir);
    }
    const node = createNode(rootDir, {
      id: options.id,
      type,
      label: options.label,
      level: coerceInt("--level", options.level, { def: 1, min: 0 }),
      ...(options.priority !== undefined
        ? { priority: coerceInt("--priority", options.priority, { min: 0 }) }
        : {}),
      ...(options.context !== undefined ? { context: options.context } : {}),
      assigned_to: options.assignedTo,
      plan_description: options.planDesc,
      definition_of_done: options.dod.length > 0 ? options.dod : undefined,
    }, { actor: "cli" });
    ctx.out(`✅ 已创建节点: ${node.id} (${node.status})`);
  });
