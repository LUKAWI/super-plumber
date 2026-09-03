// src/cli/approve.ts — DEC-1（g080-approve-core）：设计审核凭据写入（CLI 通道）
// 与 MCP graph_approve 共用核心原语 approveGraph（src/core/review.ts）：
// graph.yaml 的 review 字段 + events.jsonl 的 design_approved 事件。
// F08（0.9.2 渐进审批）：--level 分层批准——program 类图审一层批一层；
// 零新增拒绝规则：任何 class 的图带 --level 照写记录（档位路由是 skill 口径）。
// 红线：review 仅记录、零门禁——不影响任何节点状态机的合法转换。
import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { approveGraph } from "../core/parser.js";

export const approveCommand = new Command("approve")
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
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());
    if (options.status !== "approved" && options.status !== "self") {
      console.error(
        `❌ --status 仅允许 approved | self（收到: ${options.status}）`,
      );
      process.exit(1);
    }
    if (options.level !== undefined && options.level === "") {
      console.error(`❌ --level 需要非空层标（如 L1/L2/...）`);
      process.exit(1);
    }
    try {
      const graph = approveGraph(rootDir, {
        by: options.by,
        status: options.status,
        level: options.level,
      });
      const r = graph.review!;
      console.log(`✅ 已记录审核凭据: ${graph.label}`);
      console.log(`   review: status=${r.status} by=${r.by} at=${r.at}`);
      if (r.status === "self") {
        console.log(`   （self=quick 自签，与人工审核 approved 可区分）`);
      }
      if (r.layers !== undefined) {
        const ls = r.layers.map((l) => `${l.level}(by=${l.by})`).join(" ");
        console.log(`   layers: ${ls}（F08 分层批准，共 ${r.layers.length} 层）`);
      }
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        console.error(`❌ 未找到 .graph/graph.yaml，请先运行 graph init`);
      } else {
        console.error(`❌ ${err.message}`);
      }
      process.exit(1);
    }
  });
