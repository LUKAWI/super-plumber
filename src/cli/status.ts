// src/cli/status.ts
import { Command } from "commander";
import { readGraph } from "../core/parser.js";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import { topologicalSort } from "../core/graph.js";

export const statusCommand = new Command("status").alias("s")
  .description("显示当前拓扑图状态")
  .option("--json", "输出稳定 JSON（供脚本/agent 消费）")
  .action((options) => {
    const rootDir = process.cwd();
    let graph: ReturnType<typeof readGraph>;
    try {
      graph = readGraph(rootDir);
    } catch (err: any) {
      if (options.json) {
        console.log(JSON.stringify({ error: err.message }, null, 2));
      } else {
        console.error(
          `❌ 未找到 ${rootDir}/.graph/graph.yaml，请先运行 graph init`,
        );
      }
      process.exit(1);
    }
    const nodes = listNodes(rootDir);
    const edges = listEdges(rootDir);

    const counts: Record<string, number> = {};
    for (const n of nodes) {
      counts[n.status] = (counts[n.status] ?? 0) + 1;
    }

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
            nodes: nodes.length,
            edges: edges.length,
            by_status: counts,
            topo,
          },
          null,
          2,
        ),
      );
      // 拓扑失败（幽灵边/环）必须非 0 退出，供脚本/CI 判断
      process.exit(topo.ok ? 0 : 1);
    }

    console.log(`图: ${graph.label} (${graph.id})`);
    console.log(`节点数: ${nodes.length}`);
    console.log(`边数: ${edges.length}`);
    console.log(`\n节点状态分布:`);
    for (const [status, count] of Object.entries(counts)) {
      console.log(`  ${status}: ${count}`);
    }

    if (topo.ok) {
      console.log(`\n✅ 拓扑排序通过 (${topo.order.length} 节点)`);
    } else {
      console.error(`\n❌ ${topo.error}`);
      process.exit(1);
    }
  });
