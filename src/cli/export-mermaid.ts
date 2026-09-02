// src/cli/export-mermaid.ts
import { Command } from "commander";
import { cliGraphDir } from "./graph-ctx.js";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import { readGraph } from "../core/parser.js";
import { runDocsExport, checkDocsExport } from "../core/docs-export.js";
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
  passed: { fill: "#16a34a", stroke: "#0e7a37" },
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

/** 单个顶点定义行（不带缩进前缀，平铺/分期带两种布局共用同一形状映射） */
function mermaidNodeLine(node: NodeSchema): string {
  const esc = escapeMermaidLabel(node.label);
  if (node.type === "context") {
    // 知识顶点：胶囊形，固定 context class（context 无工作流状态，不接状态色）
    return `${node.id}(["${esc}"]):::context;`;
  } else if (node.type === "adr") {
    // 知识顶点：六边形，adr_<status> class（三态调色板；意外状态兜底灰）
    return `${node.id}{{"${esc}"}}:::adr_${node.status};`;
  }
  return `${node.id}["${esc}"]:::${node.status};`;
}

/** 知识顶点判定：context/ADR 是横切领域知识，不进 level 分期带（IL-004） */
function isKnowledgeNode(node: NodeSchema): boolean {
  return node.type === "context" || node.type === "adr";
}

/** id 升序比较器：分期带布局的显式稳定排序（Git diff 噪音可控） */
function byId(a: NodeSchema, b: NodeSchema): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** IL-004：分期带选项（缺省全空 = 保持平铺现状，向后兼容） */
export interface MermaidBandOptions {
  /** 按 level 分期带生成 subgraph 分组 */
  groupByLevel?: boolean;
  /** level → 分期域名（组名显示 `L<n> · 域名`；缺省只显示 `L<n>`） */
  bandNames?: Record<number, string>;
}

/** 0.6.2：拼 Mermaid 文本的纯函数（I/O 在 action 里做），形状/配色/头注释可单测锁定。
 * IL-004：options.groupByLevel 开启后按 level 分期带生成 subgraph 分组——
 * 知识顶点横切不入带；带升序、带内按 id 排序（稳定输出，diff 噪音可控）。 */
export function buildMermaid(
  nodes: NodeSchema[],
  edges: EdgeSchema[],
  meta?: GraphExportMeta,
  options?: MermaidBandOptions,
): string {
  const grouped = options?.groupByLevel === true;
  let mermaid = "graph TD;\n";
  mermaid += mermaidHeader(meta);
  mermaid += "  %% 节点定义 (按状态着色)\n";

  if (!grouped) {
    for (const node of nodes) {
      mermaid += `  ${mermaidNodeLine(node)}\n`;
    }
  } else {
    const knowledge = nodes.filter(isKnowledgeNode).sort(byId);
    if (knowledge.length > 0) {
      mermaid += "  %% 知识顶点 (context/ADR 横切领域知识，不入分期带)\n";
      for (const n of knowledge) mermaid += `  ${mermaidNodeLine(n)}\n`;
    }
    const workflow = nodes.filter((n) => !isKnowledgeNode(n));
    const levels = [...new Set(workflow.map((n) => n.level))].sort((a, b) => a - b);
    if (levels.length > 0) {
      mermaid += "  %% 分期带 (按 level 分组；带内按 id 排序，Git diff 友好)\n";
      for (const lv of levels) {
        const name = options?.bandNames?.[lv];
        const title = name ? `L${lv} · ${escapeMermaidLabel(name)}` : `L${lv}`;
        mermaid += `  subgraph band_L${lv}["${title}"]\n`;
        for (const n of workflow.filter((w) => w.level === lv).sort(byId)) {
          mermaid += `    ${mermaidNodeLine(n)}\n`;
        }
        mermaid += `  end\n`;
      }
    }
  }

  mermaid += "\n  %% 边\n";
  for (const edge of edges) {
    mermaid += mermaidEdgeLine(edge) + "\n";
  }

  mermaid += "\n  %% 样式定义\n";
  // IL-004：分组模式下 classDef 收集也走 id 排序副本——输出与输入序无关（逐字节稳定）；
  // 平铺模式保持入参序（向后兼容，金样本锁定）
  const classDefSource = grouped ? [...nodes].sort(byId) : nodes;
  const seen = new Set<string>();
  for (const node of classDefSource) {
    const cls = vertexClass(node);
    if (!seen.has(cls)) {
      seen.add(cls);
      mermaid += `  classDef ${cls} ${classDefStyle(cls)};\n`;
    }
  }

  return mermaid;
}

