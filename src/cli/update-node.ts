import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { getNode, updateNodeContent, buildNodeUpdates } from "../core/node.js";
import { planAmendNudge } from "../core/amend.js";
import { CHECKPOINT_STATUSES } from "../core/checkpoint.js";
import { coerceInt } from "./coerce.js";

// S3-9（f16）：错误分类双通道——结构化 code 优先，message 兜底保持现状行为。
// getNode（node.ts）目前抛无 code 的普通 Error（`Node <id> not found`），
// node.ts 不在 f16 文件边界内，NODE_NOT_FOUND 落地前 message 通道继续兜底。
function isNodeNotFound(err: any): boolean {
  return (
    err?.code === "NODE_NOT_FOUND" ||
    (typeof err?.message === "string" && err.message.includes("not found"))
  );
}

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
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());

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

      // v0.5：解析术语追加（CLI 传 JSON 字符串，逐项校验）
      let glossaryAdd: { term: string; definition: string }[] | undefined;
      if (options.glossaryAdd.length > 0) {
        glossaryAdd = [];
        for (const raw of options.glossaryAdd) {
          let g: any;
          try {
            g = JSON.parse(raw);
          } catch {
            console.error(
              '❌ glossary 格式错误，需为 JSON: {"term":"...","definition":"..."}',
            );
            process.exit(1);
          }
          if (typeof g.term !== "string" || typeof g.definition !== "string") {
            console.error(
              '❌ glossary 需包含 term 和 definition 字符串: {"term":"...","definition":"..."}',
            );
            process.exit(1);
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
            console.error(
              '❌ contract 格式错误，需为 JSON: {"to":"ctx_x","contract":{"produces":"..."}}',
            );
            process.exit(1);
          }
          if (
            typeof d.to !== "string" || d.to === "" ||
            typeof d.contract !== "object" || d.contract === null || Array.isArray(d.contract)
          ) {
            console.error(
              '❌ contract 声明需包含 to（目标 context id）字符串与 contract 对象: {"to":"ctx_x","contract":{...}}',
            );
            process.exit(1);
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
        console.log("⚠️  没有指定任何更新项");
        return;
      }

      updateNodeContent(rootDir, options.id, updates, {
        actor: "cli",
        ...(options.resetAttempts ? { resetAttempts: true } : {}),
      });
      console.log(`✅ 已更新节点: ${options.id}`);
      // F21 (c)（DEC-7 / adr_0006）：改 passed/blocked 节点 plan 的响应 nudge——
      // 纯提示，不改状态、不拦截；与 MCP graph_update_node 共用同一实现（双通道一致）
      const nudge = planAmendNudge(node, { planChanged: options.planDesc !== undefined });
      if (nudge) console.log(nudge);
    } catch (err: any) {
      if (isNodeNotFound(err)) {
        console.error(`❌ 节点不存在: ${options.id}`);
      } else {
        console.error(`❌ ${err.message}`);
      }
      process.exit(1);
    }
  });
