// src/core/style-lint.ts — F16 plan/DoD 文案 lint（manual §2.8 四原则，warning 级）
// 纯函数：入参 plan 文本与 DoD 数组，出参 warning 级 issue 列表（规则码 a/b/c + message）。
// 三通道同源：CLI validate / MCP graph_validate / sp-check-design.mjs（W8）都消费这里，
// 规则单源——脚本与通道侧不复制实现。阈值取向宁缺勿滥：不确定的形态一律不报。
import type { DomainIssue } from "./domain.js";

/** c 类词表：不可验证措辞（manual §2.8 原则 2/3 的靶子）——置顶常量便于调。
 * 中文：方式副词（写不出核对读数）+ 模糊动词（无完成判据）+ 质量套话 */
const UNVERIFIABLE_TERMS_ZH = [
  "正确地",
  "合理地",
  "适当地",
  "恰当地",
  "妥善地",
  "充分地",
  "完善",
  "确保质量",
  "保证质量",
];

/** c 类裸词干（g080 二轮：种子「确保合理优化整体质量」漏报——「合理」不带「地」须也命中）。
 * 带双守卫防误报：前邻「不/非」不命中（不合理/非正确是描述不是承诺），
 * 后邻「性/化/界/地」不命中（合理性/合理化/正确性是名词讨论；「地」形态已在上表整词收录，不重复报） */
const UNVERIFIABLE_STEMS_ZH = ["合理", "正确", "适当", "妥善", "恰当", "充分"];
const STEM_GUARD = (stem: string) => new RegExp(`(?<![不非])${stem}(?![性化界地])`);

/** c 类英文词表（\b 词边界匹配，大小写不敏感） */
const UNVERIFIABLE_TERMS_EN = ["properly", "correctly", "appropriately", "adequately"];

/** b 类 `:N` 形态只认代码/文档扩展名后的冒号行号（file.ts:123 / manual.md:152）。
 * 端口（example.com:8080）、键值对（attempts: 3）、时间（18:30）天然不命中——
 * 扩展名白名单不含 TLD，冒号前也要求文件名形状 */
const FILE_EXTS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "markdown",
  "yaml", "yml", "toml", "ini", "xml", "html", "css", "scss",
  "py", "rs", "go", "java", "rb", "cs", "c", "h", "cpp", "sql", "sh", "bash", "ps1", "txt",
];
const EXT_ALT = FILE_EXTS.join("|");

/** b 行号式：「第 N 行」（含 区间/至/到）与 line(s) N */
const LINE_ZH_RE = /第\s*\d{1,6}\s*(?:[-–—~至到]\s*\d{1,6}\s*)?行/;
const LINE_EN_RE = /\blines?\s*[:：]?\s*\d{1,6}\b/i;
/** b 行号式：file.ext:N（扩展名锚定，见 FILE_EXTS 注释） */
const LINE_COLON_RE = new RegExp(`\\.(?:${EXT_ALT})(?::|：)\\d{1,5}\\b`, "i");

/** a 类函数名指针：标识符±「函数/function」相邻，或「标识符()」空调用形状。
 * 裸「该函数」「函数」不带 ASCII 标识符不命中（误报控制） */
const FUNC_PTR_RE =
  /[A-Za-z_$][\w$.@-]{1,}\s*(?:函数|function)|(?:函数|function)\s*[:：]?\s*[A-Za-z_$][\w$.@-]{1,}|[A-Za-z_$][\w$.@-]*\(\s*\)/;

/** 句子切分（a 类按句判定「路径+定位」共现，跨句不强行关联） */
const SENTENCE_SPLIT_RE = /[。！？!?；;\n]+/;

/** 路径 token：≥1 个路径分隔符（/ 或 \，URL 协议头剔除后再判），或带代码/文档扩展名的文件名 */
const PATH_SEP_RE = /\w[\w@.\-]*[\\/][\w@.\-]*/;
const FILENAME_RE = new RegExp(`\\w[\\w@.\-]*\\.(?:${EXT_ALT})\\b`, "i");

export type StyleLintRuleCode = "a" | "b" | "c";

export interface StyleLintIssue {
  /** 恒为 warning：文案 lint 不参与退出码/门禁（manual §2.8 是写作规范，不是结构错误） */
  level: DomainIssue["level"];
  /** 规则码：a=脆弱定位（路径+行号/函数名指认内部实现位置）b=行号式 c=不可验证措辞 */
  code: StyleLintRuleCode;
  /** 命中字段：plan.description / DoD[i] */
  field: string;
  message: string;
}

