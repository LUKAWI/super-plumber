// tests/core/review.test.ts — arch-c4b 审批凭据成家：review.ts 单家直引面。
// approveGraph / resetGraphReview 自 parser.ts 迁入 review.ts（parser 保留兼容
// re-export，approve.test.ts 深引 parser 的既有覆盖不变），本文件从新家直引，
// 回归凭据写入/回置行为不变、review 模块不回指 parser。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { approveGraph, resetGraphReview } from "../../src/core/review.js";
import { readGraph, writeGraph } from "../../src/core/graph-io.js";
import { readEvents } from "../../src/core/eventlog.js";

let tmpDir: string;

function skeletonGraph() {
  return {
    id: "g1",
    version: "0.8.0",
    label: "review-home-test",
    entry: { description: "e", defined_by: "human" as const, level: 0 },
    exit: {
      description: "x",
      acceptance_criteria: [],
      defined_by: "human" as const,
      level: 0,
    },
    nodes: [],
    edges: [],
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-review-home-"));
  writeGraph(tmpDir, skeletonGraph());
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("approveGraph（review.ts 新家直引）", () => {
  it("写入 review 凭据 + design_approved 事件（与 parser 兼容面同源）", () => {
    const g = approveGraph(tmpDir, { by: "alice", status: "self" });
    expect(g.review).toEqual({ status: "self", by: "alice", at: expect.any(String) });
    expect(readGraph(tmpDir).review).toEqual(g.review);
    const events = readEvents(tmpDir, { kind: "design_approved" });
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe("alice");
    expect(events[0].detail).toContain("status=self");
  });
});

describe("resetGraphReview（F21(b) 回置，review.ts 新家直引）", () => {
  it("已审核图回置 unreviewed（by=触发通道，at=now），返回 true 且落盘", () => {
    approveGraph(tmpDir, { by: "alice" });
    const before = readGraph(tmpDir).review!;
    const reset = resetGraphReview(tmpDir, { actor: "mcp-client" });
    expect(reset).toBe(true);
    const after = readGraph(tmpDir).review!;
    expect(after.status).toBe("unreviewed");
    expect(after.by).toBe("mcp-client");
    expect(after.at >= before.at).toBe(true);
    // 回置只写凭据：不追加 design_approved 事件（审计事件归 amend 的 graph_amended）
    expect(readEvents(tmpDir, { kind: "design_approved" })).toHaveLength(1);
  });

  it("从未审核的图原样不动，返回 false", () => {
    expect(resetGraphReview(tmpDir, { actor: "cli" })).toBe(false);
    expect(readGraph(tmpDir).review).toBeUndefined();
  });

  it("图未初始化返回 false（不静默造图）", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "topo-review-home-empty-"));
    try {
      expect(resetGraphReview(empty)).toBe(false);
      // .graph/.locks/ 由锁层 mkdirSync 创建（既有行为）；图文件本身不得被造出
      expect(fs.existsSync(path.join(empty, ".graph", "graph.yaml"))).toBe(false);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
