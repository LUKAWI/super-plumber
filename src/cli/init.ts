// src/cli/init.ts
import { Command } from "commander";
import { writeGraph } from "../core/parser.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const initCommand = new Command("init")
  .description("在当前目录初始化 .graph/ 结构")
  .option("-l, --label <label>", "图名称", "untitled")
  .action((options) => {
    const rootDir = process.cwd();
    const graph = {
      id: `graph_${Date.now()}`,
      version: "0.1.0",
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
