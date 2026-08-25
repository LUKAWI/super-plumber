// tests/core/docs-export-escaping.test.ts — f15/S3-11：CONTEXT-MAP 表格 | 转义补齐
// 旧实现只转义 boundary，c.id/c.label 含 | 会撕裂表格列；修复后全列转义。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createGraph } from "../../src/core/graph-dir.js";
import { createNode, getNode } from "../../src/core/node.js";
import { writeNode } from "../../src/core/parser.js";
import { runDocsExport } from "../../src/core/docs-export.js";
import { NodeType } from "../../src/core/types.js";

let tmpDir: string; // 工作区根

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f15-docs-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CONTEXT-MAP 表格转义（S3-11，f15）", () => {
  it("context label/boundary 含 | 时：转义可见且表格仍是 4 列", () => {
    createGraph(tmpDir, "esc-docs", "演示");
    const dir = path.join(tmpDir, ".graph", "esc-docs");
    createNode(dir, {
      id: "ctx-billing",
      type: NodeType.Context,
      label: "计费 | 账务",
    });
    writeNode(dir, { ...getNode(dir, "ctx-billing"), boundary: "发票 | 支付" });

    const result = runDocsExport(tmpDir, {});
    expect(result.contextCount).toBe(1);

    const md = fs.readFileSync(path.join(tmpDir, "CONTEXT-MAP.md"), "utf-8");
    const dataRow = md.split("\n").find((l) => l.includes("ctx-billing"));
    expect(dataRow).toBeDefined();
    // 竖线以 \| 落盘（label 与 boundary 一致）
    expect(dataRow).toContain("计费 \\| 账务");
    expect(dataRow).toContain("发票 \\| 支付");
    // 剥掉转义竖线后按 | 分列：首尾定界 + 恰好 4 列（撕裂列 = 转义失败）
    const cols = dataRow!.replace(/\\\|/g, "\x00").split("|");
    expect(cols).toHaveLength(6);
  });
});