/** 截断展示片段（长句只示头部） */
function snippetOf(text: string): string {
  const t = text.trim();
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

/** URL 剔除后再判定路径 token（http(s) 链接不是文件落点） */
function hasPathToken(sentence: string): boolean {
  const stripped = sentence.replace(/(?:https?|ftp):\/\/\S+/g, " ");
  return PATH_SEP_RE.test(stripped) || FILENAME_RE.test(stripped);
}

/** 单段文本（plan 或单条 DoD）的三类规则检查 */
function lintText(text: string, field: string): StyleLintIssue[] {
  const issues: StyleLintIssue[] = [];
  if (!text || !text.trim()) return issues;

  // ── a 脆弱定位：同句 路径 token +（行号式 或 函数名指针）。
  //    板块级文件落点声明（路径 token 单独出现，如「只动 src/core/xxx.ts」「文件边界：…」）
  //    天然不命中——a 只在路径之外还指认了文件内部实现位置时报
  for (const sentence of text.split(SENTENCE_SPLIT_RE)) {
    const s = sentence.trim();
    if (!s || !hasPathToken(s)) continue;
    const hasLineRef = LINE_ZH_RE.test(s) || LINE_EN_RE.test(s) || LINE_COLON_RE.test(s);
    const hasFuncRef = FUNC_PTR_RE.test(s);
    if (hasLineRef || hasFuncRef) {
      issues.push({
        level: "warning",
        code: "a",
        field,
        message: `${field}〔规则 a·脆弱定位〕「${snippetOf(s)}」——路径+行号/函数名指认文件内部实现位置，行号/函数名随重构漂移；文件落点写到板块级即可（manual §2.8 原则1）`,
      });
      break; // 每字段一条 a 足矣（定位问题一次说清）
    }
  }

  // ── b 行号式：第 N 行 / line N / file.ext:N（去重后逐命中报告）
  const lineMatches = new Set<string>();
  for (const re of [LINE_ZH_RE, LINE_EN_RE, LINE_COLON_RE]) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
      lineMatches.add(m[0]);
    }
  }
  for (const m of lineMatches) {
    issues.push({
      level: "warning",
      code: "b",
      field,
      message: `${field}〔规则 b·行号式〕「${m}」——行号式定位随重构漂移，改写为板块级文件落点或行为描述（manual §2.8 原则1）`,
    });
  }

  // ── c 不可验证措辞：词表命中即报（每词一次）；裸词干带前后守卫（见 UNVERIFIABLE_STEMS_ZH 注释）
  const cHits = new Set<string>();
  for (const term of UNVERIFIABLE_TERMS_ZH) {
    if (text.includes(term)) cHits.add(term);
  }
  for (const stem of UNVERIFIABLE_STEMS_ZH) {
    if (STEM_GUARD(stem).test(text)) cHits.add(stem);
  }
  for (const term of UNVERIFIABLE_TERMS_EN) {
    if (new RegExp(`\\b${term}\\b`, "i").test(text)) cHits.add(term);
  }
  for (const term of cHits) {
    issues.push({
      level: "warning",
      code: "c",
      field,
      message: `${field}〔规则 c·不可验证措辞〕「${term}」——主观措辞写不出核对判据，改写为可观察/可核对的行为差异（manual §2.8 原则2/3）`,
    });
  }

  return issues;
}

/**
 * F16 规则组核心：plan 文本 + DoD 数组 → warning 级 issue 列表。
 * 纯函数、零依赖（除 DomainIssue level 类型别名），CLI/MCP/脚本三通道同源消费。
 */
export function lintPlanWording(plan: string, dod: string[]): StyleLintIssue[] {
  const issues: StyleLintIssue[] = [];
  issues.push(...lintText(plan ?? "", "plan.description"));
  (dod ?? []).forEach((item, i) => {
    issues.push(...lintText(item ?? "", `DoD[${i}]`));
  });
  return issues;
}

/** 节点级包装：从 NodeSchema 形状取 plan/DoD，消息带节点 id（通道输出的扁平清单用） */
export function lintNodeWording(node: {
  id: string;
  plan?: { description?: string };
  expected_outcome?: { definition_of_done?: string[] };
}): StyleLintIssue[] {
  return lintPlanWording(
    node.plan?.description ?? "",
    node.expected_outcome?.definition_of_done ?? [],
  ).map((i) => ({ ...i, message: `节点 ${node.id} ${i.message}` }));
}
