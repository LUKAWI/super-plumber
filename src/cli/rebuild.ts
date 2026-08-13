import { Command } from "commander";
import { readGraph } from "../core/parser.js";
import { buildGraphIndex } from "../core/graph.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const rebuildCommand = new Command("rebuild").alias("rb")
  .description("从源文件重建 index/ 派生索引（graph.json 完整数据 + meta.json + topology.dot）")
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

    // 重建 graph.json（完整节点/边数据 + 邻接表，供 MCP/Web 新鲜度缓存直接加载）
    const index = buildGraphIndex(rootDir);
    const graphJson = {
      nodes: index.nodes,
      edges: index.edges,
      adjacency: Object.fromEntries(index.adjacency),
      reverseAdj: Object.fromEntries(index.reverseAdj),
    };

    const jsonPath = path.join(indexPath, "graph.json");
    fs.writeFileSync(jsonPath, JSON.stringify(graphJson, null, 2), "utf-8");
    console.log(
      `✅ 已重建: ${jsonPath} (${index.nodes.length} 节点, ${index.edges.length} 边)`,
    );

    // topology.dot（Graphviz 导出，需求 4.7 存储结构）
    const dotPath = path.join(indexPath, "topology.dot");
    const dotLines: string[] = ["digraph topology {"];
    for (const n of index.nodes) {
      dotLines.push(`  "${n.id}" [label="${n.label}\\n${n.status}", shape=box];`);
    }
    for (const e of index.edges) {
      dotLines.push(`  "${e.source}" -> "${e.target}" [label="${e.type}"];`);
    }
    dotLines.push("}");
    fs.writeFileSync(dotPath, dotLines.join("\n") + "\n", "utf-8");
    console.log(`✅ 已重建: ${dotPath}`);

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
