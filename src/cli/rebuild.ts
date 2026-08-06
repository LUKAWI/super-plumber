import { Command } from "commander";
import { readGraph } from "../core/parser.js";
import { buildGraphIndex } from "../core/graph.js";
import * as fs from "node:fs";
import * as path from "node:path";
export const rebuildCommand = new Command("rebuild")
  .description("从源文件重建 index/ 派生索引")
  .action(() => {
    const rootDir = process.cwd();

    // 未初始化时直接报错，不自动创建 index/（避免半初始化假成功）
    if (!fs.existsSync(path.join(rootDir, ".graph", "graph.yaml"))) {
      console.error(
        `❌ 未找到 ${rootDir}/.graph/graph.yaml，请先运行 graph init`,
      );
      process.exit(1);
    }

    const indexPath = path.join(rootDir, ".graph", "index");

    // 确保 index/ 目录存在
    fs.mkdirSync(indexPath, { recursive: true });

    // 重建 graph.json
    const index = buildGraphIndex(rootDir);
    const graphJson = {
      nodes: index.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        level: n.level,
        status: n.status,
        assigned_to: n.assigned_to,
        attempts: n.attempts,
        max_attempts: n.max_attempts,
      })),
      edges: index.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
      })),
      adjacency: Object.fromEntries(index.adjacency),
      reverseAdj: Object.fromEntries(index.reverseAdj),
    };

    const jsonPath = path.join(indexPath, "graph.json");
    fs.writeFileSync(jsonPath, JSON.stringify(graphJson, null, 2), "utf-8");
    console.log(
      `✅ 已重建: ${jsonPath} (${index.nodes.length} 节点, ${index.edges.length} 边)`,
    );

    // 尝试读取 graph.yaml 补充信息
    try {
      const graph = readGraph(rootDir);
      const metaPath = path.join(indexPath, "meta.json");
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            id: graph.id,
            version: graph.version,
            label: graph.label,
            entry: graph.entry,
            exit: graph.exit,
          },
          null,
          2,
        ),
        "utf-8",
      );
      console.log(`✅ 已重建: ${metaPath}`);
    } catch {
      console.warn(`⚠️  无法读取 graph.yaml，meta.json 未生成`);
    }

    console.log(`📁 index/ 重建完成`);
  });
