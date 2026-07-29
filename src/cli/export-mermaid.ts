// src/cli/export-mermaid.ts
import { Command } from "commander";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import * as fs from "node:fs";
import * as path from "node:path";

function statusClass(status: string): string {
  const map: Record<string, string> = {
    pending: "fill:#94a3b8,stroke:#475569",
    ready: "fill:#3b82f6,stroke:#1d4ed8",
    running: "fill:#f59e0b,stroke:#b45309",
    passed: "fill:#22c55e,stroke:#16a34a",
    failed: "fill:#ef4444,stroke:#dc2626",
    blocked: "fill:#8b5cf6,stroke:#7c3aed",
    cancelled: "fill:#6b7280,stroke:#4b5563",
  };
  return map[status] ?? "fill:#e2e8f0,stroke:#cbd5e1";
}

export const exportMermaidCommand = new Command("export")
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
