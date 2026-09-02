// tests/core/graph-dir-memo.test.ts — arch-c2：图目录路径解析的进程内 memo
// DoD 证据：①memo 命中计数器断言（同一 cwd 重复解析免 readdir/逐图 existsSync）；
// ②语义不变（同 cwd 同结果）；③写路径（切默认图/建图/删图）显式失效不回陈旧值；
// ④键 = 绝对化工作区根，跨 cwd 不串扰；⑤未初始化目录不进 memo。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  toGraphDir,
  createGraph,
  writeWorkspaceDefault,
  trashGraph,
  resetGraphDirMemo,
  graphDirMemoStats,
} from "../../src/core/graph-dir.js";
import { resetIndexCache } from "../../src/core/index-service.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-dirmemo-"));
  resetGraphDirMemo();
  resetIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetGraphDirMemo();
  resetIndexCache();
});

function legacyInit(label = "旧布局图"): void {
  fs.mkdirSync(path.join(tmpDir, ".graph", "nodes"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, ".graph", "edges"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, ".graph", "graph.yaml"),
    `id: g_legacy\nlabel: ${label}\nentry:\n  description: ""\n  defined_by: human\n  level: 0\nexit:\n  description: ""\n  acceptance_criteria: []\n  defined_by: human\n  level: 0\nnodes: []\nedges: []\n`,
    "utf-8",
  );
}

describe("toGraphDir 路径解析 memo（arch-c2）", () => {
  it("同一 cwd 重复解析命中 memo（计数器证据），结果逐次一致", () => {
    createGraph(tmpDir, "alpha", "甲");
    writeWorkspaceDefault(tmpDir, "alpha");
    resetGraphDirMemo(); // 建图/切图显式失效后归零，取纯读基线
    const first = toGraphDir(tmpDir);
    expect(first).toBe(path.join(tmpDir, ".graph", "alpha"));
    expect(graphDirMemoStats().hits).toBe(0); // 首次 = 回源建 memo
    for (let i = 0; i < 9; i++) {
      expect(toGraphDir(tmpDir)).toBe(first); // 语义不变：同 cwd 同结果
    }
    expect(graphDirMemoStats().hits).toBe(9);
  });

  it("旧布局（.graph/graph.yaml 原地）同样进 memo 且命中", () => {
    legacyInit();
    expect(toGraphDir(tmpDir)).toBe(path.join(tmpDir, ".graph"));
    expect(toGraphDir(tmpDir)).toBe(path.join(tmpDir, ".graph"));
    expect(graphDirMemoStats().hits).toBe(1);
  });

  it("切默认图（writeWorkspaceDefault）后 memo 不回陈旧结果", () => {
    createGraph(tmpDir, "a1", "一");
    createGraph(tmpDir, "a2", "二");
    writeWorkspaceDefault(tmpDir, "a1");
    resetGraphDirMemo(); // 建图/切图的锁路径会预热 memo——归零取纯读基线
    expect(toGraphDir(tmpDir)).toBe(path.join(tmpDir, ".graph", "a1")); // miss 建条目
    expect(toGraphDir(tmpDir)).toBe(path.join(tmpDir, ".graph", "a1")); // hit
    expect(graphDirMemoStats()).toEqual({ hits: 1, size: 1 });
    writeWorkspaceDefault(tmpDir, "a2"); // 写路径显式失效（锁路径随后用新状态重建）
    expect(toGraphDir(tmpDir)).toBe(path.join(tmpDir, ".graph", "a2")); // 不回陈旧 a1
    expect(graphDirMemoStats().size).toBe(1);
  });

  it("建图/删图后 memo 失效：新图立即可解析、被删图不再返回", () => {
    createGraph(tmpDir, "only", "唯一");
    writeWorkspaceDefault(tmpDir, "only");
    expect(toGraphDir(tmpDir)).toBe(path.join(tmpDir, ".graph", "only"));
    createGraph(tmpDir, "second", "第二");
    expect(toGraphDir(tmpDir)).toBe(path.join(tmpDir, ".graph", "only")); // active 未变
    trashGraph(tmpDir, "only", "test");
    // active 指向被删图 → 解析报错路径（与 memo 前行为一致）：toGraphDir 返回 .graph/
    expect(toGraphDir(tmpDir)).toBe(path.join(tmpDir, ".graph"));
  });

  it("不同 cwd（工作区）不串扰：两个键各自独立命中", () => {
    const wsB = fs.mkdtempSync(path.join(os.tmpdir(), "topo-dirmemo-b-"));
    try {
      createGraph(tmpDir, "g1", "一号");
      writeWorkspaceDefault(tmpDir, "g1");
      createGraph(wsB, "g2", "二号");
      writeWorkspaceDefault(wsB, "g2");
      resetGraphDirMemo();
      const dirA = toGraphDir(tmpDir);
      const dirB = toGraphDir(wsB);
      expect(dirA).toBe(path.join(tmpDir, ".graph", "g1"));
      expect(dirB).toBe(path.join(wsB, ".graph", "g2"));
      // 交错读取各自命中，互不污染
      expect(toGraphDir(wsB)).toBe(dirB);
      expect(toGraphDir(tmpDir)).toBe(dirA);
      expect(graphDirMemoStats().hits).toBe(2);
      expect(graphDirMemoStats().size).toBe(2); // 两个独立键
    } finally {
      fs.rmSync(wsB, { recursive: true, force: true });
    }
  });

  it("读路径规模 smoke：热身后连续解析全部命中（10k 读路径免重复目录 I/O 的机理）", () => {
    createGraph(tmpDir, "hot", "热");
    writeWorkspaceDefault(tmpDir, "hot");
    toGraphDir(tmpDir); // 预热建 memo
    resetGraphDirMemo();
    toGraphDir(tmpDir);
    const before = graphDirMemoStats().hits;
    for (let i = 0; i < 2000; i++) toGraphDir(tmpDir);
    expect(graphDirMemoStats().hits - before).toBe(2000);
  });

  it("未初始化目录：返回 .graph 且不建 memo 条目", () => {
    const r = toGraphDir(tmpDir);
    expect(r).toBe(path.join(tmpDir, ".graph"));
    expect(graphDirMemoStats().size).toBe(0);
    expect(toGraphDir(tmpDir)).toBe(r);
    expect(graphDirMemoStats().size).toBe(0);
  });

  it("resetGraphDirMemo 清空条目与命中计数", () => {
    createGraph(tmpDir, "g", "G");
    writeWorkspaceDefault(tmpDir, "g");
    resetGraphDirMemo(); // 归零（建图/切图锁路径已预热 memo）
    toGraphDir(tmpDir); // miss 建条目
    toGraphDir(tmpDir); // hit
    expect(graphDirMemoStats()).toEqual({ hits: 1, size: 1 });
    resetGraphDirMemo();
    expect(graphDirMemoStats()).toEqual({ hits: 0, size: 0 });
  });
});
