// tests/cli/export-escaping.test.ts — f15/S3-4：mermaid/DOT label 转义回归
// 核心层直连 src（无需 dist）：断言含 " \ 换行 的 label 经转义后，
// 导出行内不再有未转义定界符（产物语法安全）。
import { describe, it, expect } from "vitest";
import { escapeMermaidLabel } from "../../src/cli/export-mermaid.js";
import { escapeDotLabel } from "../../src/cli/rebuild.js";

const HOSTILE_LABELS: string[] = [
  "plain label",
  'quote "hi"',
  "backslash C:\\path\\to",
  "newline l1\nl2",
  'mixed " and \\ and \n end',
  "crlf l1\r\nl2",
];

describe("escapeMermaidLabel（S3-4，f15）", () => {
  it.each(HOSTILE_LABELS)("节点行/边行内无未转义定界符: %j", (label) => {
    const esc = escapeMermaidLabel(label);
    // 组装为真实导出行格式，["..."] 值内不得再出现 " 或裸换行
    const nodeLine = `  n1["${esc}"]:::pending;`;
    expect(nodeLine).toMatch(/^  n1\["[^"\r\n]*"\]:::pending;$/);
    const edgeLine = `  a -->|"${esc}"| b;`;
    expect(edgeLine).toMatch(/^  a -->\|"[^"\r\n]*"\| b;$/);
  });

  it("具体映射：\" → #quot;；换行 → <br/>；CRLF 归一", () => {
    expect(escapeMermaidLabel('a"b\nc')).toBe("a#quot;b<br/>c");
    expect(escapeMermaidLabel("crlf\r\nlf\n")).toBe("crlf<br/>lf<br/>");
  });
});

describe("escapeDotLabel（S3-4，f15）", () => {
  it.each(HOSTILE_LABELS)("label 属性值内无未转义 \" \\\\ 换行: %j", (label) => {
    const esc = escapeDotLabel(label);
    // 剥掉合法转义序列（\\ \" \n 字面）后，不得残留裸定界符
    const stripped = esc
      .replace(/\\\\/g, "")
      .replace(/\\"/g, "")
      .replace(/\\n/g, "");
    expect(stripped).not.toContain('"');
    expect(stripped).not.toContain("\\");
    expect(stripped).not.toContain("\n");
    expect(stripped).not.toContain("\r");
    // 组装为真实导出行格式（\n<status> 字面在引号值内）：值只允许
    // 普通字符（非 " \ 换行）或合法转义序列 \\ \" \n
    const line = `  "n1" [label="${esc}\\npending", shape=box];`;
    expect(line).toMatch(
      /^  "n1" \[label="(?:[^"\\\r\n]|\\\\|\\"|\\n)*\\npending", shape=box\];$/,
    );
  });

  it("具体映射：\\ → \\\\；\" → \\\"；换行 → \\n 字面；CRLF 归一", () => {
    expect(escapeDotLabel('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd');
    expect(escapeDotLabel("crlf\r\nlf\n")).toBe("crlf\\nlf\\n");
  });
});
