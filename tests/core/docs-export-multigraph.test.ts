// tests/core/docs-export-multigraph.test.ts — adr_0013（fix-v080-a1）：
// 多图工作区知识视图导出按图名分离（docs/<图名>/{adr,contexts,CONTEXT-MAP.md}），
// 根治 A1 跨图视图挤占（同号覆写 / .retired/ 误归档 / CONTEXT-MAP 翻烧饼 / contexts 混装）；
// 单图工作区保持既有共享路径不变（向后兼容）；显式透传优先于默认规则。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createGraph, writeWorkspaceDefault } from "../../src/core/graph-dir.js";
import { createAdr, createNode } from "../../src/core/node.js";
import { runDocsExport } from "../../src/core/docs-export.js";
import { NodeType } from "../../src/core/types.js";

let tmpDir: string; // 工作区根

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-adr13-docs-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function graphDir(name: string): string {
  return path.join(tmpDir, ".graph", name);
}

/** 给图加一张 adr_0001（与另一张图同号）+ 一个 context——多图 A1 冲突的最小现场 */
function addConflictingKnowledge(name: string): void {
  const g = graphDir(name);
  createAdr(g, { title: `${name} 的同号决策`, decision: `${name} decision` });
  createNode(g, { id: `ctx_${name}`, type: NodeType.Context, label: `${name} 上下文` });
}

function snapshotTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(path.relative(dir, p), fs.readFileSync(p, "utf-8"));
    }
  };
  walk(dir);
  return out;
}

describe("多图工作区：知识视图按图名分离（adr_0013）", () => {
  it("两图各含同号 adr_0001：交叉导出各落 docs/<图名>/，互不挤占、无 .retired/", () => {
    createGraph(tmpDir, "alpha", "A 图");
    createGraph(tmpDir, "beta", "B 图");
    // 真实 CLI 场景 active 由 init/switch 写入（core createGraph 不写）；无 active 的
    // 多图解析会被 toGraphDir 回落 .graph/ 根——测试模拟真实状态
    writeWorkspaceDefault(tmpDir, "alpha");
    addConflictingKnowledge("alpha");
    addConflictingKnowledge("beta");

    // 图 A 导出 → docs/alpha/…；共享路径不得被触碰
    const ra = runDocsExport(tmpDir, {});
    expect(ra.adrCount).toBe(1);
    expect(
      fs.existsSync(path.join(tmpDir, "docs", "alpha", "adr", "0001-alpha-的同号决策.md")),
    ).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "docs", "alpha", "contexts", "ctx_alpha.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "docs", "alpha", "CONTEXT-MAP.md"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "docs", "alpha", "CONTEXT-MAP.md"), "utf-8")).toContain(
      "contexts/ctx_alpha.md",
    );
    expect(fs.existsSync(path.join(tmpDir, "CONTEXT-MAP.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "docs", "adr"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "docs", "contexts"))).toBe(false);

    // 图 B 导出 → docs/beta/…；A 的视图字节级原样（挤占 = 本断言失败）
    const before = snapshotTree(path.join(tmpDir, "docs", "alpha"));
    const rb = runDocsExport(path.join(tmpDir, ".graph", "beta"), {}); // rootDir 直传图目录同合法
    expect(rb.adrCount).toBe(1);
    expect(
      fs.existsSync(path.join(tmpDir, "docs", "beta", "adr", "0001-beta-的同号决策.md")),
    ).toBe(true);
    expect(snapshotTree(path.join(tmpDir, "docs", "alpha"))).toEqual(before);
    // 无 .retired/ 归档（同号冲突只发生在图间，图间已物理隔离）
    expect(fs.existsSync(path.join(tmpDir, "docs", "beta", "adr", ".retired"))).toBe(false);
    // 根 CONTEXT-MAP.md 仍未被任何一图写入（翻烧饼根治）
    expect(fs.existsSync(path.join(tmpDir, "CONTEXT-MAP.md"))).toBe(false);
  });

  it("显式 --adr-dir/--ctx-dir 透传优先于按图名分离默认", () => {
    createGraph(tmpDir, "alpha", "A 图");
    createGraph(tmpDir, "beta", "B 图");
    writeWorkspaceDefault(tmpDir, "alpha");
    addConflictingKnowledge("alpha");

    runDocsExport(tmpDir, { adrDir: "custom-adr", ctxDir: "custom-ctx" });
    expect(fs.existsSync(path.join(tmpDir, "custom-adr", "0001-alpha-的同号决策.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "custom-ctx", "ctx_alpha.md"))).toBe(true);
    // 多图工作区根 CONTEXT-MAP.md 永不被导出触碰（防挤占不变式，透传只接管 adr/ctx 子目录）；
    // CONTEXT-MAP 视图归属当前图的分离目录
    expect(fs.existsSync(path.join(tmpDir, "CONTEXT-MAP.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "docs", "alpha", "CONTEXT-MAP.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "docs", "alpha"))).toBe(true);
    expect(
      fs.readFileSync(path.join(tmpDir, "docs", "alpha", "CONTEXT-MAP.md"), "utf-8"),
    ).toContain("../../custom-ctx/ctx_alpha.md");
  });
});

describe("单图工作区：路径与行为不变（向后兼容）", () => {
  it("唯一图导出仍落 docs/adr、docs/contexts、根 CONTEXT-MAP.md", () => {
    createGraph(tmpDir, "solo", "单图");
    addConflictingKnowledge("solo");

    const r = runDocsExport(tmpDir, {});
    expect(r.adrCount).toBe(1);
    expect(r.contextCount).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, "docs", "adr", "0001-solo-的同号决策.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "docs", "contexts", "ctx_solo.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "CONTEXT-MAP.md"))).toBe(true);
    // 不应出现按图分离目录
    expect(fs.existsSync(path.join(tmpDir, "docs", "solo"))).toBe(false);
  });
});
