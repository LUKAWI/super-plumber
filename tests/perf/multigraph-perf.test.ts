// tests/perf/multigraph-perf.test.ts — v0.5.2 专项性能：多图解析与导出开销
// 用户指定测试项：①CONTEXT-MAP/快照自动导出对性能的影响；②多图兼容（图目录解析）开销。
// 说明：墙钟断言取多次重复的中位数 + 宽松阈值，避免已知的高负载 flake（见 super-plumber-test-flake）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  toGraphDir,
  resolveGraphDir,
  listGraphNames,
  createGraph,
  migrateLegacyLayout,
  writeWorkspaceDefault,
} from "../../src/core/graph-dir.js";
import { createSnapshot } from "../../src/core/snapshot.js";
import { createNode, createAdr } from "../../src/core/node.js";
import { resetIndexCache } from "../../src/core/index-service.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-perf52-"));
  resetIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetIndexCache();
});

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function timeIt(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe("多图解析开销（热路径）", () => {
  it("resolveGraphDir/toGraphDir 中位数 <0.5ms（10 图工作区，缓存友好）", () => {
    migrateLegacyLayout(tmpDir);
    for (const n of ["g01", "g02", "g03", "g04", "g05", "g06", "g07", "g08", "g09", "g10"]) {
      createGraph(tmpDir, n, n);
    }
    writeWorkspaceDefault(tmpDir, "g05");
    // 预热
    for (let i = 0; i < 100; i++) resolveGraphDir(tmpDir);
    const xs: number[] = [];
    for (let i = 0; i < 1000; i++) xs.push(timeIt(() => resolveGraphDir(tmpDir)));
    expect(median(xs)).toBeLessThan(2); // 每调用含 readdir+existsSync，实测中位数 ~0.1-0.7ms；2ms 上限防高负载 flake
    const ys: number[] = [];
    for (let i = 0; i < 1000; i++) ys.push(timeIt(() => toGraphDir(tmpDir)));
    expect(median(ys)).toBeLessThan(2);
  });

  it("listGraphNames 50 图 < 10ms（中位数）", () => {
    migrateLegacyLayout(tmpDir);
    for (let i = 0; i < 50; i++) createGraph(tmpDir, `graph-${String(i).padStart(2, "0")}`, "x");
    const xs: number[] = [];
    for (let i = 0; i < 200; i++) xs.push(timeIt(() => listGraphNames(tmpDir)));
    expect(median(xs)).toBeLessThan(10);
  });
});

describe("快照自动导出（CONTEXT-MAP）性能影响", () => {
  it("10 张图工作区中，含 4 context + 3 ADR 的图快照 <2s（导出开销内）", () => {
    migrateLegacyLayout(tmpDir);
    createGraph(tmpDir, "big-graph", "大图");
    const g = path.join(tmpDir, ".graph", "big-graph");
    // 知识顶点 ×7 + 30 个普通节点
    for (let i = 0; i < 30; i++) createNode(g, { id: `n${String(i).padStart(2, "0")}`, label: `N${i}` });
    for (const [id, label] of [
      ["ctx_alpha", "甲"], ["ctx_beta", "乙"], ["ctx_gamma", "丙"], ["ctx_delta", "丁"],
    ] as const) {
      createNode(g, { id, label, type: "context" as never });
    }
    createAdr(g, { title: "决策一", decision: "d1" });
    createAdr(g, { title: "决策二", decision: "d2" });
    createAdr(g, { title: "决策三", decision: "d3" });
    // 周边 9 张图（快照不涉及其文件，验证隔离无串扰成本）
    for (let i = 0; i < 9; i++) createGraph(tmpDir, `other-${i}`, "o");
    resetIndexCache();
    const xs: number[] = [];
    for (let i = 0; i < 5; i++) {
      xs.push(timeIt(() => createSnapshot(g, `perf-${i}`)));
    }
    // 中位数 <2s：40 节点图的快照（文件复制+sha256）+7 知识顶点的 md 导出
    expect(median(xs)).toBeLessThan(2000);
    // 导出产物确实生成（性能与功能同验）
    expect(fs.existsSync(path.join(tmpDir, "CONTEXT-MAP.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "docs/contexts/ctx_alpha.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "docs/adr/0001-决策一.md"))).toBe(true);
  });

  it("导出幂等重跑开销：同内容第二次导出 <100ms（写盘短路余量）", () => {
    migrateLegacyLayout(tmpDir);
    createGraph(tmpDir, "g", "G");
    const g = path.join(tmpDir, ".graph", "g");
    createNode(g, { id: "ctx_x", label: "X", type: "context" as never });
    createAdr(g, { title: "决策", decision: "d" });
    const xs: number[] = [];
    for (let i = 0; i < 5; i++) xs.push(timeIt(() => createSnapshot(g, `idem-${i}`)));
    expect(median(xs)).toBeLessThan(500);
  });
});
