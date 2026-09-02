// src/cli/status.ts
import { Command } from "commander";
import { cliGraphCtx } from "./graph-ctx.js";
import { readGraph } from "../core/parser.js";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import { topologicalSort } from "../core/graph.js";
// arch-c2：状态直方图改消费调度 summary（computeNextActions 单源）——删除本命令
// 手抄的 listNodes 计数直方图，与 graph next --json 的 summary 同一派生
// （工作流七态零填充；知识顶点 context/adr 不参与，与完成判定口径一致）。
import { computeNextActions } from "../core/scheduler.js";
import { NodeStatus } from "../core/types.js";

export const statusCommand = new Command("status").alias("s")
  .description("显示当前拓扑图状态")
  .option("--json", "输出稳定 JSON（供脚本/agent 消费）")
  .action((options) => {
    const gctx = cliGraphCtx(process.cwd());
    const rootDir = gctx.dir;
    let graph: ReturnType<typeof readGraph>;
    try {
      graph = readGraph(rootDir);
    } catch (err: any) {
      if (options.json) {
        console.log(JSON.stringify({ error: err.message }, null, 2));
      } else {
        console.error(
          `❌ 未找到图（${rootDir} 无 graph.yaml），请先运行 graph init <内容名>`,
        );
      }
      process.exit(1);
    }
    const nodes = listNodes(rootDir);
    const edges = listEdges(rootDir);
    const summary = computeNextActions(rootDir).summary;
    // by_status = 调度 summary 去掉 total（七工作流态，零填充）
    const { total: _total, ...byStatus } = summary;

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

    if (options.json) {
      console.log(
        JSON.stringify(
          {
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
          },
          null,
          2,
        ),
      );
      // 拓扑失败（幽灵边/环）必须非 0 退出，供脚本/CI 判断
      process.exit(topo.ok ? 0 : 1);
    }

    console.log(`图: ${gctx.name} — ${graph.label} (${graph.id})`);
    if (graph.class !== undefined) {
      console.log(`工作类: ${graph.class}`);
    }
    console.log(`节点数: ${nodes.length}`);
    console.log(`边数: ${edges.length}`);
    if (graph.fog !== undefined) {
      console.log(`\n🌫️ 雾区: ${graph.fog.id} — ${graph.fog.description}`);
      console.log(`   毕业条件: ${graph.fog.graduation}`);
      if (graph.fog.ignited && graph.fog.ignited.length > 0) {
        console.log(`   已点火: ${graph.fog.ignited.join(", ")}`);
      }
    }
    console.log(`\n节点状态分布 (工作流 ${summary.total} 顶点):`);
    for (const status of Object.values(NodeStatus)) {
      const count = summary[status];
      if (count > 0) console.log(`  ${status}: ${count}`);
    }

    if (topo.ok) {
      console.log(`\n✅ 拓扑排序通过 (${topo.order.length} 节点)`);
    } else {
      console.error(`\n❌ ${topo.error}`);
      process.exit(1);
    }
  });
