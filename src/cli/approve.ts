// src/cli/approve.ts — DEC-1（g080-approve-core）：设计审核凭据写入（CLI 通道）
// 与 MCP graph_approve 共用核心原语 approveGraph（src/core/review.ts）：
// graph.yaml 的 review 字段 + events.jsonl 的 design_approved 事件。
// F08（0.9.2 渐进审批）：--level 分层批准——program 类图审一层批一层；
// 零新增拒绝规则：任何 class 的图带 --level 照写记录（档位路由是 skill 口径）。
// 红线：review 仅记录、零门禁——不影响任何节点状态机的合法转换。
// arch-c1（C1）全迁：错误/图解析归 runner——原 err.code === "ENOENT" 手写提示
// 已删（"ENOENT 提示六份归一"：readGraph 落 WORKSPACE_NOT_INITIALIZED 单源文案）。
import { approveGraph } from "../core/parser.js";
import { defineCommand, CliUsageError, type RunContext } from "./runner.js";

export const approveCommand = defineCommand("approve")
  .description("写入设计审核凭据（review 字段 + design_approved 事件；仅记录，零门禁）")
  .requiredOption("--by <名>", "审核人（quick 自签 status=self 时填 quick 操作者名）")
  .option(
    "--status <status>",
    "审核状态：approved=人工审核（默认）| self=quick 自签",
    "approved",
  )
  .option(
    "--level <层标>",
    "F08 分层批准层标（如 L1/L2/...）：追加 review.layers 记录，program 类图审一层批一层；缺省=整图凭据",
  )
  .action((options: { by: string; status: string; level?: string }, _cmd, ctx: RunContext) => {
    if (options.status !== "approved" && options.status !== "self") {
      throw new CliUsageError(
        `--status 仅允许 approved | self（收到: ${options.status}）`,
      );
    }
    if (options.level !== undefined && options.level === "") {
      throw new CliUsageError(`--level 需要非空层标（如 L1/L2/...）`);
    }
    const graph = approveGraph(ctx.rootDir, {
      by: options.by,
      status: options.status as "approved" | "self",
      level: options.level,
    });
    const r = graph.review!;
    ctx.out(`✅ 已记录审核凭据: ${graph.label}`);
    ctx.out(`   review: status=${r.status} by=${r.by} at=${r.at}`);
    if (r.status === "self") {
      ctx.out(`   （self=quick 自签，与人工审核 approved 可区分）`);
    }
    if (r.layers !== undefined) {
      const ls = r.layers.map((l) => `${l.level}(by=${l.by})`).join(" ");
      ctx.out(`   layers: ${ls}（F08 分层批准，共 ${r.layers.length} 层）`);
    }
  });
