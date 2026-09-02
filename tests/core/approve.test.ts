// tests/core/approve.test.ts — DEC-1（g080-approve-core）：设计审核凭据
// approveGraph 写入（review 字段 + design_approved 事件）与 review_flag 注入。
// 红线回归：review 仅记录、零门禁——无 review 凭据时状态机全链路照常通过。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { approveGraph, readGraph, writeGraph } from "../../src/core/parser.js";
import { createNode, updateNodeStatus, updateExecutionReport } from "../../src/core/node.js";
import { computeNextActions, reviewFlagFor, REVIEW_FLAG_UNREVIEWED } from "../../src/core/scheduler.js";
import { readEvents } from "../../src/core/eventlog.js";
import { validateGraph } from "../../src/core/schema.js";
import { NodeType, NodeStatus } from "../../src/core/types.js";

let tmpDir: string;

function skeletonGraph() {
  return {
    id: "g1",
    version: "0.8.0",
    label: "approve-test",
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-approve-"));
  writeGraph(tmpDir, skeletonGraph());
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("approveGraph（核心写入）", () => {
  it("落盘 review 字段：status 缺省 approved，by/at 齐全", () => {
    const g = approveGraph(tmpDir, { by: "alice" });
    expect(g.review).toBeDefined();
    expect(g.review!.status).toBe("approved");
    expect(g.review!.by).toBe("alice");
    expect(g.review!.at).toBeTruthy();
    // 真相源核验：graph.yaml 落盘后重读
    const onDisk = readGraph(tmpDir);
    expect(onDisk.review).toEqual(g.review);
  });

  it("self 与 approved 可区分（quick 自签显式传 self）", () => {
    approveGraph(tmpDir, { by: "quick-op", status: "self" });
    expect(readGraph(tmpDir).review!.status).toBe("self");
    approveGraph(tmpDir, { by: "bob", status: "approved" });
    expect(readGraph(tmpDir).review!.status).toBe("approved");
    expect(readGraph(tmpDir).review!.by).toBe("bob");
  });

  it("重复 approve 覆盖为最新凭据（幂等）", () => {
    approveGraph(tmpDir, { by: "alice" });
    approveGraph(tmpDir, { by: "bob", status: "self" });
    const r = readGraph(tmpDir).review!;
    expect(r.by).toBe("bob");
    expect(r.status).toBe("self");
  });

  it("追加 design_approved 事件（payload 含 by/status，actor=审核人）", () => {
    approveGraph(tmpDir, { by: "alice", status: "self" });
    approveGraph(tmpDir, { by: "bob" });
    const events = readEvents(tmpDir, { kind: "design_approved" });
    expect(events).toHaveLength(2);
    expect(events[0].actor).toBe("alice");
    expect(events[0].detail).toContain("by=alice");
    expect(events[0].detail).toContain("status=self");
    expect(events[1].actor).toBe("bob");
    expect(events[1].detail).toContain("status=approved");
  });

  it("空 by 直接拒绝（不落盘、不写事件）", () => {
    expect(() => approveGraph(tmpDir, { by: "" })).toThrow(/审核人/);
    expect(readGraph(tmpDir).review).toBeUndefined();
    expect(readEvents(tmpDir, { kind: "design_approved" })).toHaveLength(0);
  });

  it("图未初始化时按 ENOENT 报错（不静默造图）", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "topo-approve-empty-"));
    try {
      expect(() => approveGraph(empty, { by: "alice" })).toThrow();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("review_flag（core 注入面：ready_eligible 桶）", () => {
  it("图无 review 字段 → ready_eligible 条目注入定稿文案；ready 桶不注入", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    updateNodeStatus(tmpDir, "b", NodeStatus.Ready); // b 无前驱 → ready
    const r = computeNextActions(tmpDir);
    // a 冷启动在 ready_eligible；b 在 ready
    const a = r.ready_eligible.find((n) => n.id === "a");
    expect(a?.review_flag).toBe(REVIEW_FLAG_UNREVIEWED);
    const bReady = r.ready.find((n) => n.id === "b");
    expect(bReady).toBeDefined();
    expect(JSON.stringify(r.ready)).not.toContain("review_flag");
  });

  it("approve 后 review_flag 消失（写入失效调度缓存，立即可见）", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    let r = computeNextActions(tmpDir);
    expect(r.ready_eligible.find((n) => n.id === "a")?.review_flag).toBe(REVIEW_FLAG_UNREVIEWED);
    approveGraph(tmpDir, { by: "alice", status: "self" });
    r = computeNextActions(tmpDir);
    expect(r.ready_eligible.find((n) => n.id === "a")?.review_flag).toBeUndefined();
    expect(JSON.stringify(r.ready_eligible)).not.toContain("review_flag");
  });

  it("reviewFlagFor：无凭据 → 定稿文案；有凭据（self 也算已审）→ undefined", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    expect(reviewFlagFor(tmpDir)).toBe(REVIEW_FLAG_UNREVIEWED);
    approveGraph(tmpDir, { by: "q", status: "self" });
    expect(reviewFlagFor(tmpDir)).toBeUndefined();
  });
});

describe("零门禁红线（状态机无任何新拒绝规则）", () => {
  it("无 review 凭据的图：pending→ready→running→passed 全链路照常通过", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    expect(readGraph(tmpDir).review).toBeUndefined(); // 前置：确实未审核
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running, "agent-x");
    updateExecutionReport(tmpDir, "a", { summary: "done" });
    const done = updateNodeStatus(tmpDir, "a", NodeStatus.Passed);
    expect(done.status).toBe(NodeStatus.Passed);
    expect(done.assigned_to).toBe("agent-x");
  });

  it("approve 之后同样不影响任何状态转换（review 仅记录）", () => {
    approveGraph(tmpDir, { by: "alice" });
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    const running = updateNodeStatus(tmpDir, "a", NodeStatus.Running, "agent-y");
    expect(running.status).toBe(NodeStatus.Running);
  });
});

describe("schema 放行与形状校验（可选字段，零默认拒绝）", () => {
  it("无 review 字段的 graph.yaml 照常通过（存量图零迁移）", () => {
    expect(validateGraph(skeletonGraph())).toEqual([]);
  });

  it("合法 review（approved/self）通过", () => {
    const g = skeletonGraph() as any;
    g.review = { status: "self", by: "q", at: new Date().toISOString() };
    expect(validateGraph(g)).toEqual([]);
  });

  it("手编拼错在读入层拦截：非法 status / 缺 by", () => {
    const bad1 = skeletonGraph() as any;
    bad1.review = { status: "maybe", by: "x" };
    expect(validateGraph(bad1).some((i) => i.field === "status")).toBe(true);

    const bad2 = skeletonGraph() as any;
    bad2.review = { status: "approved", by: "" };
    expect(validateGraph(bad2).some((i) => i.field === "by")).toBe(true);
  });
});
