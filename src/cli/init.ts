// src/cli/init.ts
import { Command } from "commander";
import { writeGraph } from "../core/parser.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const initCommand = new Command("init").alias("i")
  .description("在当前目录初始化 .graph/ 结构")
  .option("-l, --label <label>", "图名称", "untitled")
  .option("-f, --force", "已初始化时强制覆盖（慎用，会重置引用列表）")
  .action((options) => {
    const rootDir = process.cwd();
    const graphFile = path.join(rootDir, ".graph", "graph.yaml");
    // 重复 init：默认拒绝（避免静默覆盖已有图的 label/id/引用列表），--force 才覆盖
    if (fs.existsSync(graphFile) && !options.force) {
      console.error(
        `❌ ${graphFile} 已存在，请勿重复初始化（如需重置请加 --force）`,
      );
      process.exit(1);
    }
    const graph = {
      id: `graph_${Date.now()}`,
      version: "0.1.1",
      label: options.label,
      entry: {
        description: "",
        defined_by: "human" as const,
        level: 0,
      },
      exit: {
        description: "",
        acceptance_criteria: [],
        defined_by: "human" as const,
        level: 0,
      },
      nodes: [],
      edges: [],
    };
    writeGraph(rootDir, graph);
    // 完整目录骨架（需求 4.7：nodes/edges/snapshots/index）
    for (const d of ["nodes", "edges", "snapshots", "index"]) {
      fs.mkdirSync(path.join(rootDir, ".graph", d), { recursive: true });
    }
    console.log(`✅ 已初始化 .graph/ 目录: ${rootDir}`);
  });
