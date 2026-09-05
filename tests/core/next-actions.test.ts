// tests/core/next-actions.test.ts — 调度决策工具
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { computeNextActions } from "../../src/core/scheduler.js";
import { invalidateIndex } from "../../src/core/index-service.js";
import { createNode, updateNodeStatus, updateExecutionReport, updateNodeContent, getNode } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { NodeType, NodeStatus, EdgeType } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-next-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("computeNextActions", () => {
  it("线性链 a→b：a ready、b 等依赖", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);

    const r = computeNextActions(tmpDir);
    expect(r.ready.map((n) => n.id)).toEqual(["a"]);
    expect(r.blocked.map((n) => n.id)).toEqual(["b"]);
    expect(r.blocked[0].unmet).toEqual([{ id: "a", status: "ready" }]);
    expect(r.summary.total).toBe(2);
    expect(r.summary.ready).toBe(1);
  });

  it("a passed 后 b 不再是 blocked 候选（可转 ready）", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateExecutionReport(tmpDir, "a", { summary: "done" });
    updateNodeStatus(tmpDir, "a", NodeStatus.Passed);
    const r = computeNextActions(tmpDir);
    expect(r.blocked).toEqual([]);
    expect(r.ready_eligible.map((n) => n.id)).toEqual(["b"]);
  });

  it("冷启动：入口节点（无门控前驱）出现在 ready_eligible", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    const r = computeNextActions(tmpDir);
    // a 无门控前驱 → 可转 ready；b 等依赖
    expect(r.ready_eligible.map((n) => n.id)).toEqual(["a"]);
    expect(r.blocked.map((n) => n.id)).toEqual(["b"]);
  });

  it("failed 且门禁已满足 → ready_eligible（可重试入口）", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    const r = computeNextActions(tmpDir);
    expect(r.ready_eligible.map((n) => n.id)).toEqual(["a"]);
    expect(r.blocked).toEqual([]);
  });

  it("running 节点带执行者与时长；陈旧阈值触发 stale_running", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running, "agent-1");
    const r = computeNextActions(tmpDir, { staleMs: 0 });
    expect(r.running.map((n) => n.id)).toEqual(["a"]);
    expect(r.running[0].assigned_to).toBe("agent-1");
    expect(r.running[0].elapsed_ms).not.toBeNull();
    expect(r.stale_running.map((n) => n.id)).toEqual(["a"]); // staleMs=0 → 必然陈旧
  });

  it("failed 且门控前驱未齐 → blocked 候选", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateNodeStatus(tmpDir, "a", NodeStatus.Failed);
    const r = computeNextActions(tmpDir);
    expect(r.blocked.map((n) => n.id)).toEqual(["b"]);
  });

  it("fan_out/fan_in 语义：fan_in 汇聚点等全部上游", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createNode(tmpDir, { id: "c", type: NodeType.Task, label: "C" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "c", type: EdgeType.FanIn });
    createEdge(tmpDir, { id: "e2", source: "b", target: "c", type: EdgeType.FanIn });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running);
    updateExecutionReport(tmpDir, "a", { summary: "done" });
    updateNodeStatus(tmpDir, "a", NodeStatus.Passed);
    const r = computeNextActions(tmpDir);
    const c = r.blocked.find((n) => n.id === "c");
    expect(c).toBeDefined();
    expect(c!.unmet.map((u) => u.id)).toEqual(["b"]);
  });
  it("FIX-F1 priority 排序：ready/ready_eligible 按 priority 升序 → level → id", () => {
    // 无优先级（缺省最低）+ p2 优先 + p1 最优先 + 同 priority 时 level 决胜
    createNode(tmpDir, { id: "plain", type: NodeType.Task, label: "P" });
    createNode(tmpDir, { id: "p2", type: NodeType.Task, label: "P2", priority: 2 });
    createNode(tmpDir, { id: "p1", type: NodeType.Task, label: "P1", priority: 1 });
    createNode(tmpDir, { id: "lv0", type: NodeType.Task, label: "L0", priority: 2, level: 0 });

    const r = computeNextActions(tmpDir);
    // ready_eligible：p1(1) → lv0(2,level0) → p2(2,level1) → plain(缺省)
    expect(r.ready_eligible.map((n) => n.id)).toEqual(["p1", "lv0", "p2", "plain"]);
    // 条目携带 priority 供 agent 决策
    expect(r.ready_eligible[0].priority).toBe(1);

    // ready 桶同样排序：全部转 ready
    for (const id of ["plain", "p2", "p1", "lv0"]) {
      updateNodeStatus(tmpDir, id, NodeStatus.Ready);
    }
    const r2 = computeNextActions(tmpDir);
    expect(r2.ready.map((n) => n.id)).toEqual(["p1", "lv0", "p2", "plain"]);
    expect(r2.ready_eligible).toEqual([]);
  });

  it("FIX-F1 priority 可通过 update 通道修改（set_priority）", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    // b 提到最优先
    updateNodeContent(tmpDir, "b", { priority: 0 });
    const r = computeNextActions(tmpDir);
    expect(r.ready_eligible.map((n) => n.id)).toEqual(["b", "a"]);
    expect(getNode(tmpDir, "b").priority).toBe(0);
  });
  it("FIX-F2 stale 判据按最后活动时间：上报心跳（updated_at 刷新）后时钟到点不误报", () => {
    createNode(tmpDir, { id: "long", type: NodeType.Task, label: "Long" });
    updateNodeStatus(tmpDir, "long", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "long", NodeStatus.Running, "agent-1");
    // 认领后真实上报一次 execution_report——updated_at 随之自然刷新（"上报即心跳"）。
    // arch-c2：不再手写 YAML 时间戳，时钟读数走注入。
    updateExecutionReport(tmpDir, "long", { summary: "progress" });

    const node = getNode(tmpDir, "long");
    const updatedMs = Date.parse(node.updated_at!);
    expect(Date.parse(node.execution_report!.started_at!)).toBeLessThanOrEqual(updatedMs);

    // 时钟读数一：updated_at + 30min 整——elapsed 恰好等于阈值（不大于），
    // 心跳判据 max(updated_at, started_at) 下不算卡住
    const r = computeNextActions(tmpDir, {
      staleMs: 30 * 60 * 1000,
      clock: () => updatedMs + 30 * 60 * 1000,
    });
    expect(r.running).toHaveLength(1);
    expect(r.running[0].elapsed_ms).toBe(30 * 60 * 1000);
    expect(r.stale_running.map((n) => n.id)).toEqual([]); // 心跳新鲜，不误报

    // 时钟读数二：同一份 YAML（零写入），时钟再走 1 分钟 → 超过阈值 → 疑似卡住
    const r2 = computeNextActions(tmpDir, {
      staleMs: 30 * 60 * 1000,
      clock: () => updatedMs + 30 * 60 * 1000 + 60_000,
    });
    expect(r2.stale_running.map((n) => n.id)).toEqual(["long"]);
    expect(r2.stale_running[0].elapsed_ms).toBe(30 * 60 * 1000 + 60_000);
  });
});

