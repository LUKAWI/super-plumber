// src/core/docs-export.ts — v0.5 文档导出（core 层：CLI export --docs 与快照自动导出共用）。
// 图 YAML 是唯一真相源，md 是可重生成的视图。
// ADR 顶点 → docs/adr/NNNN-slug.md（格式对齐仓库既有手写 ADR）
// context 顶点 → CONTEXT-MAP.md（总览）+ docs/contexts/<id>.md（节点即文档）
// 注意：不触碰根 CONTEXT.md（单一上下文约定下手写维护的术语表，避免覆盖人工内容）。
// adr_0013（fix-v080-a1）：多图工作区下知识视图默认按图名分离——
// ADR → docs/<图名>/adr/、context → docs/<图名>/contexts/ + docs/<图名>/CONTEXT-MAP.md；
// 单图工作区（含旧布局原地 default）保持既有共享路径不变（向后兼容）。
// 根因：ADR 编号按图独立 × 共享目录，任何一图导出都会同号覆写/误归档其他图的视图。
// 使用者显式传 adrDir/ctxDir 时永远优先于默认规则。
import * as fs from "node:fs";
import * as path from "node:path";
import { listNodes } from "./node.js";
import { GRAPH_NAME_RE, listGraphNames, toGraphDir, workspaceOf } from "./graph-dir.js";
import { assertValidEntityId } from "./schema.js";
import { AdrStatus, NodeStatus, NodeType, type NodeSchema } from "./types.js";

export interface DocsExportResult {
  adrCount: number;
  contextCount: number;
  /** F15（0.8.1）：DECISIONS.md 决议索引条数（passed task + accepted/superseded ADR） */
  decisionCount: number;
  written: string[];
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "decision"
  );
}

function adrNumber(id: string): string {
  const m = id.match(/^adr_(\d+)$/);
  return m ? String(parseInt(m[1], 10)).padStart(4, "0") : id;
}

function renderAdr(a: NodeSchema): string {
  const lines: string[] = [`# ${adrNumber(a.id)} — ${a.label}`, ""];
  lines.push(a.decision ?? "", "");
  if (a.status === AdrStatus.Accepted) {
    lines.push(`**Status：** accepted`, "");
  } else if (a.status === AdrStatus.Superseded) {
    lines.push(
      `**Status：** superseded${a.superseded_by ? `（由 ADR ${a.superseded_by} 接替）` : ""}`,
      "",
    );
  } else {
    lines.push(`**Status：** proposed（待裁决）`, "");
  }
  if (a.background) lines.push(`**Context：** ${a.background}`, "");
  if (a.considered_options) lines.push(`**Considered Options：** ${a.considered_options}`, "");
  if (a.why) lines.push(`**Why：** ${a.why}`, "");
  if (a.consequences) lines.push(`**Consequences：** ${a.consequences}`, "");
  lines.push(`> 本文由 \`graph export\` 从图顶点 ${a.id} 生成；改图不改文，重新导出即覆盖。`, "");
  return lines.join("\n");
}

function renderContextFile(c: NodeSchema): string {
  const lines: string[] = [`# ${c.label}（${c.id}）`, ""];
  if (c.boundary) lines.push(c.boundary, "");
  if (c.glossary && c.glossary.length > 0) {
    lines.push(`## 术语表`, "");
    for (const g of c.glossary) lines.push(`- **${g.term}**: ${g.definition}`);
    lines.push("");
  }
  lines.push(
    `> 本文由 \`graph export\` 从 context 顶点 ${c.id} 生成（节点即文档，图是真相源）。`,
    "",
  );
  return lines.join("\n");
}