/** IL-004：大图分段导出——只保留指定 level 的工作流顶点。
 * 边保留规则：两端均为保留工作流顶点；或一端为保留工作流顶点、另一端为知识顶点
 * （跨 level 的工作流边丢弃）。知识顶点仅在仍被保留边引用时保留——横切顶点全量
 * 带走会让分段失去意义。纯函数，行为可单测锁定。 */
export function filterByLevels(
  nodes: NodeSchema[],
  edges: EdgeSchema[],
  levels: number[],
): { nodes: NodeSchema[]; edges: EdgeSchema[] } {
  const wanted = new Set(levels);
  const byIdMap = new Map(nodes.map((n) => [n.id, n]));
  const keptWorkflow = new Set(
    nodes.filter((n) => !isKnowledgeNode(n) && wanted.has(n.level)).map((n) => n.id),
  );
  const keptEdges = edges.filter((e) => {
    const s = keptWorkflow.has(e.source);
    const t = keptWorkflow.has(e.target);
    if (s && t) return true;
    if (!s && !t) return false;
    const other = byIdMap.get(s ? e.target : e.source);
    return other !== undefined && isKnowledgeNode(other);
  });
  const knowledgeIds = new Set<string>();
  for (const e of keptEdges) {
    if (!keptWorkflow.has(e.source)) knowledgeIds.add(e.source);
    if (!keptWorkflow.has(e.target)) knowledgeIds.add(e.target);
  }
  return {
    nodes: nodes.filter((n) => keptWorkflow.has(n.id) || knowledgeIds.has(n.id)),
    edges: keptEdges,
  };
}

/** IL-004：解析 --levels（逗号分隔 level 整数，如 "1,2"）；非法即抛错 */
export function parseLevels(raw: string): number[] {
  const parts = raw.split(",").map((s) => s.trim());
  // 严格整数判定：parseInt 会把 "1.5" 截断成 1，必须整串匹配
  const levels = parts.map((s) => (/^-?\d+$/.test(s) ? Number(s) : Number.NaN));
  if (parts.length === 0 || levels.some((n) => !Number.isInteger(n))) {
    throw new Error(`--levels 参数无效: "${raw}"（应为逗号分隔的 level 整数，如 1,2）`);
  }
  return levels;
}

/** IL-004：解析 --band-name（可重复，<level>=<名称>）；非法即抛错 */
export function parseBandNames(raws: string[]): Record<number, string> {
  const bandNames: Record<number, string> = {};
  for (const raw of raws) {
    const i = raw.indexOf("=");
    const head = i === -1 ? "" : raw.slice(0, i);
    const name = i === -1 ? "" : raw.slice(i + 1).trim();
    const lv = /^-?\d+$/.test(head) ? Number(head) : Number.NaN;
    if (!Number.isInteger(lv) || !name) {
      throw new Error(`--band-name 参数无效: "${raw}"（应为 <level>=<名称>，如 1=前置修复带）`);
    }
    bandNames[lv] = name;
  }
  return bandNames;
}