// arch-c2：调度入口可注入时钟——同一 YAML 配两个时钟读数即可覆盖 stale 两态，
// 不再改写节点文件时间戳（旧行为：手写 updated_at/started_at + resetIndexCache）。
describe("computeNextActions 注入时钟", () => {
  it("同一 YAML，两个时钟读数 → stale 判定不同", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running, "agent-1");
    const startedMs = Date.parse(getNode(tmpDir, "a").execution_report!.started_at!);

    // 基线：两次注入时钟调度之间不允许发生任何文件写入
    const nodeFile = path.join(tmpDir, ".graph", "nodes", "a.yaml");
    const yamlBefore = fs.readFileSync(nodeFile, "utf-8");

    // 读数一：认领后 1 分钟 → 新鲜
    const r1 = computeNextActions(tmpDir, {
      staleMs: 30 * 60 * 1000,
      clock: () => startedMs + 60_000,
    });
    expect(r1.stale_running).toEqual([]);
    expect(r1.running[0].elapsed_ms).toBe(60_000);

    // 读数二：认领后 31 分钟（YAML 未动）→ 疑似卡住
    const r2 = computeNextActions(tmpDir, {
      staleMs: 30 * 60 * 1000,
      clock: () => startedMs + 31 * 60_000,
    });
    expect(r2.stale_running.map((n) => n.id)).toEqual(["a"]);
    expect(r2.stale_running[0].elapsed_ms).toBe(31 * 60_000);

    // 期间节点 YAML 未被改写（时钟注入替代时间戳伪造的证据）
    expect(fs.readFileSync(nodeFile, "utf-8")).toBe(yamlBefore);
  });

  it("缺省时钟 = 系统时间（现读现算，行为与注入前一致）", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "a", NodeStatus.Running, "agent-1");
    const startedMs = Date.parse(getNode(tmpDir, "a").execution_report!.started_at!);
    const t0 = Date.now();
    const r = computeNextActions(tmpDir);
    const t1 = Date.now();
    expect(r.stale_running).toEqual([]);
    const elapsed = r.running[0].elapsed_ms as number;
    expect(elapsed).toBeGreaterThanOrEqual(0);
    // elapsed 的起点是节点 started_at，而不是 claim 完成后才取得的 t0；
    // 因此把 claim→t0 的文件 I/O/worker 抢占纳入上下界，避免把正常延迟误判为时钟错误。
    // 断言本意仍是"现读现算"：错误实现产生分钟级漂移时，仍会超出这个实际时间窗口。
    expect(elapsed).toBeGreaterThanOrEqual(t0 - startedMs);
    expect(elapsed).toBeLessThanOrEqual(t1 - startedMs + 50);
  });

  it("注入时钟只影响 stale 判定：ready/blocked/summary 各桶与时钟无关", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    updateNodeStatus(tmpDir, "a", NodeStatus.Ready);
    const farFuture = () => Date.now() + 365 * 24 * 3600 * 1000;
    const r = computeNextActions(tmpDir, { clock: farFuture });
    expect(r.ready.map((n) => n.id)).toEqual(["a"]);
    expect(r.blocked.map((n) => n.id)).toEqual(["b"]);
    expect(r.summary.total).toBe(2);
  });
});

