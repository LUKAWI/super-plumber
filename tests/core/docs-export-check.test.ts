// tests/core/docs-export-check.test.ts — 0.9.0 导出漂移门禁（checkDocsExport）：
// 与 runDocsExport 共用同一渲染计划，"重导出会写什么" = "在位文件该是什么"；
// 内容不一致或在位缺失都算漂移；行尾 CRLF 不算漂移（git autocrlf 检出友好）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createGraph, writeWorkspaceDefault } from "../../src/core/graph-dir.js";
import { createAdr, createNode } from "../../src/core/node.js";
import { runDocsExport, checkDocsExport } from "../../src/core/docs-export.js";
import { NodeType } from "../../src/core/types.js";

let tmpDir: string; // 工作区根

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-docs-check-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 多图工作区最小现场：alpha（active）含 1 ADR + 1 context，beta 仅用于触发按图分树 */
function seedWorkspace(): { adrRel: string } {
  createGraph(tmpDir, "alpha", "A 图");
  createGraph(tmpDir, "beta", "B 图");
  writeWorkspaceDefault(tmpDir, "alpha");
  const g = path.join(tmpDir, ".graph", "alpha");
  createAdr(g, { title: "样例决策", decision: "样例 decision" });
  createNode(g, { id: "ctx_demo", type: NodeType.Context, label: "demo 上下文" });
  const result = runDocsExport(tmpDir, {});
  // written[0] = 唯一 ADR 视图（写盘序：ADR → context → CONTEXT-MAP → DECISIONS）
  return { adrRel: result.written[0] };
}

describe("checkDocsExport：导出漂移门禁", () => {
  it("导出后未动：无漂移，checked = 导出文件数（ADR+context+CONTEXT-MAP+DECISIONS）", () => {
    seedWorkspace();
    const { checked, drift } = checkDocsExport(tmpDir, {});
    expect(drift).toEqual([]);
    expect(checked).toBe(4); // 1 ADR + 1 context 文件 + CONTEXT-MAP.md + DECISIONS.md
  });

  it("手改在位导出文件：drift 恰指名该文件（相对路径口径与 written 一致）", () => {
    const { adrRel } = seedWorkspace();
    fs.appendFileSync(path.join(tmpDir, adrRel), "\n手改的一行：制造漂移\n", "utf-8");
    const { drift } = checkDocsExport(tmpDir, {});
    expect(drift).toEqual([adrRel]);
  });

  it("在位文件缺失：算漂移并指名", () => {
    const { adrRel } = seedWorkspace();
    // 本机环境对特定 Unicode 文件名 fs.rmSync 会静默不删（docs-export.ts D4 注记同类），
    // 用 unlinkSync 确保删除真实发生
    fs.unlinkSync(path.join(tmpDir, adrRel));
    const { drift } = checkDocsExport(tmpDir, {});
    expect(drift).toEqual([adrRel]);
  });

  it("行尾 CRLF 不算漂移：git autocrlf 检出把 LF 视图转 CRLF 后仍应绿", () => {
    const { adrRel } = seedWorkspace();
    const p = path.join(tmpDir, adrRel);
    const crlf = fs.readFileSync(p, "utf-8").replace(/\n/g, "\r\n");
    fs.writeFileSync(p, crlf, "utf-8");
    const { drift } = checkDocsExport(tmpDir, {});
    expect(drift).toEqual([]);
  });

  it("显式透传 adrDir：按同一目录比对（透传优先于默认规则，与导出一致）", () => {
    createGraph(tmpDir, "alpha", "A 图");
    createGraph(tmpDir, "beta", "B 图");
    writeWorkspaceDefault(tmpDir, "alpha");
    createAdr(path.join(tmpDir, ".graph", "alpha"), {
      title: "透传决策",
      decision: "d",
    });
    runDocsExport(tmpDir, { adrDir: path.join("docs", "custom-adr") });
    const { checked, drift } = checkDocsExport(tmpDir, {
      adrDir: path.join("docs", "custom-adr"),
    });
    expect(drift).toEqual([]);
    expect(checked).toBe(2); // 1 ADR + DECISIONS.md（无 context → 不产 CONTEXT-MAP）
  });
});
