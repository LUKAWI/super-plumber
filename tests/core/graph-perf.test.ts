// tests/core/graph-perf.test.ts — S3-8（f16）：topologicalSort / detectCycles 复杂度回归
// 背景：queue.shift() 头删 O(n) 使排序整体 O(n²)；环报错路径 filter×includes 同样 O(n²)。
// 10k 节点（链式 + 密集混合）必须秒级完成。纯函数无 I/O，直接构造内存图。
// 阈值给足余量（<10s）防 CI 抖动——正常应在几十 ms 内。
import { describe, it, expect } from "vitest";
import {
  topologicalSort,
  detectCycles,
} from "../../src/core/graph.js";
import { EdgeType } from "../../src/core/types.js";

const N = 10_000; // 10k 节点
const CHAIN = 5_000; // 前半链式
// 阈值：正常耗时数量级为几十 ms，10s 上限纯防 CI 抖动的宽松回归线
const BUDGET_MS = 10_000;

type E = { source: string; target: string; type: EdgeType };

function ids(): string[] {
  return Array.from({ length: N }, (_, i) => `n${i}`);
}

/** 链式 + 密集混合 DAG：n0→…→n4999 链；链尾汇聚到 hub n5000；hub 扇出到 n5001..n9999 */
function dagEdges(): E[] {
  const edges: E[] = [];
  for (let i = 0; i < CHAIN - 1; i++) {
    edges.push({ source: `n${i}`, target: `n${i + 1}`, type: EdgeType.DependsOn });
  }
  for (let i = 0; i < CHAIN; i++) {
    edges.push({ source: `n${i}`, target: `n${CHAIN}`, type: EdgeType.DependsOn }); // 链全员 → hub
  }
  for (let i = CHAIN + 1; i < N; i++) {
    edges.push({ source: `n${CHAIN}`, target: `n${i}`, type: EdgeType.DependsOn }); // hub 扇出
  }
  return edges;
}

function assertValidTopoOrder(order: string[], edges: E[]): void {
  expect(order).toHaveLength(N);
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const e of edges) {
    expect(pos.get(e.source)!).toBeLessThan(pos.get(e.target)!);
  }
}

describe("perf: 10k 节点 topologicalSort / detectCycles（S3-8）", () => {
  it("10k DAG（链式+密集混合）拓扑排序 < 10s 且顺序合法", () => {
    const nodeIds = ids();
    const edges = dagEdges();
    const t = Date.now();
    const order = topologicalSort(nodeIds, edges);
    const ms = Date.now() - t;
    console.log(`[S3-8] topologicalSort 10k DAG: ${ms}ms`);
    expect(ms).toBeLessThan(BUDGET_MS);
    assertValidTopoOrder(order, edges);
  });

  it("10k 环图：topologicalSort 报错路径 < 10s（含 5k 节点环上的未处理收集）", () => {
    const nodeIds = ids();
    const edges = dagEdges();
    // 闭合大环：hub 扇出的最后一个节点指回链头 → n0..n4999..hub 全部落环
    edges.push({ source: `n${N - 1}`, target: `n0`, type: EdgeType.DependsOn });
    const t = Date.now();
    expect(() => topologicalSort(nodeIds, edges)).toThrow(/Cycle detected/);
    const ms = Date.now() - t;
    console.log(`[S3-8] topologicalSort 10k cyclic throw path: ${ms}ms`);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("10k 环图：detectCycles 找到大环 < 10s", () => {
    const nodeIds = ids();
    const edges = dagEdges();
    edges.push({ source: `n${N - 1}`, target: `n0`, type: EdgeType.DependsOn });
    const t = Date.now();
    const cycles = detectCycles(nodeIds, edges);
    const ms = Date.now() - t;
    console.log(`[S3-8] detectCycles 10k cyclic: ${ms}ms (cycles=${cycles.length})`);
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    // 大环本身被检出（环成员含链头 n0 与 hub）
    const big = cycles.find((c) => c.includes("n0") && c.includes(`n${CHAIN}`));
    expect(big).toBeTruthy();
  });
});
