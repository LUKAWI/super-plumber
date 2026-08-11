// src/cli/status.ts
import { Command } from "commander";
import { readGraph } from "../core/parser.js";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import { topologicalSort } from "../core/graph.js";

export const statusCommand = new Command("status").alias("s")
  .description("显示当前拓扑图状态")
  .action(() => {
    const rootDir = process.cwd();
    let graph: ReturnType<typeof readGraph>;
    try {
      graph = readGraph(rootDir);
    } catch {
      console.error(
        `❌ 未找到 ${rootDir}/.graph/graph.yaml，请先运行 graph init`,
      );
      process.exit(1);
    }
    const nodes = listNodes(rootDir);
    const edges = listEdges(rootDir);

    console.log(`图: ${graph.label} (${graph.id})`);
    console.log(`节点数: ${nodes.length}`);
    console.log(`边数: ${edges.length}`);
    console.log(`\n节点状态分布:`);

    const counts = new Map<string, number>();
    for (const n of nodes) {
      counts.set(n.status, (counts.get(n.status) ?? 0) + 1);
    }
    for (const [status, count] of counts) {
      console.log(`  ${status}: ${count}`);
    }

    try {
      const order = topologicalSort(
        nodes.map((n) => n.id),
        edges,
      );
      console.log(`\n✅ 拓扑排序通过 (${order.length} 节点)`);
    } catch (err: any) {
      // 拓扑失败（幽灵边/环）必须非 0 退出，供脚本/CI 判断
      console.error(`\n❌ ${err.message}`);
      process.exit(1);
    }
  });
