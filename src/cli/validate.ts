import { Command } from "commander";
import { readGraph } from "../core/parser.js";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import { topologicalSort, detectCycles } from "../core/graph.js";

export const validateCommand = new Command("validate").alias("v")
  .description("校验整个拓扑图的结构完整性")
  .action(() => {
    const rootDir = process.cwd();
    let errors = 0;
    let warnings = 0;

    // 1. 检查图根文件
    try {
      const graph = readGraph(rootDir);
      if (!graph.entry.description) {
        warnings++;
        console.warn(`⚠️  图入口(entry)描述为空`);
      }
      if (
        !graph.exit.description ||
        graph.exit.acceptance_criteria.length === 0
      ) {
        warnings++;
        console.warn(`⚠️  图出口(exit)验收标准为空`);
      }
    } catch {
      errors++;
      console.error(`❌  无法读取 graph.yaml，图未初始化`);
      console.log(`\n📊 结果: ${errors} 错误, ${warnings} 警告`);
      process.exit(1); // 未初始化必须非 0 退出，供脚本/CI 判断
    }

    // 2. 检查节点
    let nodes: ReturnType<typeof listNodes>;
    try {
      nodes = listNodes(rootDir);
    } catch {
      errors++;
      console.error(`❌  无法读取 nodes/ 目录`);
      console.log(`\n📊 结果: ${errors} 错误, ${warnings} 警告`);
      process.exit(1); // 错误路径必须非 0 退出，供脚本/CI 判断
    }

    if (nodes.length === 0) {
      warnings++;
      console.warn(`⚠️  图中没有节点`);
    }

    // 检查每个节点
    for (const node of nodes) {
      if (!node.id || !node.label) {
        errors++;
        console.error(`❌  节点缺少 id 或 label`);
      }
      if (node.attempts > node.max_attempts) {
        warnings++;
        console.warn(
          `⚠️  节点 ${node.id} 已超出最大重试次数 (${node.attempts}/${node.max_attempts})`,
        );
      }
    }
    console.log(`✅  节点: ${nodes.length} 个`);

    // 3. 检查边
    let edges: ReturnType<typeof listEdges>;
    try {
      edges = listEdges(rootDir);
    } catch {
      errors++;
      console.error(`❌  无法读取 edges/ 目录`);
      console.log(`\n📊 结果: ${errors} 错误, ${warnings} 警告`);
      process.exit(1); // 错误路径必须非 0 退出，供脚本/CI 判断
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const edge of edges) {
      if (!nodeIds.has(edge.source)) {
        errors++;
        console.error(`❌  边 ${edge.id} 引用了不存在的源节点: ${edge.source}`);
      }
      if (!nodeIds.has(edge.target)) {
        errors++;
        console.error(
          `❌  边 ${edge.id} 引用了不存在的目标节点: ${edge.target}`,
        );
      }
    }
    console.log(`✅  边: ${edges.length} 条`);

    // 4. 拓扑排序 + 循环检测
    if (nodes.length > 1) {
      try {
        const order = topologicalSort(
          nodes.map((n) => n.id),
          edges,
        );
        console.log(`✅  拓扑排序: ${order.length} 节点通过`);
      } catch (err: any) {
        errors++;
        console.error(`❌  拓扑排序失败: ${err.message}`);
      }

      const cycles = detectCycles(
        nodes.map((n) => n.id),
        edges,
      );
      if (cycles.length > 0) {
        for (const cycle of cycles) {
          errors++;
          console.error(`❌  检测到循环依赖: ${cycle.join(" → ")}`);
        }
      } else {
        console.log(`✅  循环检测: 无环路`);
      }
    }

    // 5. 引用完整性
    const nodeNameSet = new Set(nodes.map((n) => n.id));
    for (const n of readGraph(rootDir).nodes) {
      const nid = n.file.replace(/^nodes\//, "").replace(/\.yaml$/, "");
      if (!nodeNameSet.has(nid)) {
        warnings++;
        console.warn(`⚠️  graph.yaml 引用了不存在的节点文件: ${n.file}`);
      }
    }

    console.log(`\n📊 校验结果: ${errors} 错误, ${warnings} 警告`);
    process.exit(errors > 0 ? 1 : 0);
  });
