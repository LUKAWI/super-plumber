// tests/core/docs-export-decisions.test.ts — F15（0.8.1）：
// graph export --docs 增发 DECISIONS.md 决议一行索引——passed 的 task 节点 +
// accepted/superseded 的 ADR 各一行（id/标题/结论时间），一屏可读；
// proposed ADR 与未 passed task 不入索引；落盘位置与 CONTEXT-MAP.md 同目录约定
// （单图 → 工作区根；多图 → docs/<图名>/，按图名分离）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createGraph, writeWorkspaceDefault } from "../../src/core/graph-dir.js";
import { createAdr, createNode } from "../../src/core/node.js";
import { readNode, writeNode } from "../../src/core/parser.js";
import { runDocsExport } from "../../src/core/docs-export.js";
import { AdrStatus, NodeStatus, NodeType } from "../../src/core/types.js";

let tmpDir: string; // 工作区根

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f15-decisions-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function graphDir(name: string): string {
  return path.join(tmpDir, ".graph", name);
}

/** 把已建节点置为 passed 并写入 completed_at（writeNode 只做 schema 校验，不过状态机） */
function markPassed(g: string, id: string, completedAt: string): void {
  const n = readNode(g, id);
  writeNode(g, {
    ...n,
    status: NodeStatus.Passed,
    updated_at: completedAt,
    execution_report: { summary: "done", completed_at: completedAt },
  });
}

/** 建 ADR 并置为指定状态（superseded 必带接替者，schema 强制） */
function makeAdr(
  g: string,
  title: string,
  status: AdrStatus,
  opts: { supersededBy?: string; updatedAt?: string } = {},
): string {
  const id = createAdr(g, { title, decision: `${title} decision` }).id;
  const a = readNode(g, id);
  writeNode(g, {
    ...a,
    status,
    updated_at: opts.updatedAt ?? "2026-08-31T00:00:09.000Z",
    ...(status === AdrStatus.Superseded
      ? { superseded_by: opts.supersededBy ?? "adr_0001" }
      : {}),
  });
  return id;
}

describe("F15：DECISIONS.md 决议一行索引", () => {
  it("passed task + accepted/superseded ADR 各一行；proposed ADR 与未 passed task 不入索引", () => {
    createGraph(tmpDir, "solo", "单图");
    const g = graphDir("solo");
    createNode(g, { id: "l1_done", type: NodeType.Task, label: "已完成节点", level: 1 });
    createNode(g, { id: "l1_todo", type: NodeType.Task, label: "未完成节点", level: 1 });
    markPassed(g, "l1_done", "2026-08-31T00:00:01.000Z");
    makeAdr(g, "已接受的决策", AdrStatus.Accepted, {
      updatedAt: "2026-08-31T00:00:02.000Z",
    });
    makeAdr(g, "被接替的决策", AdrStatus.Superseded, {
      updatedAt: "2026-08-31T00:00:03.000Z",
    });
    makeAdr(g, "待裁决的决策", AdrStatus.Proposed);

    const r = runDocsExport(tmpDir, {});
    expect(r.decisionCount).toBe(3); // 1 passed task + 2 ADR（accepted/superseded）

    const md = fs.readFileSync(path.join(tmpDir, "DECISIONS.md"), "utf-8");
    // 一行索引：id / 标题 / 结论时间齐全
    expect(md).toContain("| task · passed | l1_done | 已完成节点 | 2026-08-31T00:00:01.000Z |");
    expect(md).toContain("| ADR · accepted | adr_0001 | 已接受的决策 | 2026-08-31T00:00:02.000Z |");
    expect(md).toContain("| ADR · superseded | adr_0002 | 被接替的决策 | 2026-08-31T00:00:03.000Z |");
    // 排除面：proposed ADR、未 passed task 不得出现
    expect(md).not.toContain("待裁决的决策");
    expect(md).not.toContain("adr_0003");
    expect(md).not.toContain("l1_todo");
    // 单图落工作区根（与 CONTEXT-MAP.md 同目录）
    expect(fs.existsSync(path.join(tmpDir, "docs", "DECISIONS.md"))).toBe(false);
  });

  it("空决议图也落盘 DECISIONS.md（索引恒在，行为可预期）", () => {
    createGraph(tmpDir, "empty", "空图");
    const r = runDocsExport(tmpDir, {});
    expect(r.decisionCount).toBe(0);
    const md = fs.readFileSync(path.join(tmpDir, "DECISIONS.md"), "utf-8");
    expect(md).toContain("尚无决议记录");
  });

  it("多图工作区：DECISIONS.md 随图名分离（docs/<图名>/），不落工作区根", () => {
    createGraph(tmpDir, "alpha", "A 图");
    createGraph(tmpDir, "beta", "B 图");
    writeWorkspaceDefault(tmpDir, "alpha");
    const g = graphDir("alpha");
    createNode(g, { id: "l1_a", type: NodeType.Task, label: "A 完成", level: 1 });
    markPassed(g, "l1_a", "2026-08-31T00:00:05.000Z");

    const r = runDocsExport(tmpDir, {});
    expect(r.decisionCount).toBe(1);
    expect(
      fs.existsSync(path.join(tmpDir, "docs", "alpha", "DECISIONS.md")),
    ).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "DECISIONS.md"))).toBe(false);
  });
});
