// src/cli/rebuild.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析归
// runner。未初始化拒绝（防半初始化假成功，BUG-07）复用 core
// workspaceNotInitialized 单源文案（"ENOENT 提示六份归一"）。
import { readGraph } from "../core/parser.js";
import { buildGraphIndex } from "../core/graph.js";
import { toGraphDir } from "../core/graph-dir.js";
import { workspaceNotInitialized } from "../core/errors.js";
import type { GraphExportMeta } from "./export-mermaid.js";
import { vertexColors, EDGE_STYLE_LEGEND, commentSafe } from "./export-mermaid.js";
import type { EdgeSchema, NodeSchema } from "../core/types.js";
import { defineCommand } from "./runner.js";
import * as fs from "node:fs";
import * as path from "node:path";

/** S3-4（f15）：DOT label 属性转义——`\` 与 `"` 会破坏 "..." 定界，裸换行会破坏行结构
 * （换行写成 `\n` 两字符字面，Graphviz 识别为节点内换行）。转义顺序：先 `\` 再 `"`。 */
export function escapeDotLabel(label: string): string {
  return label
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

// ── 0.6.2 导出表达升级：DOT 侧形状/配色与 Mermaid 语义对齐 ──
// 配色/图例真相源在 export-mermaid.ts（vertexColors / EDGE_STYLE_LEGEND）。

/** 边类型 → DOT 属性串：decides/fallback/iterates=虚线；relates=点线无向；
 * shares_context=无向实线；depends_on/validates/fan_out/fan_in 及未知类型=默认实线箭头。
 * label 与 Mermaid 侧同款（下划线转空格），经 escapeDotLabel 转义。 */
export function dotEdgeAttrs(type: string): string {
  const label = escapeDotLabel(type.replace("_", " "));
  if (type === "relates") return `label="${label}", style=dotted, dir=none`;
  if (type === "shares_context") return `label="${label}", dir=none`;
  if (type === "decides" || type === "fallback" || type === "iterates") {
    return `label="${label}", style=dashed`;
  }
  return `label="${label}"`;
}

/** 0.6.2：拼 DOT 文本的纯函数（I/O 在 action 里做），形状/配色/头注释可单测锁定 */
export function buildDotTopology(
  nodes: NodeSchema[],
  edges: EdgeSchema[],
  meta?: GraphExportMeta,
): string {
  const lines: string[] = [];

  // 头注释：entry/exit 图例（缺省跳过对应行）+ 边样式一行图例
  if (meta?.entry?.description) lines.push(`// entry: ${commentSafe(meta.entry.description)}`);
  if (meta?.exit?.description) lines.push(`// exit: ${commentSafe(meta.exit.description)}`);
  lines.push(`// 边样式: ${EDGE_STYLE_LEGEND}`);

  lines.push("digraph topology {");
  for (const n of nodes) {
    const c = vertexColors(n);
    if (n.type === "context") {
      // 知识顶点：无工作流状态 → label 不带状态行
      lines.push(
        `  "${n.id}" [label="${escapeDotLabel(n.label)}", shape=ellipse, style=filled, fillcolor="${c.fill}", color="${c.stroke}"];`,
      );
    } else if (n.type === "adr") {
      // 知识顶点：六边形，label 带 adr 状态行
      lines.push(
        `  "${n.id}" [label="${escapeDotLabel(n.label)}\\n${n.status}", shape=hexagon, style=filled, fillcolor="${c.fill}", color="${c.stroke}"];`,
      );
    } else {
      lines.push(
        `  "${n.id}" [label="${escapeDotLabel(n.label)}\\n${n.status}", shape=box, style=filled, fillcolor="${c.fill}", color="${c.stroke}"];`,
      );
    }
  }
  for (const e of edges) {
    lines.push(`  "${e.source}" -> "${e.target}" [${dotEdgeAttrs(e.type)}];`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

export const rebuildCommand = defineCommand("rebuild").alias("rb")
  .description("从源文件重建 index/ 派生索引（graph.json 完整数据 + meta.json + topology.dot）")
  .action((_options: Record<string, unknown>, _cmd, ctx) => {
    const rootDir = ctx.rootDir;

    // 未初始化时直接报错，不自动创建 index/（避免半初始化假成功）
    if (!fs.existsSync(path.join(rootDir, "graph.yaml"))) {
      throw workspaceNotInitialized(rootDir);
    }

    const indexPath = path.join(toGraphDir(rootDir), "index");

    // 确保 index/ 目录存在
    fs.mkdirSync(indexPath, { recursive: true });

    // 重建 graph.json（完整节点/边数据 + 邻接表 + 门控邻接，供 MCP/Web 新鲜度缓存直接加载）
    const index = buildGraphIndex(rootDir);
    const graphJson = {
      nodes: index.nodes,
      edges: index.edges,
      adjacency: Object.fromEntries(index.adjacency),
      reverseAdj: Object.fromEntries(index.reverseAdj),
      gateReverseAdj: Object.fromEntries(index.gateReverseAdj),
    };

    const jsonPath = path.join(indexPath, "graph.json");
    fs.writeFileSync(jsonPath, JSON.stringify(graphJson, null, 2), "utf-8");
    console.log(
      `✅ 已重建: ${jsonPath} (${index.nodes.length} 节点, ${index.edges.length} 边)`,
    );

    // topology.dot（Graphviz 导出，需求 4.7 存储结构；0.6.2 形状/配色/边样式升级）
    // 读 graph.yaml 取 entry/exit 做头注释；读不到就跳过注释行，不报错
    let graphMeta: GraphExportMeta | undefined;
    try {
      const graph = readGraph(rootDir);
      graphMeta = { entry: graph.entry, exit: graph.exit };
    } catch {
      graphMeta = undefined;
    }
    const dotPath = path.join(indexPath, "topology.dot");
    fs.writeFileSync(dotPath, buildDotTopology(index.nodes, index.edges, graphMeta), "utf-8");
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