// F09（adr_0017）：fallback 边最小读语义——死节点（failed 且重试预算耗尽）在
// ready_eligible/blocked 桶条目附 attempts_exhausted 与 fallback_routes（沿出向
// fallback 边收集替代路线）。纯读面标注：零新增拒绝规则，桶归置不变。
describe("computeNextActions F09 死节点标注（adr_0017）", () => {
  // 一次完整失败循环：ready → running → failed
  function failOnce(id: string): void {
    updateNodeStatus(tmpDir, id, NodeStatus.Ready);
    updateNodeStatus(tmpDir, id, NodeStatus.Running);
    updateNodeStatus(tmpDir, id, NodeStatus.Failed);
  }
  // 消耗一次重试预算：failed → pending（重试，attempts+1）→ ready → running → failed
  function burnAttempt(id: string): void {
    updateNodeStatus(tmpDir, id, NodeStatus.Pending);
    failOnce(id);
  }

  it("死节点 + 出向 fallback 边 → ready_eligible 条目带 attempts_exhausted 与 fallback_routes", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A", max_attempts: 1 });
    createNode(tmpDir, { id: "r", type: NodeType.Task, label: "救生艇" });
    createEdge(tmpDir, { id: "f1", source: "a", target: "r", type: EdgeType.Fallback });
    failOnce("a"); // attempts=0（未耗尽）
    burnAttempt("a"); // attempts=1 ≥ max_attempts=1 → 死节点
    const r = computeNextActions(tmpDir);
    const entry = r.ready_eligible.find((n) => n.id === "a");
    expect(entry).toBeDefined();
    expect(entry!.attempts_exhausted).toBe(true);
    expect(entry!.fallback_routes).toEqual([{ id: "r", label: "救生艇" }]);
  });

  it("死节点无 fallback 边 → 只有 attempts_exhausted，无 fallback_routes 键", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A", max_attempts: 1 });
    failOnce("a");
    burnAttempt("a");
    const entry = computeNextActions(tmpDir).ready_eligible.find((n) => n.id === "a")!;
    expect(entry.attempts_exhausted).toBe(true);
    expect("fallback_routes" in entry).toBe(false);
  });

  it("failed 但 attempts 未耗尽 → 两字段都不出现", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" }); // 缺省 max_attempts=3
    createNode(tmpDir, { id: "r", type: NodeType.Task, label: "R" });
    createEdge(tmpDir, { id: "f1", source: "a", target: "r", type: EdgeType.Fallback });
    failOnce("a"); // attempts=0 < 3
    const entry = computeNextActions(tmpDir).ready_eligible.find((n) => n.id === "a")!;
    expect(entry).toBeDefined();
    expect("attempts_exhausted" in entry).toBe(false);
    expect("fallback_routes" in entry).toBe(false);
  });

  it("死节点 + 门禁未满足 → blocked 条目带两字段", () => {
    createNode(tmpDir, { id: "g", type: NodeType.Task, label: "G" }); // 未 passed 的门控前驱
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A", max_attempts: 1 });
    createNode(tmpDir, { id: "r", type: NodeType.Task, label: "R" });
    createEdge(tmpDir, { id: "f1", source: "a", target: "r", type: EdgeType.Fallback });
    // 先把 a 打成死节点（此时无门禁边，可正常流转），再补挂门禁边模拟
    // 「死节点重试入口被门禁挡住」——有未满足前驱的节点无法正常进入 ready
    failOnce("a");
    burnAttempt("a");
    createEdge(tmpDir, { id: "e1", source: "g", target: "a", type: EdgeType.DependsOn });
    const entry = computeNextActions(tmpDir).blocked.find((n) => n.id === "a")!;
    expect(entry.unmet).toEqual([{ id: "g", status: "pending" }]);
    expect(entry.attempts_exhausted).toBe(true);
    expect(entry.fallback_routes).toEqual([{ id: "r", label: "R" }]);
  });

  it("max_attempts=0（不限重试）→ 永不标注", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A", max_attempts: 0 });
    createNode(tmpDir, { id: "r", type: NodeType.Task, label: "R" });
    createEdge(tmpDir, { id: "f1", source: "a", target: "r", type: EdgeType.Fallback });
    failOnce("a");
    burnAttempt("a"); // attempts=1
    burnAttempt("a"); // attempts=2（预算不限，永不判死）
    const entry = computeNextActions(tmpDir).ready_eligible.find((n) => n.id === "a")!;
    expect("attempts_exhausted" in entry).toBe(false);
    expect("fallback_routes" in entry).toBe(false);
  });

  it("fallback 边目标节点不存在 → 跳过该条（幽灵端点归 validate 报错）", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A", max_attempts: 1 });
    createNode(tmpDir, { id: "r", type: NodeType.Task, label: "R" });
    createEdge(tmpDir, { id: "f1", source: "a", target: "r", type: EdgeType.Fallback });
    // 手写幽灵边（createEdge 拦截幽灵端点；调度面读到目标缺失的边时跳过该条）
    fs.writeFileSync(
      path.join(tmpDir, ".graph", "edges", "f-ghost.yaml"),
      "id: f-ghost\nsource: a\ntarget: ghost\ntype: fallback\n",
      "utf-8",
    );
    invalidateIndex(tmpDir);
    failOnce("a");
    burnAttempt("a");
    const entry = computeNextActions(tmpDir).ready_eligible.find((n) => n.id === "a")!;
    expect(entry.fallback_routes).toEqual([{ id: "r", label: "R" }]); // ghost 被跳过
  });
});
