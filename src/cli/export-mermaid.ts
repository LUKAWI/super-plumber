// src/cli/export-mermaid.ts
import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import { runDocsExport } from "../core/docs-export.js";
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
  .description("导出拓扑图（默认 Mermaid 流程图；--docs 导出领域知识顶点为 markdown 视图）")
  .option("--mermaid", "导出为 Mermaid 格式")
  .option("--docs", "v0.5：导出知识顶点为 markdown（ADR→docs/adr/，context→CONTEXT-MAP.md + docs/contexts/）")
  .option("--adr-dir <dir>", "--docs 模式：ADR 输出目录", "docs/adr")
  .option("--ctx-dir <dir>", "--docs 模式：context 文档输出目录", "docs/contexts")
  .option("-o, --output <file>", "Mermaid 输出文件路径", "topology.mmd")
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());

    // v0.5 文档视图模式：图为真相源，md 是可重生成的视图
    if (options.docs) {
      const result = runDocsExport(rootDir, {
        adrDir: options.adrDir,
        ctxDir: options.ctxDir,
      });
      console.log(`✅ 导出完成: ${result.adrCount} 篇 ADR, ${result.contextCount} 个 context`);
      for (const f of result.written) console.log(`   · ${f}`);
      if (result.contextCount === 0) {
        console.log(`   （图中无 context 顶点，未生成 CONTEXT-MAP.md；根 CONTEXT.md 手写维护，不受影响）`);
      }
      return;
    }

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
