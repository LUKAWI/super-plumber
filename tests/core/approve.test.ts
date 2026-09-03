// tests/core/approve.test.ts — DEC-1（g080-approve-core）：设计审核凭据
// approveGraph 写入（review 字段 + design_approved 事件）与 review_flag 注入。
// F08（0.9.2 渐进审批）：--level 分层批准（layers 落盘形状/同层覆盖/事件 level/
// 非 program 图零拒绝/旧图零迁移）。
// 红线回归：review 仅记录、零门禁——无 review 凭据时状态机全链路照常通过。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  approveGraph,
  resetGraphReview,
  readGraph,
  writeGraph,
} from "../../src/core/parser.js";
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

// ── F08（0.9.2 渐进审批）：approve --level 分批准入 ──
describe("F08 分层 approve（--level / level 参数）", () => {
  it("带 level：整图凭据照写 + review.layers 追加一条 {level,by,at}（落盘重读核验）", () => {
    const g = approveGraph(tmpDir, { by: "alice", level: "L1" });
    expect(g.review!.status).toBe("approved");
    expect(g.review!.by).toBe("alice");
    expect(g.review!.layers).toEqual([
      { level: "L1", by: "alice", at: g.review!.layers![0].at },
    ]);
    expect(g.review!.layers![0].at).toBeTruthy();
    // 真相源核验：graph.yaml 落盘后重读
    const onDisk = readGraph(tmpDir).review!;
    expect(onDisk.layers).toHaveLength(1);
    expect(onDisk.layers![0].level).toBe("L1");
    expect(onDisk.layers![0].by).toBe("alice");
  });

  it("多层追加保持首次批准顺序；同层重复 approve 覆盖更新该层 by/at（不新增条目）", () => {
    approveGraph(tmpDir, { by: "alice", level: "L1" });
    approveGraph(tmpDir, { by: "bob", level: "L2" });
    // 同层重复：L1 换人重批 → 原位覆盖，顺序仍是 L1, L2
    const g = approveGraph(tmpDir, { by: "carol", level: "L1" });
    expect(g.review!.layers!.map((l) => l.level)).toEqual(["L1", "L2"]);
    expect(g.review!.layers![0].by).toBe("carol");
    // 真相源核验：仍是 2 条，无重复
    expect(readGraph(tmpDir).review!.layers).toHaveLength(2);
    expect(readGraph(tmpDir).review!.layers![0].by).toBe("carol");
  });

  it("事件 payload 含 level（detail 追加 level=L…）；不带 level 的 detail 不含 level=", () => {
    approveGraph(tmpDir, { by: "alice", level: "L1" });
    approveGraph(tmpDir, { by: "bob" });
    const events = readEvents(tmpDir, { kind: "design_approved" });
    expect(events).toHaveLength(2);
    expect(events[0].detail).toContain("by=alice");
    expect(events[0].detail).toContain("level=L1");
    expect(events[1].detail).toContain("by=bob");
    expect(events[1].detail).not.toContain("level=");
  });

  it("零拒绝红线：非 program 图（无 class 标注）与 quick 图带 level 均成功落记录", () => {
    expect(readGraph(tmpDir).class).toBeUndefined(); // 前置：本图无 class 标注
    const g1 = approveGraph(tmpDir, { by: "alice", level: "L1" });
    expect(g1.review!.layers).toHaveLength(1);
    // quick 图同样照写（档位路由是 skill 口径，工具不强制）
    writeGraph(tmpDir, { ...skeletonGraph(), class: "quick" });
    const g2 = approveGraph(tmpDir, { by: "bob", level: "L2" });
    expect(g2.review!.layers).toEqual([
      expect.objectContaining({ level: "L2", by: "bob" }),
    ]);
  });

  it("不带 level 的整图 approve 行为回归不变：layers 缺省不存在（undefined 非空数组）", () => {
    const g = approveGraph(tmpDir, { by: "alice" });
    expect(g.review!.layers).toBeUndefined();
    expect(readGraph(tmpDir).review!.layers).toBeUndefined();
  });

  it("整图 approve（不带 level）覆盖清掉层批记录（最新一次审核生效；历史仍可查 events）", () => {
    approveGraph(tmpDir, { by: "alice", level: "L1" });
    approveGraph(tmpDir, { by: "boss" }); // 整图凭据覆盖一切层批
    expect(readGraph(tmpDir).review!.layers).toBeUndefined();
    const events = readEvents(tmpDir, { kind: "design_approved" });
    expect(events).toHaveLength(2); // append-only：层批事件不丢
    expect(events[0].detail).toContain("level=L1");
  });

  it("旧图无 layers 字段兼容：手编 review 无 layers 照常读入，再带 level 正常追加（零迁移）", () => {
    const g = skeletonGraph() as any;
    g.review = { status: "unreviewed", by: "amend", at: "2026-01-01T00:00:00.000Z" };
    writeGraph(tmpDir, g);
    const out = approveGraph(tmpDir, { by: "alice", level: "L1" });
    expect(out.review!.layers).toEqual([expect.objectContaining({ level: "L1", by: "alice" })]);
  });

  it("resetGraphReview 回置后 layers 一并作废（层批的是修订前旧结构，增量人审从零重走）", () => {
    approveGraph(tmpDir, { by: "alice", level: "L1" });
    expect(readGraph(tmpDir).review!.layers).toHaveLength(1);
    expect(resetGraphReview(tmpDir, { actor: "cli:amend" })).toBe(true);
    const r = readGraph(tmpDir).review!;
    expect(r.status).toBe("unreviewed");
    expect(r.layers).toBeUndefined();
  });
});

describe("F08 schema：layers 形状校验（宽容缺省/严格存在）", () => {
  it("合法 layers 通过", () => {
    const g = skeletonGraph() as any;
    g.review = {
      status: "approved",
      by: "q",
      at: new Date().toISOString(),
      layers: [{ level: "L1", by: "alice", at: new Date().toISOString() }],
    };
    expect(validateGraph(g)).toEqual([]);
  });

  it("手编拼错在读入层拦截：layers 非数组 / 项缺 level / 项 by 为空", () => {
    const base = () => skeletonGraph() as any;

    const bad1 = base();
    bad1.review = { status: "approved", by: "q", layers: "L1" };
    expect(validateGraph(bad1).some((i) => i.field === "layers")).toBe(true);

    const bad2 = base();
    bad2.review = {
      status: "approved",
      by: "q",
      layers: [{ by: "alice", at: "2026-01-01T00:00:00.000Z" }], // 缺 level
    };
    expect(validateGraph(bad2).some((i) => i.field === "level")).toBe(true);

    const bad3 = base();
    bad3.review = {
      status: "approved",
      by: "q",
      layers: [{ level: "L1", by: "", at: "2026-01-01T00:00:00.000Z" }],
    };
    expect(validateGraph(bad3).some((i) => i.field === "by")).toBe(true);
  });
});