function renderContextMap(contexts: NodeSchema[]): string {
  const lines: string[] = [
    `# Context Map`,
    ``,
    `> 本仓库有 ${contexts.length} 个 bounded context（由 \`graph export\` 从图生成）。`,
    `> 术语表详情见各 context 文件；图为真相源，本文件是视图。`,
    ``,
    `| Context | 边界 | 术语数 | 文档 |`,
    `|---------|------|--------|------|`,
  ];
  for (const c of contexts) {
    const terms = c.glossary?.length ?? 0;
    // S3-11（f15）：`|` 是表格定界符，id/label 与 boundary 一样必须转义
    // （此前只转义了 boundary，label 含 | 会撕裂表格列）。
    const esc = (s: string) => s.replace(/\|/g, "\\|");
    const boundary = esc(c.boundary ?? "").slice(0, 80);
    lines.push(`| ${esc(c.id)}（${esc(c.label)}） | ${boundary} | ${terms} | docs/contexts/${c.id}.md |`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * F15（0.8.1）：DECISIONS.md 决议一行索引——passed 的 task 节点 +
 * accepted/superseded 的 ADR，各一行（id/标题/结论时间），一屏可读。
 * 结论时间口径：passed task 取 execution_report.completed_at（缺省回落
 * updated_at）；ADR 状态变更（accept/supersede）由状态机写 updated_at。
 */
function collectDecisions(nodes: NodeSchema[]): NodeSchema[] {
  return nodes.filter(
    (n) =>
      (n.type === NodeType.Task && n.status === NodeStatus.Passed) ||
      (n.type === NodeType.Adr &&
        (n.status === AdrStatus.Accepted || n.status === AdrStatus.Superseded)),
  );
}

function renderDecisions(decisions: NodeSchema[]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const lines: string[] = [
    `# DECISIONS`,
    ``,
    `> 决议一行索引（由 \`graph export\` 从图顶点生成）：passed 的 task 节点 + accepted/superseded 的 ADR。`,
    `> 图为真相源，本文件是视图；改图不改文，重新导出即覆盖。`,
    ``,
    `| 决议 | id | 标题 | 结论时间 |`,
    `|------|----|------|---------|`,
  ];
  if (decisions.length === 0) {
    lines.push(`| _（尚无决议记录）_ | | | |`);
  }
  for (const d of decisions) {
    const kind =
      d.type === NodeType.Adr ? `ADR · ${d.status}` : `task · ${d.status}`;
    const at = d.execution_report?.completed_at ?? d.updated_at;
    lines.push(`| ${esc(kind)} | ${esc(d.id)} | ${esc(d.label)} | ${esc(at)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * 清理同号旧命名文件（label 改了 slug 会变）。
 * D4 实锤升级：个别环境（本机 shell）对特定 Unicode 文件名的 fs.rmSync 是
 * **进程级崩溃**（exit 127，无异常可捕，try/catch 无效）——renameSync 则正常。
 * 因此绝不 rmSync 用户目录下的文件：mkdir .retired/ + renameSync 归档（原子、可逆），
 * rename 失败再降级为覆写跳转注记（writeFileSync 对 Unicode 安全）。
 */
function retireStaleSlugFiles(adrDir: string, num: string, canonical: string): void {
  for (const f of fs.readdirSync(adrDir)) {
    if (f.startsWith(`${num}-`) && f.endsWith(".md") && f !== canonical) {
      const src = path.join(adrDir, f);
      try {
        const retiredDir = path.join(adrDir, ".retired");
        fs.mkdirSync(retiredDir, { recursive: true });
        fs.renameSync(src, path.join(retiredDir, f));
      } catch {
        try {
          fs.writeFileSync(
            src,
            `> 本决策文档已由 \`graph export\` 重命名：见 ${canonical}\n`,
            "utf-8",
          );
        } catch {
          /* 双保险都失败：保留旧文件（重复编号无害，幂等靠规范名覆盖） */
        }
      }
    }
  }
}

/**
 * adr_0013（fix-v080-a1）：知识视图的默认落点是否按图名分离。
 * 多图工作区（.graph/ 下图数 > 1）→ 返回当前图名（作目录子路径 docs/<图名>/…）；
 * 单图工作区（含旧布局 .graph/ 原地 default）→ null（保持既有共享路径，向后兼容）。
 * 图名经 GRAPH_NAME_RE 校验（保证目录名安全）；异常布局回落共享路径，不阻塞导出。
 */
