// src/cli/update-node.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析归
// runner。原 isNodeNotFound 三副本之一已删（NODE_NOT_FOUND → runner 单源渲染）；
// checkpoint status 枚举校验消费 assertEnum 单源（六份之一）；JSON 形状解析改抛
// CliUsageError（消息与拆钩前逐字一致）。
import { getNode, updateNodeContent, buildNodeUpdates } from "../core/node.js";
import { planAmendNudge } from "../core/amend.js";
import { CHECKPOINT_STATUSES } from "../core/checkpoint.js";
import { coerceInt } from "./coerce.js";
import { defineCommand, assertEnum, CliUsageError, type RunContext } from "./runner.js";

export const updateNodeCommand = defineCommand("update-node").alias("un")
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
  .option("--set-priority <n>", "调度优先级（≥0，越小越先；设置后参与 ready 排序）")
  .option("--set-context <ctx_id>", "v0.5：归属/改归属 context 顶点（空串 \"\" 清除归属）")
  .option("--boundary <text>", "v0.5（context 顶点）：上下文边界描述")
  .option(
    "--glossary-add <json>",
    'v0.5（context 顶点）：追加术语 (可多次使用, JSON: {"term":"...","definition":"..."})',
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option(
    "--contract-add <json>",
    'IL-012（context 顶点）：追加对其他 context 的默认契约声明 (可多次使用, JSON: {"to":"ctx_x","contract":{"produces":"..."}})；跨 context 工作流边自动继承，单边 contract 仍可覆写',
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option(
    "--reset-attempts",
    "显式把 attempts 重置为 0（写入 attempts_reset 审计事件；修改 plan 不再自动重置）",
  )
  .option("--show", "显示当前节点内容")
  .action((options: {
    id: string;
    planDesc?: string;
    addDod: string[];
    clearDod?: boolean;
    addCheckpoint: string[];
    setAssigned?: string;
    label?: string;
    maxAttempts?: string;
    setPriority?: string;
    setContext?: string;
    boundary?: string;
    glossaryAdd: string[];
    contractAdd: string[];
    resetAttempts?: boolean;
    show?: boolean;
  }, _cmd, ctx: RunContext) => {
    const rootDir = ctx.rootDir;

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
          throw new CliUsageError(
            'checkpoint 格式错误，需为 JSON: {"id":"...","label":"..."}',
          );
        }
        // 校验 status 枚举（合法则保留，非法报错，不再静默强制 pending）
        if (cp.status !== undefined) {
          assertEnum(cp.status, CHECKPOINT_STATUSES, "checkpoint 状态");
        }
        if (!cp.id || !cp.label) {
          throw new CliUsageError(
            'checkpoint 需包含 id 和 label 字段: {"id":"...","label":"..."}',
          );
        }
        checkpoints.push(cp);
      }
    }

    // v0.5：解析术语追加（CLI 传 JSON 字符串，逐项校验）
    let glossaryAdd: { term: string; definition: string }[] | undefined;
    if (options.glossaryAdd.length > 0) {
      glossaryAdd = [];
      for (const raw of options.glossaryAdd) {
        let g: any;
        try {
          g = JSON.parse(raw);
        } catch {
          throw new CliUsageError(
            'glossary 格式错误，需为 JSON: {"term":"...","definition":"..."}',
          );
        }
        if (typeof g.term !== "string" || typeof g.definition !== "string") {
          throw new CliUsageError(
            'glossary 需包含 term 和 definition 字符串: {"term":"...","definition":"..."}',
          );
        }
        glossaryAdd.push(g);
      }
    }

    // IL-012：解析契约声明追加（CLI 传 JSON 字符串，逐项校验；to 悬空/contract
    // 形状的深度校验归 schema/domain 层——此处只拦 JSON 结构错误）
    let contractAdd: { to: string; contract: Record<string, unknown> }[] | undefined;
    if (options.contractAdd.length > 0) {
      contractAdd = [];
      for (const raw of options.contractAdd) {
        let d: any;
        try {
          d = JSON.parse(raw);
        } catch {
          throw new CliUsageError(
            'contract 格式错误，需为 JSON: {"to":"ctx_x","contract":{"produces":"..."}}',
          );
        }
        if (
          typeof d.to !== "string" || d.to === "" ||
          typeof d.contract !== "object" || d.contract === null || Array.isArray(d.contract)
        ) {
          throw new CliUsageError(
            'contract 声明需包含 to（目标 context id）字符串与 contract 对象: {"to":"ctx_x","contract":{...}}',
          );
        }
        contractAdd.push(d);
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
        ? { max_attempts: coerceInt("--max-attempts", options.maxAttempts, { min: 0 }) }
        : {}),
      ...(options.setPriority !== undefined
        ? { set_priority: coerceInt("--set-priority", options.setPriority, { min: 0 }) }
        : {}),
      ...(options.setContext !== undefined ? { set_context: options.setContext } : {}),
      ...(options.boundary !== undefined ? { boundary: options.boundary } : {}),
      ...(glossaryAdd !== undefined ? { glossary_add: glossaryAdd } : {}),
      ...(contractAdd !== undefined ? { contract_add: contractAdd } : {}),
    });

    // S1-9：--reset-attempts 单独使用必须生效（MCP 对应 length === 0 && !reset_attempts）
    if (Object.keys(updates).length === 0 && !options.resetAttempts) {
      ctx.out("⚠️  没有指定任何更新项");
      return;
    }

    updateNodeContent(rootDir, options.id, updates, {
      actor: "cli",
      ...(options.resetAttempts ? { resetAttempts: true } : {}),
    });
    ctx.out(`✅ 已更新节点: ${options.id}`);
    // F21 (c)（DEC-7 / adr_0006）：改 passed/blocked 节点 plan 的响应 nudge——
    // 纯提示，不改状态、不拦截；与 MCP graph_update_node 共用同一实现（双通道一致）
    const nudge = planAmendNudge(node, { planChanged: options.planDesc !== undefined });
    if (nudge) ctx.out(nudge);
  });
