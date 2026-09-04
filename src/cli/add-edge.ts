// src/cli/add-edge.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析归
// runner。边类型枚举校验消费 assertEnum 单源（六份之一）；端点存在性预检与
// JSON 契约解析改抛 CliUsageError（消息与拆钩前逐字一致）。
import { createEdge } from "../core/edge.js";
import { listNodes } from "../core/node.js";
import { EdgeType } from "../core/types.js";
import { assertValidEntityId } from "../core/schema.js";
import { defineCommand, assertEnum, CliUsageError, type RunContext } from "./runner.js";

export const addEdgeCommand = defineCommand("add-edge").alias("ae")
  .description("在节点之间添加边")
  .requiredOption("-i, --id <id>", "边 ID")
  .requiredOption("-s, --source <source>", "源节点 ID")
  .requiredOption("-t, --target <target>", "目标节点 ID")
  .option("--type <type>", "边类型", "depends_on")
  .option("--rel-kind <kind>", "v0.5：relates 边的领域关系标注（自由文本）")
  .option(
    "--contract <json>",
    '契约（JSON：{"produces":"...","consumed_by":[...],"validation":{...}}；跨 context 工作流边必填）',
  )
  .action((options: {
    id: string;
    source: string;
    target: string;
    type: string;
    relKind?: string;
    contract?: string;
  }, _cmd, ctx: RunContext) => {
    const rootDir = ctx.rootDir;
    const type = options.type as EdgeType;
    assertEnum(type, Object.values(EdgeType), "边类型");
    let contract: Record<string, unknown> | undefined;
    if (options.contract !== undefined) {
      try {
        contract = JSON.parse(options.contract);
      } catch {
        throw new CliUsageError(`--contract 不是合法 JSON: ${options.contract}`);
      }
    }
    // N1（r0 增补）：ID 格式断言先于存在性预检——穿越形端点应报「非法 ID」
    // 而非误导性的「节点不存在」（核心层 createEdge 也会再断言一次，此处为消息正确性）
    assertValidEntityId("边", options.id);
    assertValidEntityId("边 source", options.source);
    assertValidEntityId("边 target", options.target);
    const nodeIds = new Set(listNodes(rootDir).map((n) => n.id));
    if (!nodeIds.has(options.source)) {
      throw new CliUsageError(`源节点不存在: ${options.source}`);
    }
    if (!nodeIds.has(options.target)) {
      throw new CliUsageError(`目标节点不存在: ${options.target}`);
    }
    const edge = createEdge(rootDir, {
      id: options.id,
      source: options.source,
      target: options.target,
      type,
      ...(contract !== undefined ? { contract: contract as any } : {}),
      ...(options.relKind !== undefined ? { rel_kind: options.relKind } : {}),
    }, { actor: "cli" });
    ctx.out(`✅ 已添加边: ${edge.id} (${edge.source} → ${edge.target})`);
  });
