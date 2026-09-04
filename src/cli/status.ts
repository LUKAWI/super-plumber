// src/cli/status.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析/JSON
// 切换归 runner。未初始化错误已由 core readGraph 落 WORKSPACE_NOT_INITIALIZED
// 单源文案（"ENOENT 提示六份归一"），本文件不再手写 catch 渲染。
import { readGraph } from "../core/parser.js";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import { topologicalSort } from "../core/graph.js";
// arch-c2：状态直方图改消费调度 summary（computeNextActions 单源）——删除本命令
// 手抄的 listNodes 计数直方图，与 graph next --json 的 summary 同一派生
// （工作流七态零填充；知识顶点 context/adr 不参与，与完成判定口径一致）。
import { computeNextActions } from "../core/scheduler.js";
import { NodeStatus } from "../core/types.js";
import { defineCommand, type RunContext } from "./runner.js";

/**
 * F18（0.9.4）单行状态（status --oneline）的字面组装——hooks（session-brief）
 * 与旅程提示的数据源。一行 = 图名 + 进度计数（passed/total 与百分比）+ 前沿
 * （ready）+ 健康度关键计数（running/failed/blocked 零值照排；cancelled 仅
 * 非零出现，保持行短）。口径：调度 summary（七工作流态零填充、知识顶点不参与），
 * 与完整视图同一单源。
 *
 * 注意：MCP 通道（graph_list_graphs 的 oneline 旗标）在 src/mcp/server.ts 里有
 * 一份逐字同构的呈现层副本——文件边界（本任务只许改 status/server.ts/tests/）
 * 不允许下沉 core，也无意恢复 mcp → cli 的层次倒挂 import；双通道逐字等价由
 * tests/oneline.test.ts 金测锁定，改这里必须同步改那边。
 */
export function formatOneline(
  name: string,
  summary: Record<NodeStatus, number> & { total: number },
): string {
  const passed = summary.passed ?? 0;
  const total = summary.total ?? 0;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  const parts = [
    `${name} ${passed}/${total} passed (${pct}%)`,
    `ready ${summary.ready ?? 0}`,
    `running ${summary.running ?? 0}`,
    `failed ${summary.failed ?? 0}`,
    `blocked ${summary.blocked ?? 0}`,
  ];
  if ((summary.cancelled ?? 0) > 0) parts.push(`cancelled ${summary.cancelled}`);
  return parts.join("｜");
}

export const statusCommand = defineCommand("status").alias("s")
  .description("显示当前拓扑图状态")
  .option("--json", "输出稳定 JSON（供脚本/agent 消费）")
  .option(
    "--oneline",
    "单行状态摘要（图名/进度/前沿——hooks 与旅程提示的数据源；轻量读，不做拓扑校验，校验走 validate）",
  )
  .action((options: { oneline?: boolean }, _cmd, ctx: RunContext) => {
    const rootDir = ctx.rootDir;
    const graph = readGraph(rootDir);
    const summary = computeNextActions(rootDir).summary;
    // by_status = 调度 summary 去掉 total（七工作流态，零填充）
    const { total: _total, ...byStatus } = summary;

    // F18 --oneline 文本通道：只出摘要一行（节点/边清单与拓扑校验都跳过——
    // hooks 要的是最便宜的健康度读面；拓扑正确性归 validate）
    if (options.oneline && !ctx.json) {
      ctx.out(formatOneline(ctx.gctx!.name, summary));
      return;
    }

    // 完整视图路径（默认 / --json）：节点/边清单与拓扑校验照旧
    const nodes = listNodes(rootDir);
    const edges = listEdges(rootDir);

    let topo:
      | { ok: true; order: string[] }
      | { ok: false; error: string };
    try {
      topo = {
        ok: true,
        order: topologicalSort(
          nodes.map((n) => n.id),
          edges,
        ),
      };
    } catch (err: any) {
      topo = { ok: false, error: err.message };
    }

    ctx.emit(
      () => ({
        id: graph.id,
        label: graph.label,
        version: graph.version,
        ...(graph.class !== undefined ? { class: graph.class } : {}),
        ...(graph.review !== undefined ? { review: graph.review } : {}),
        ...(graph.fog !== undefined ? { fog: graph.fog } : {}),
        nodes: nodes.length,
        edges: edges.length,
        by_status: byStatus,
        topo,
        // F18 --oneline：JSON 面附加同款字段（oneline 字符串 + workflow 计数），
        // 与 MCP graph_list_graphs {oneline:true} 的附加字段同键同值
        // （workflow = 调度 summary 全量：total + 七工作流态零填充）
        ...(options.oneline
          ? { oneline: formatOneline(ctx.gctx!.name, summary), workflow: summary }
          : {}),
      }),
      () => {
        ctx.out(`图: ${ctx.gctx!.name} — ${graph.label} (${graph.id})`);
        if (graph.class !== undefined) {
          ctx.out(`工作类: ${graph.class}`);
        }
        ctx.out(`节点数: ${nodes.length}`);
        ctx.out(`边数: ${edges.length}`);
        if (graph.fog !== undefined) {
          ctx.out(`\n🌫️ 雾区: ${graph.fog.id} — ${graph.fog.description}`);
          ctx.out(`   毕业条件: ${graph.fog.graduation}`);
          if (graph.fog.ignited && graph.fog.ignited.length > 0) {
            ctx.out(`   已点火: ${graph.fog.ignited.join(", ")}`);
          }
        }
        ctx.out(`\n节点状态分布 (工作流 ${summary.total} 顶点):`);
        for (const status of Object.values(NodeStatus)) {
          const count = summary[status];
          if (count > 0) ctx.out(`  ${status}: ${count}`);
        }

        if (topo.ok) {
          ctx.out(`\n✅ 拓扑排序通过 (${topo.order.length} 节点)`);
        } else {
          // 拓扑失败（幽灵边/环）必须非 0 退出，供脚本/CI 判断（错误行走 stderr，与拆钩前一致）
          console.error(`\n❌ ${topo.error}`);
          process.exit(1);
        }
      },
    );
    // --json 模式：拓扑失败同样非 0 退出（行为与拆钩前一致）
    if (ctx.json && !topo.ok) process.exit(1);
  });