export const exportMermaidCommand = new Command("export").alias("x")
  .description("导出拓扑图（默认 Mermaid 流程图；--docs 导出领域知识顶点为 markdown 视图）")
  .option("--mermaid", "导出为 Mermaid 格式")
  .option("--docs", "v0.5：导出知识顶点为 markdown（多图按图分树：ADR→docs/<图名>/adr/，context→docs/<图名>/CONTEXT-MAP.md + docs/<图名>/contexts/）")
  .option(
    "--check",
    "--docs 模式：不写盘，重导出与在位导出逐文件比对；发现漂移退出码 1 并指名漂移文件（prepublishOnly 发版门禁）",
  )
  .option(
    "--adr-dir <dir>",
    "--docs 模式：ADR 输出目录（缺省：单图 docs/adr；多图 docs/<图名>/adr，按图名分离互不挤占）",
  )
  .option(
    "--ctx-dir <dir>",
    "--docs 模式：context 文档输出目录（缺省：单图 docs/contexts；多图 docs/<图名>/contexts）",
  )
  .option("-o, --output <file>", "Mermaid 输出文件路径", "topology.mmd")
  .option(
    "--band-name <level=名称>",
    "IL-004：分期带显示名（可重复；组名显示为 L<n> · 名称，如 --band-name \"1=前置修复带\"）",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option(
    "--levels <levels>",
    "IL-004：大图分段导出——只导出指定 level 分期带（逗号分隔，如 1,2）；知识顶点仅保留仍被保留边引用者",
  )
  .action((options) => {
    const rootDir = cliGraphDir(process.cwd());

    // --check 只在 --docs 模式有意义：单独传是参数误用，响亮失败而非静默按 mermaid 导出
    if (options.check && !options.docs) {
      console.error("❌ --check 仅支持与 --docs 同用（文档视图漂移门禁：graph export --docs --check）");
      process.exit(1);
    }

    // v0.5 文档视图模式：图为真相源，md 是可重生成的视图
    if (options.docs) {
      // 0.9.0 漂移门禁：不写盘，重导出与在位导出逐文件比对——发版链的机械挂点
      if (options.check) {
        const { checked, drift } = checkDocsExport(rootDir, {
          adrDir: options.adrDir,
          ctxDir: options.ctxDir,
        });
        if (drift.length > 0) {
          console.error(
            `❌ 导出漂移：${drift.length}/${checked} 个文件与图内真相不一致（--check 不做任何写入）：`,
          );
          for (const f of drift) console.error(`   · ${f}`);
          console.error(`修复方式：运行 \`graph export --docs\` 重新导出（图为真相源，md 是视图）。`);
          process.exit(1);
        }
        console.log(`✅ 导出无漂移：${checked} 个文件与图内真相一致。`);
        return;
      }
      const result = runDocsExport(rootDir, {
        adrDir: options.adrDir,
        ctxDir: options.ctxDir,
      });
      console.log(
        `✅ 导出完成: ${result.adrCount} 篇 ADR, ${result.contextCount} 个 context, ${result.decisionCount} 条决议`,
      );
      for (const f of result.written) console.log(`   · ${f}`);
      if (result.contextCount === 0) {
        console.log(`   （图中无 context 顶点，未生成 CONTEXT-MAP.md；根 CONTEXT.md 手写维护，不受影响）`);
      }
      return;
    }

    const nodes = listNodes(rootDir);
    const edges = listEdges(rootDir);

    // IL-004：分期带组名与分段导出参数解析（非法参数响亮失败，不静默导出）
    let bandNames: Record<number, string>;
    let levelFilter: number[] | undefined;
    try {
      bandNames = parseBandNames(options.bandName ?? []);
      levelFilter = options.levels ? parseLevels(options.levels) : undefined;
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }

    let exportNodes = nodes;
    let exportEdges = edges;
    if (levelFilter) {
      ({ nodes: exportNodes, edges: exportEdges } = filterByLevels(nodes, edges, levelFilter));
    }

    // 0.6.2：读 graph.yaml 取 entry/exit 做头注释图例；读不到就跳过，不报错
    let graphMeta: GraphExportMeta | undefined;
    try {
      const graph = readGraph(rootDir);
      graphMeta = { entry: graph.entry, exit: graph.exit };
    } catch {
      graphMeta = undefined;
    }

    // IL-004：默认按 level 分期带 subgraph 分组（entry/exit 仍以头注释承载）
    const mermaid = buildMermaid(exportNodes, exportEdges, graphMeta, {
      groupByLevel: true,
      bandNames,
    });

    const outPath = path.resolve(options.output);
    fs.writeFileSync(outPath, mermaid, "utf-8");
    console.log(`✅ 已导出 Mermaid 文件: ${outPath}`);
    const workflowCount = exportNodes.filter((n) => !isKnowledgeNode(n)).length;
    console.log(`   · 分期带分组: ${workflowCount} 个工作流节点（知识顶点横切不入带）`);
    if (levelFilter) {
      console.log(`   · 分段导出: levels=${levelFilter.join(",")}（全图 ${nodes.length} 顶点中导出 ${exportNodes.length}）`);
    }
  });
