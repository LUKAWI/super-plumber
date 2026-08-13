import { Command } from "commander";
import { readGraph } from "../core/parser.js";
import { topologicalSort, detectCycles } from "../core/graph.js";
import { aggregateCheckpointStatus } from "../core/state-machine.js";
import {
  loadNodeFile,
  loadEdgeFile,
  listNodeFileNames,
  listEdgeFileNames,
  SchemaValidationError,
} from "../core/schema.js";
import type { NodeSchema, EdgeSchema, GraphSchema } from "../core/types.js";

export const validateCommand = new Command("validate").alias("v")
  .description("校验整个拓扑图的结构完整性（schema + 引用 + 拓扑 + 环）")
  .option("--json", "输出稳定 JSON（供脚本/agent 消费）")
  .action((options) => {
    const rootDir = process.cwd();
    const jsonMode = !!options.json;
    const jsonErrors: string[] = [];
    const jsonWarnings: string[] = [];
    let errors = 0;
    let warnings = 0;

    const err = (msg: string) => {
      errors++;
      jsonErrors.push(msg);
      if (!jsonMode) console.error(`❌  ${msg}`);
    };
    const warn = (msg: string) => {
      warnings++;
      jsonWarnings.push(msg);
      if (!jsonMode) console.warn(`⚠️  ${msg}`);
    };

    const printResult = (code: number): void => {
      if (jsonMode) {
        console.log(
          JSON.stringify(
            { ok: code === 0, errors: jsonErrors, warnings: jsonWarnings },
            null,
            2,
          ),
        );
      } else {
        console.log(`\n📊 结果: ${errors} 错误, ${warnings} 警告`);
      }
    };

    // 1. 检查图根文件
    let graph: GraphSchema;
    try {
      graph = readGraph(rootDir);
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        err("无法读取 graph.yaml，图未初始化");
      } else if (e instanceof SchemaValidationError) {
        err(`${e.file}: ${e.message}`);
      } else {
        err(`无法读取 graph.yaml: ${e.message}`);
      }
      printResult(1);
      process.exit(1); // 未初始化/schema 损坏必须非 0 退出，供脚本/CI 判断
    }
    if (!graph.entry.description) {
      warn("图入口(entry)描述为空");
    }
    if (!graph.exit.description || graph.exit.acceptance_criteria.length === 0) {
      warn("图出口(exit)验收标准为空");
    }

    // 2. 检查节点（逐文件读取 + schema 校验，单文件损坏不中断其余）
    let nodeFiles: string[];
    try {
      nodeFiles = listNodeFileNames(rootDir);
    } catch (e: any) {
      err(`无法读取 nodes/ 目录: ${e.message}`);
      printResult(1);
      process.exit(1); // 错误路径必须非 0 退出，供脚本/CI 判断
    }
    const nodes: NodeSchema[] = [];
    for (const f of nodeFiles) {
      const r = loadNodeFile(rootDir, f);
      if (r.ok) {
        nodes.push(r.data);
      } else {
        for (const i of r.issues) {
          err(`nodes/${f}: ${i.field}: ${i.message}`);
        }
      }
    }
    if (nodes.length === 0) {
      warn("图中没有节点");
    }
    for (const node of nodes) {
      if (!node.id || !node.label) {
        err("节点缺少 id 或 label");
      }
      if (node.attempts > node.max_attempts) {
        warn(`节点 ${node.id} 已超出最大重试次数 (${node.attempts}/${node.max_attempts})`);
      }
      // checkpoint 聚合态（供裁决 agent 快速判断节点是否可进入完成裁决）
      if (node.checkpoints && node.checkpoints.length > 0) {
        const agg = aggregateCheckpointStatus(node.checkpoints);
        if (!jsonMode) {
          console.log(
            `    · ${node.id} checkpoint 聚合: ${agg} (${node.checkpoints.length} 个)`,
          );
        }
      }
    }
    if (!jsonMode) console.log(`✅  节点: ${nodes.length} 个`);

    // 3. 检查边（逐文件读取 + schema 校验）
    let edgeFiles: string[];
    try {
      edgeFiles = listEdgeFileNames(rootDir);
    } catch (e: any) {
      err(`无法读取 edges/ 目录: ${e.message}`);
      printResult(1);
      process.exit(1); // 错误路径必须非 0 退出，供脚本/CI 判断
    }
    const edges: EdgeSchema[] = [];
    for (const f of edgeFiles) {
      const r = loadEdgeFile(rootDir, f);
      if (r.ok) {
        edges.push(r.data);
      } else {
        for (const i of r.issues) {
          err(`edges/${f}: ${i.field}: ${i.message}`);
        }
      }
    }
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const edge of edges) {
      if (!nodeIds.has(edge.source)) {
        err(`边 ${edge.id} 引用了不存在的源节点: ${edge.source}`);
      }
      if (!nodeIds.has(edge.target)) {
        err(`边 ${edge.id} 引用了不存在的目标节点: ${edge.target}`);
      }
    }
    if (!jsonMode) console.log(`✅  边: ${edges.length} 条`);

    // 4. 拓扑排序 + 循环检测
    if (nodes.length > 1) {
      try {
        const order = topologicalSort(
          nodes.map((n) => n.id),
          edges,
        );
        if (!jsonMode) console.log(`✅  拓扑排序: ${order.length} 节点通过`);
      } catch (e: any) {
        err(`拓扑排序失败: ${e.message}`);
      }

      const cycles = detectCycles(
        nodes.map((n) => n.id),
        edges,
      );
      if (cycles.length > 0) {
        for (const cycle of cycles) {
          err(`检测到循环依赖: ${cycle.join(" → ")}`);
        }
      } else if (!jsonMode) {
        console.log(`✅  循环检测: 无环路`);
      }
    }

    // 5. 引用完整性
    for (const n of graph.nodes) {
      const nid = n.file.replace(/^nodes\//, "").replace(/\.yaml$/, "");
      if (!nodeIds.has(nid)) {
        warn(`graph.yaml 引用了不存在的节点文件: ${n.file}`);
      }
    }
    const edgeFileSet = new Set(edges.map((e) => e.id));
    for (const e of graph.edges) {
      const eid = e.file.replace(/^edges\//, "").replace(/\.yaml$/, "");
      if (!edgeFileSet.has(eid)) {
        warn(`graph.yaml 引用了不存在的边文件: ${e.file}`);
      }
    }

    printResult(errors > 0 ? 1 : 0);
    process.exit(errors > 0 ? 1 : 0);
  });
