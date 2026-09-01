// tests/core/perf.test.ts — 大图热路径性能回归（5k 节点级）
// 目的：防止 checkReadyGate / computeNextActions 重新退化为全图扫描 / O(N²)。
// 阈值宽松防 CI flaky（stat 校验 ~0.2s@5k，冷构建 ~8s），只断言数量级。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  computeNextActions,
  resetIndexCache,
} from "../../src/core/graph.js";
import { createNode, checkReadyGate, getNode } from "../../src/core/node.js";
import { NodeType } from "../../src/core/types.js";
import { createEdge } from "../../src/core/edge.js";
import { rebuildGraphRefs, writeGraph } from "../../src/core/parser.js";
import { EdgeType } from "../../src/core/types.js";

const N = 5000;

function buildChainGraph(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-perf-"));
  writeGraph(tmpDir, {
    id: "g1",
    version: "0.2.0",
    label: "perf",
    entry: { description: "e", defined_by: "human", level: 0 },
    exit: { description: "x", acceptance_criteria: [], defined_by: "human", level: 0 },
    nodes: [],
    edges: [],
  });
  // F21 起逐次结构写自带守卫（落图前自动快照）——5k 次紧循环是批量构建场景，
  // 与 MCP batch_create 同理传 skipAmendGuard 跳过逐次快照（防 O(n²) 快照风暴），
  // 守卫本身的行为由 tests/core/amend.test.ts 专测。
  for (let i = 0; i < N; i++) {
    createNode(
      tmpDir,
      { id: "n" + i, type: NodeType.Task, label: "n" + i, level: 1 },
      { syncRef: false, skipAmendGuard: true },
    );
  }
  for (let i = 0; i < N - 1; i++) {
    createEdge(
      tmpDir,
      { id: "e" + i, source: "n" + i, target: "n" + (i + 1), type: EdgeType.DependsOn },
      { syncRef: false, skipAmendGuard: true },
    );
  }
  rebuildGraphRefs(tmpDir);
  return tmpDir;
}

describe("perf: 5k 节点链式图热路径", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetIndexCache();
    tmpDir = buildChainGraph();
  }, 120_000);

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetIndexCache();
  });

  it("冷路径（无缓存，首次构建）：computeNextActions < 15s 且结果正确", () => {
    const t = Date.now();
    const r = computeNextActions(tmpDir);
    const ms = Date.now() - t;
    // 链式图：只有入口 n0 无门控前驱
    expect(r.ready_eligible.map((n) => n.id)).toEqual(["n0"]);
    expect(r.blocked.length).toBe(N - 1);
    expect(ms).toBeLessThan(15_000);
  }, 60_000);

  it("热路径（内存缓存命中）：computeNextActions < 3s", () => {
    computeNextActions(tmpDir); // 预热
    const t = Date.now();
    computeNextActions(tmpDir);
    expect(Date.now() - t).toBeLessThan(3_000);
  }, 60_000);

  it("热路径：checkReadyGate < 3s（不再全图扫描）", () => {
    computeNextActions(tmpDir); // 预热索引
    const t = Date.now();
    const gate = checkReadyGate(tmpDir, "n" + (N - 1));
    const ms = Date.now() - t;
    expect(ms).toBeLessThan(3_000);
    expect(gate.ok).toBe(false);
    expect(gate.unmet[0].id).toBe("n" + (N - 2));
  }, 60_000);

  it("getNode 单节点读不受图规模影响", () => {
    const t = Date.now();
    const node = getNode(tmpDir, "n2500");
    expect(node.id).toBe("n2500");
    expect(Date.now() - t).toBeLessThan(500);
  }, 60_000);
});
