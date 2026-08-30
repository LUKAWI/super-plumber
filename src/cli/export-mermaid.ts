// src/cli/export-mermaid.ts
import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import { readGraph } from "../core/parser.js";
import { runDocsExport } from "../core/docs-export.js";
import type { EdgeSchema, NodeSchema } from "../core/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

/** S3-4（f15）：mermaid label 转义——`"` 会破坏 ["..."] 文本定界、裸换行会破坏行结构。
 * mermaid 语法实体：`#quot;` 表示双引号；换行用 `<br/>`（graph TD 文本节点支持）。 */
export function escapeMermaidLabel(label: string): string {
  return label
    .replace(/\r\n?/g, "\n")
    .replace(/"/g, "#quot;")
    .replace(/\n/g, "<br/>");
}

// ── 0.6.2 导出表达升级：顶点形状/配色、边样式、entry/exit 头注释 ──
// 本文件同时是 Mermaid 与 DOT（rebuild.ts）两侧共用的配色/图例真相源。

/** 图级元信息（仅取 GraphSchema.entry/exit 的描述性字段，结构兼容即可） */
export interface GraphExportMeta {
  entry?: { description?: string };
  exit?: { description?: string; acceptance_criteria?: string[] };
}

export interface ColorPair {
  fill: string;
  stroke: string;
}

/** 工作流七态调色板（与 web-ui/index.html CSS 变量、web-ui/src/lib/types.ts 同一调色板） */
export const WORKFLOW_COLORS: Record<string, ColorPair> = {
  pending: { fill: "#8a8f98", stroke: "#5b5f66" },
  ready: { fill: "#4a93e8", stroke: "#2f6fbc" },
  running: { fill: "#f0a73a", stroke: "#c07f1d" },
  passed: { fill: "#34c964", stroke: "#1f9c46" },
  failed: { fill: "#e5504f", stroke: "#b93231" },
  blocked: { fill: "#a574e6", stroke: "#7d4fc0" },
  cancelled: { fill: "#5b5f66", stroke: "#3d4147" },
};

/** ADR 三态调色板（橙=待裁决 / 绿=生效 / 灰=废弃） */
export const ADR_COLORS: Record<string, ColorPair> = {
  proposed: { fill: "#ffb74d", stroke: "#ef6c00" },
  accepted: { fill: "#81c784", stroke: "#388e3c" },
  superseded: { fill: "#bdbdbd", stroke: "#757575" },
};

/** context 知识顶点（teal） */
export const CONTEXT_COLORS: ColorPair = { fill: "#4db6ac", stroke: "#00897b" };

/** 兜底灰（未知工作流状态、ADR 顶点意外挂工作流状态时防御用） */
export const FALLBACK_COLORS: ColorPair = { fill: "#8a8f98", stroke: "#5b5f66" };

/** 按顶点取配色（mermaid classDef 与 DOT fillcolor/color 同源） */
export function vertexColors(node: { type: string; status: string }): ColorPair {
  if (node.type === "context") return CONTEXT_COLORS;
  if (node.type === "adr") return ADR_COLORS[node.status] ?? FALLBACK_COLORS;
  return WORKFLOW_COLORS[node.status] ?? FALLBACK_COLORS;
}

/** mermaid class 名：工作流=状态本身；context 固定 class；adr=adr_<status> */
export function vertexClass(node: { type: string; status: string }): string {
  if (node.type === "context") return "context";
  if (node.type === "adr") return `adr_${node.status}`;
  return node.status;
}

/** classDef 样式串（按 class 名反查调色板） */
export function classDefStyle(cls: string): string {
  if (cls === "context") return `fill:${CONTEXT_COLORS.fill},stroke:${CONTEXT_COLORS.stroke}`;
  if (cls.startsWith("adr_")) {
    const c = ADR_COLORS[cls.slice("adr_".length)] ?? FALLBACK_COLORS;
    return `fill:${c.fill},stroke:${c.stroke}`;
  }
  const c = WORKFLOW_COLORS[cls] ?? FALLBACK_COLORS;
  return `fill:${c.fill},stroke:${c.stroke}`;
}

export type EdgeStyleKind = "solid-arrow" | "dashed-arrow" | "dotted-open" | "open-link";

/** 边类型 → 样式：decides/fallback/iterates=虚线箭头；relates=点线无箭头；
 * shares_context=无箭头开线；depends_on/validates/fan_out/fan_in 及未知类型=实线箭头。 */
export function mermaidEdgeStyle(type: string): EdgeStyleKind {
  if (type === "decides" || type === "fallback" || type === "iterates") return "dashed-arrow";
  if (type === "relates") return "dotted-open";
  if (type === "shares_context") return "open-link";
  return "solid-arrow";
}

/** 边样式图例（Mermaid/DOT 头注释共用文案） */
export const EDGE_STYLE_LEGEND =
  "decides/fallback/iterates = 虚线箭头；relates = 点线；shares_context = 无箭头实线；其余 = 实线箭头";

/** 头注释安全化：注释不允许跨行，裸换行折叠为空格 */
export function commentSafe(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

function mermaidHeader(meta?: GraphExportMeta): string {
  const lines: string[] = [];
  if (meta?.entry?.description) lines.push(`%% entry: ${commentSafe(meta.entry.description)}`);
  if (meta?.exit?.description) lines.push(`%% exit: ${commentSafe(meta.exit.description)}`);
  const criteria = meta?.exit?.acceptance_criteria ?? [];
  if (criteria.length > 0) {
    lines.push("%% 验收标准:");
    for (const c of criteria) lines.push(`%% - ${commentSafe(c)}`);
  }
  lines.push("%% 边样式图例:");
  lines.push(`%% ${EDGE_STYLE_LEGEND}`);
  return lines.join("\n") + "\n";
}

function mermaidEdgeLine(edge: EdgeSchema): string {
  const label = escapeMermaidLabel(edge.type.replace("_", " "));
  const { source, target } = edge;
  switch (mermaidEdgeStyle(edge.type)) {
    case "dashed-arrow":
      return `  ${source} -.->|"${label}"| ${target};`;
    case "dotted-open":
      return `  ${source} -.-|"${label}"| ${target};`;
    case "open-link":
      return `  ${source} ---|"${label}"| ${target};`;
    default:
      return `  ${source} -->|"${label}"| ${target};`;
  }
}

/** 0.6.2：拼 Mermaid 文本的纯函数（I/O 在 action 里做），形状/配色/头注释可单测锁定 */
export function buildMermaid(
  nodes: NodeSchema[],
  edges: EdgeSchema[],
  meta?: GraphExportMeta,
): string {
  let mermaid = "graph TD;\n";
  mermaid += mermaidHeader(meta);
  mermaid += "  %% 节点定义 (按状态着色)\n";

  for (const node of nodes) {
    const esc = escapeMermaidLabel(node.label);
    if (node.type === "context") {
      // 知识顶点：胶囊形，固定 context class（context 无工作流状态，不接状态色）
      mermaid += `  ${node.id}(["${esc}"]):::context;\n`;
    } else if (node.type === "adr") {
      // 知识顶点：六边形，adr_<status> class（三态调色板；意外状态兜底灰）
      mermaid += `  ${node.id}{{"${esc}"}}:::adr_${node.status};\n`;
    } else {
      mermaid += `  ${node.id}["${esc}"]:::${node.status};\n`;
    }
  }

  mermaid += "\n  %% 边\n";
  for (const edge of edges) {
    mermaid += mermaidEdgeLine(edge) + "\n";
  }

  mermaid += "\n  %% 样式定义\n";
  const seen = new Set<string>();
  for (const node of nodes) {
    const cls = vertexClass(node);
    if (!seen.has(cls)) {
      seen.add(cls);
      mermaid += `  classDef ${cls} ${classDefStyle(cls)};\n`;
    }
  }

  return mermaid;
}

export const exportMermaidCommand = new Command("export").alias("x")
  .description("导出拓扑图（默认 Mermaid 流程图；--docs 导出领域知识顶点为 markdown 视图）")
  .option("--mermaid", "导出为 Mermaid 格式")
  .option("--docs", "v0.5：导出知识顶点为 markdown（ADR→docs/adr/，context→CONTEXT-MAP.md + docs/contexts/）")
  .option(
    "--adr-dir <dir>",
    "--docs 模式：ADR 输出目录（缺省：单图 docs/adr；多图 docs/<图名>/adr，按图名分离互不挤占）",
  )
  .option(
    "--ctx-dir <dir>",
    "--docs 模式：context 文档输出目录（缺省：单图 docs/contexts；多图 docs/<图名>/contexts）",
  )
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

    // 0.6.2：读 graph.yaml 取 entry/exit 做头注释图例；读不到就跳过，不报错
    let graphMeta: GraphExportMeta | undefined;
    try {
      const graph = readGraph(rootDir);
      graphMeta = { entry: graph.entry, exit: graph.exit };
    } catch {
      graphMeta = undefined;
    }

    const mermaid = buildMermaid(nodes, edges, graphMeta);

    const outPath = path.resolve(options.output);
    fs.writeFileSync(outPath, mermaid, "utf-8");
    console.log(`✅ 已导出 Mermaid 文件: ${outPath}`);
  });
