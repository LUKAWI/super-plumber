// tests/core/perf.test.ts — 大图热路径性能回归（5k 节点级）
// 目的：防止 checkReadyGate / computeNextActions 重新退化为全图扫描 / O(N²)。
// 阈值宽松防 CI flaky（stat 校验 ~0.2s@5k，冷构建 ~8s），只断言数量级。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";
import {
  computeNextActions,
  resetIndexCache,
} from "../../src/core/graph.js";
import { checkReadyGate, getNode } from "../../src/core/node.js";
import { NodeStatus, NodeType } from "../../src/core/types.js";
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
  // 性能 seam 只测 index/next，不把 9,999 次公共写事务、事件和 amend 快照成本
  // 混进 beforeEach。夹具直接写确定性、schema 合法的 YAML，最后一次性重建 refs。
  const graphDir = path.join(tmpDir, ".graph");
  const nodeDir = path.join(graphDir, "nodes");
  const edgeDir = path.join(graphDir, "edges");
  const now = "2026-01-01T00:00:00.000Z";
  for (let i = 0; i < N; i++) {
    fs.writeFileSync(
      path.join(nodeDir, `n${i}.yaml`),
      yaml.dump({
        id: `n${i}`,
        type: NodeType.Task,
        label: `n${i}`,
        level: 1,
        status: NodeStatus.Pending,
        attempts: 0,
        max_attempts: 3,
        created_at: now,
        updated_at: now,
      }, { indent: 2, lineWidth: 120 }),
      "utf-8",
    );
  }
  for (let i = 0; i < N - 1; i++) {
    fs.writeFileSync(
      path.join(edgeDir, `e${i}.yaml`),
      yaml.dump({
        id: `e${i}`,
        source: `n${i}`,
        target: `n${i + 1}`,
        type: EdgeType.DependsOn,
      }, { indent: 2, lineWidth: 120 }),
      "utf-8",
    );
  }
  rebuildGraphRefs(tmpDir);
  return tmpDir;
}

describe("perf: 5k 节点链式图热路径", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = buildChainGraph();
  }, 120_000);

  beforeEach(() => {
    resetIndexCache();
  });

  afterAll(() => {
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
