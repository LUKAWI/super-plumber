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
// checkDocsExport（0.9.0）：不写盘的导出漂移门禁——渲染产物与在位导出逐文件比对，
// 供 `graph export --docs --check` 与 prepublishOnly 发版链使用。
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

function renderContextMap(contexts: NodeSchema[], contextMapDir: string, ctxDir: string): string {
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
    const contextFile = path.join(ctxDir, `${c.id}.md`);
    const contextLink = path.relative(contextMapDir, contextFile).replace(/\\/g, "/");
    lines.push(`| ${esc(c.id)}（${esc(c.label)}） | ${boundary} | ${terms} | ${contextLink} |`);
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

/**
 * 一次导出的完整落盘计划（纯渲染，零 I/O副作用）：runDocsExport 的写盘与
 * checkDocsExport 的漂移比对消费同一份渲染产物——保证“重导出会写什么”与
 * “在位文件该是什么”永不分叉（两入口共享一个真相，比对才有意义）。
 */
interface PlannedFile {
  absPath: string;
  /** 相对工作区根的路径（与 DocsExportResult.written 同一口径） */
  relPath: string;
  content: string;
}

interface DocsExportPlan {
  wsRoot: string;
  adrDir: string;
  /** 同号旧命名清理所需元数据（num + 规范文件名） */
  adrEntries: { num: string; canonical: string }[];
  /** 写盘序 = ADR → context 文件 → CONTEXT-MAP.md → DECISIONS.md */
  files: PlannedFile[];
  adrCount: number;
  contextCount: number;
  decisionCount: number;
}

function planDocsExport(
  rootDir: string,
  opts: { adrDir?: string; ctxDir?: string } = {},
): DocsExportPlan {
  const graphDir = toGraphDir(rootDir);
  const nodes = listNodes(graphDir);
  const adrs = nodes.filter((n) => n.type === NodeType.Adr);
  const contexts = nodes.filter((n) => n.type === NodeType.Context);
  const decisions = collectDecisions(nodes);

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

  const files: PlannedFile[] = [];
  const adrEntries: DocsExportPlan["adrEntries"] = [];

  // ADR → docs/adr/NNNN-slug.md
  const adrDir = path.join(wsRoot, opts.adrDir ?? defaultAdrDir);
  for (const a of adrs) {
    const num = adrNumber(a.id);
    const canonical = `${num}-${slugify(a.label)}.md`;
    adrEntries.push({ num, canonical });
    const file = path.join(adrDir, canonical);
    files.push({ absPath: file, relPath: path.relative(wsRoot, file), content: renderAdr(a) });
  }

  // context → CONTEXT-MAP.md + docs/contexts/<id>.md
  if (contexts.length > 0) {
    const ctxDir = path.join(wsRoot, opts.ctxDir ?? defaultCtxDir);
    for (const c of contexts) {
      // S0-3 次生面兜底：拼接 docs/contexts/<id>.md 前的最后防线
      // （正常链路经 schema 读校验已拦截，此处防直调绕过）
      assertValidEntityId("节点", c.id);
      const file = path.join(ctxDir, `${c.id}.md`);
      files.push({
        absPath: file,
        relPath: path.relative(wsRoot, file),
        content: renderContextFile(c),
      });
    }
    // contextMapRel 的父目录（多图默认 = docs/<图名>/）可能尚未创建——
    // adr/ctx 目录被显式透传接管时无人 mkdir 它，写前补建（幂等）
    const contextMapPath = path.join(wsRoot, contextMapRel);
    files.push({
      absPath: contextMapPath,
      relPath: contextMapRel,
      content: renderContextMap(contexts, path.dirname(contextMapPath), ctxDir),
    });
  }

  // F15：DECISIONS.md 决议索引——与 CONTEXT-MAP.md 同目录约定
  // （多图 → docs/<图名>/DECISIONS.md；单图 → 工作区根，向后兼容布局不变）。
  // 空决议也落盘（索引恒在，行为可预期）；mkdir 幂等，防父目录未建。
  const decisionsRel = viewSub
    ? path.join("docs", viewSub, "DECISIONS.md")
    : "DECISIONS.md";
  files.push({
    absPath: path.join(wsRoot, decisionsRel),
    relPath: decisionsRel,
    content: renderDecisions(decisions),
  });

  return {
    wsRoot,
    adrDir,
    adrEntries,
    files,
    adrCount: adrs.length,
    contextCount: contexts.length,
    decisionCount: decisions.length,
  };
}

export function runDocsExport(
  rootDir: string,
  opts: { adrDir?: string; ctxDir?: string } = {},
): DocsExportResult {
  const plan = planDocsExport(rootDir, opts);
  const written: string[] = [];

  fs.mkdirSync(plan.adrDir, { recursive: true });
  // 同号旧命名清理（label 改了 slug 会变）：先归档旧名再写规范名，目录内不残留重复编号
  for (const e of plan.adrEntries) {
    retireStaleSlugFiles(plan.adrDir, e.num, e.canonical);
  }
  for (const f of plan.files) {
    fs.mkdirSync(path.dirname(f.absPath), { recursive: true });
    fs.writeFileSync(f.absPath, f.content, "utf-8");
    written.push(f.relPath);
  }

  return {
    adrCount: plan.adrCount,
    contextCount: plan.contextCount,
    decisionCount: plan.decisionCount,
    written,
  };
}

export interface DocsCheckResult {
  /** 比对文件数（= 本次导出会写的文件数） */
  checked: number;
  /** 漂移清单（相对工作区根路径；内容不一致或在位缺失都算） */
  drift: string[];
}

/**
 * 导出漂移门禁：不写盘，把 runDocsExport 将要写的每一份渲染产物与在位文件逐文件比对，
 * 任何缺失/内容不一致记入 drift，由调用方决定退出码——发版前发现“图改了视图没跟上”。
 * 行尾不构成漂移：在位文件按 CRLF→LF 归一后再比（git autocrlf 工作区检出会把
 * LF 视图转成 CRLF，行尾差异是 git 的，不是图内真相的）。
 * 与临时目录重导出逐文件比对等效：渲染产物即重导出会写的字节，且免去拷贝 .graph 的 I/O。
 */
export function checkDocsExport(
  rootDir: string,
  opts: { adrDir?: string; ctxDir?: string } = {},
): DocsCheckResult {
  const plan = planDocsExport(rootDir, opts);
  const drift: string[] = [];
  for (const f of plan.files) {
    let onDisk: string | null = null;
    try {
      onDisk = fs.readFileSync(f.absPath, "utf-8");
    } catch {
      onDisk = null; // 在位缺失 = 漂移
    }
    const inPlace = onDisk === null ? null : onDisk.replace(/\r\n/g, "\n");
    if (inPlace !== f.content) drift.push(f.relPath);
  }
  return { checked: plan.files.length, drift };
}