function defaultViewSubdir(graphDir: string): string | null {
  const wsRoot = workspaceOf(graphDir);
  if (listGraphNames(wsRoot).length <= 1) return null;
  const name = path.basename(graphDir);
  return GRAPH_NAME_RE.test(name) ? name : null;
}

export function runDocsExport(
  rootDir: string,
  opts: { adrDir?: string; ctxDir?: string } = {},
): DocsExportResult {
  const graphDir = toGraphDir(rootDir);
  const nodes = listNodes(graphDir);
  const adrs = nodes.filter((n) => n.type === NodeType.Adr);
  const contexts = nodes.filter((n) => n.type === NodeType.Context);
  const decisions = collectDecisions(nodes);
  const written: string[] = [];

  const wsRoot = workspaceOf(rootDir); // 产物落工作区根（即使 rootDir 是图目录）
  // 默认落点：多图 → docs/<图名>/…（按图名分离）；单图 → 既有共享路径；显式透传永远优先
  const viewSub = defaultViewSubdir(graphDir);
  const defaultAdrDir = viewSub ? path.join("docs", viewSub, "adr") : path.join("docs", "adr");
  const defaultCtxDir = viewSub
    ? path.join("docs", viewSub, "contexts")
    : path.join("docs", "contexts");
  const contextMapRel = viewSub
    ? path.join("docs", viewSub, "CONTEXT-MAP.md")
    : "CONTEXT-MAP.md";

  // ADR → docs/adr/NNNN-slug.md
  const adrDir = path.join(wsRoot, opts.adrDir ?? defaultAdrDir);
  fs.mkdirSync(adrDir, { recursive: true });
  for (const a of adrs) {
    const num = adrNumber(a.id);
    const canonical = `${num}-${slugify(a.label)}.md`;
    retireStaleSlugFiles(adrDir, num, canonical);
    const file = path.join(adrDir, canonical);
    fs.writeFileSync(file, renderAdr(a), "utf-8");
    written.push(path.relative(wsRoot, file));
  }

  // context → CONTEXT-MAP.md + docs/contexts/<id>.md
  if (contexts.length > 0) {
    const ctxDir = path.join(wsRoot, opts.ctxDir ?? defaultCtxDir);
    fs.mkdirSync(ctxDir, { recursive: true });
    for (const c of contexts) {
      // S0-3 次生面兜底：拼接 docs/contexts/<id>.md 前的最后防线
      // （正常链路经 schema 读校验已拦截，此处防直调绕过）
      assertValidEntityId("节点", c.id);
      const file = path.join(ctxDir, `${c.id}.md`);
      fs.writeFileSync(file, renderContextFile(c), "utf-8");
      written.push(path.relative(wsRoot, file));
    }
    // contextMapRel 的父目录（多图默认 = docs/<图名>/）可能尚未创建——
    // adr/ctx 目录被显式透传接管时无人 mkdir 它，写前补建（幂等）
    const contextMapPath = path.join(wsRoot, contextMapRel);
    fs.mkdirSync(path.dirname(contextMapPath), { recursive: true });
    fs.writeFileSync(contextMapPath, renderContextMap(contexts), "utf-8");
    written.push(contextMapRel);
  }

  // F15：DECISIONS.md 决议索引——与 CONTEXT-MAP.md 同目录约定
  // （多图 → docs/<图名>/DECISIONS.md；单图 → 工作区根，向后兼容布局不变）。
  // 空决议也落盘（索引恒在，行为可预期）；mkdir 幂等，防父目录未建。
  const decisionsRel = viewSub
    ? path.join("docs", viewSub, "DECISIONS.md")
    : "DECISIONS.md";
  const decisionsPath = path.join(wsRoot, decisionsRel);
  fs.mkdirSync(path.dirname(decisionsPath), { recursive: true });
  fs.writeFileSync(decisionsPath, renderDecisions(decisions), "utf-8");
  written.push(decisionsRel);

  return {
    adrCount: adrs.length,
    contextCount: contexts.length,
    decisionCount: decisions.length,
    written,
  };
}
