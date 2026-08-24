// src/core/docs-export.ts — v0.5 文档导出（core 层：CLI export --docs 与快照自动导出共用）。
// 图 YAML 是唯一真相源，md 是可重生成的视图。
// ADR 顶点 → docs/adr/NNNN-slug.md（格式对齐仓库既有手写 ADR）
// context 顶点 → CONTEXT-MAP.md（总览）+ docs/contexts/<id>.md（节点即文档）
// 注意：不触碰根 CONTEXT.md（单一上下文约定下手写维护的术语表，避免覆盖人工内容）。
import * as fs from "node:fs";
import * as path from "node:path";
import { listNodes } from "./node.js";
import { toGraphDir, workspaceOf } from "./graph-dir.js";
import { AdrStatus, NodeType, type NodeSchema } from "./types.js";

export interface DocsExportResult {
  adrCount: number;
  contextCount: number;
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
    const boundary = (c.boundary ?? "").replace(/\|/g, "\\|").slice(0, 80);
    lines.push(`| ${c.id}（${c.label}） | ${boundary} | ${terms} | docs/contexts/${c.id}.md |`);
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

export function runDocsExport(
  rootDir: string,
  opts: { adrDir?: string; ctxDir?: string } = {},
): DocsExportResult {
  const nodes = listNodes(toGraphDir(rootDir));
  const adrs = nodes.filter((n) => n.type === NodeType.Adr);
  const contexts = nodes.filter((n) => n.type === NodeType.Context);
  const written: string[] = [];

  // ADR → docs/adr/NNNN-slug.md
  const wsRoot = workspaceOf(rootDir); // 产物落工作区根（即使 rootDir 是图目录）
  const adrDir = path.join(wsRoot, opts.adrDir ?? "docs/adr");
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
    const ctxDir = path.join(wsRoot, opts.ctxDir ?? "docs/contexts");
    fs.mkdirSync(ctxDir, { recursive: true });
    for (const c of contexts) {
      const file = path.join(ctxDir, `${c.id}.md`);
      fs.writeFileSync(file, renderContextFile(c), "utf-8");
      written.push(path.relative(wsRoot, file));
    }
    fs.writeFileSync(path.join(wsRoot, "CONTEXT-MAP.md"), renderContextMap(contexts), "utf-8");
    written.push("CONTEXT-MAP.md");
  }

  return { adrCount: adrs.length, contextCount: contexts.length, written };
}
