// tests/core/next-actions.test.ts — 调度决策工具
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { computeNextActions } from "../../src/core/scheduler.js";
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
    const t0 = Date.now();
    const r = computeNextActions(tmpDir);
    const t1 = Date.now();
    expect(r.stale_running).toEqual([]);
    const elapsed = r.running[0].elapsed_ms as number;
    expect(elapsed).toBeGreaterThanOrEqual(0);
    // 容差 50ms：v091-tooling 起套件并行文件数增加，5ms 容差在高负载
    // （perf 5k 同跑）下会被 worker 抢占式调度击穿（claim→t0 间隙 >5ms）。
    // 断言本意是"现读现算"——错误实现会产生分钟级漂移，50ms 仍能守住。
    expect(elapsed).toBeLessThanOrEqual(t1 - t0 + 50);
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
