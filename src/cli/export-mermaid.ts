// src/cli/export-mermaid.ts
import { Command } from "commander";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import * as fs from "node:fs";
import * as path from "node:path";

function statusClass(status: string): string {
  // 与 web-ui/index.html CSS 变量、web-ui/src/lib/types.ts 同一调色板
  const map: Record<string, string> = {
    pending: "fill:#8a8f98,stroke:#5b5f66",
    ready: "fill:#4a93e8,stroke:#2f6fbc",
    running: "fill:#f0a73a,stroke:#c07f1d",
    passed: "fill:#34c964,stroke:#1f9c46",
    failed: "fill:#e5504f,stroke:#b93231",
    blocked: "fill:#a574e6,stroke:#7d4fc0",
    cancelled: "fill:#5b5f66,stroke:#3d4147",
  };
  return map[status] ?? "fill:#8a8f98,stroke:#5b5f66";
}

export const exportMermaidCommand = new Command("export").alias("x")
  .description("导出拓扑图为 Mermaid 流程图")
  .option("--mermaid", "导出为 Mermaid 格式")
  .option("-o, --output <file>", "输出文件路径", "topology.mmd")
  .action((options) => {
    const rootDir = process.cwd();
    const nodes = listNodes(rootDir);
    const edges = listEdges(rootDir);

    let mermaid = "graph TD;\n";
    mermaid += "  %% 节点定义 (按状态着色)\n";

    for (const node of nodes) {
      mermaid += `  ${node.id}["${node.label}"]:::${node.status};\n`;
    }

    mermaid += "\n  %% 边\n";
    for (const edge of edges) {
      const label = edge.type.replace("_", " ");
      mermaid += `  ${edge.source} -->|"${label}"| ${edge.target};\n`;
    }

    mermaid += "\n  %% 样式定义\n";
    const seen = new Set<string>();
    for (const node of nodes) {
      if (!seen.has(node.status)) {
        seen.add(node.status);
        mermaid += `  classDef ${node.status} ${statusClass(node.status)};\n`;
      }
    }

    const outPath = path.resolve(options.output);
    fs.writeFileSync(outPath, mermaid, "utf-8");
    console.log(`✅ 已导出 Mermaid 文件: ${outPath}`);
  });
