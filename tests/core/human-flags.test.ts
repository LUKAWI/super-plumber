// tests/core/human-flags.test.ts — F06/F07（0.9.1 渐进审批）：人机分工接入调度机器面
// F06 requires_human 派生标注（core/domain.ts 单源纯函数）：判定口径两态 +
// 桶条目（ready/ready_eligible/running）标注 + claim 提示包槽位接线；
// F07 等真人标记（waiting_human，条件缺省）与 human 类 stale 阈值
// （默认基线 30 分钟 × 放大 8 = 4 小时；显式 staleMs 优先生效；倍数可配）。
// stale 两态用 arch-c2 可注入时钟测——同一份 YAML 配两个时钟读数，零时间戳改写。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  computeNextActions,
  buildClaimNudgePackage,
  BASE_STALE_MS,
  HUMAN_STALE_MULTIPLIER,
} from "../../src/core/scheduler.js";
import { requiresHuman } from "../../src/core/domain.js";
import { createNode, updateNodeStatus, updateCheckpoint, getNode } from "../../src/core/node.js";
import { NodeType, NodeStatus, type Checkpoint } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-human-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 一自动 + 一人工的双检查点（status 可变，覆盖 human 检查点各状态） */
function mixedCheckpoints(humanStatus: Checkpoint["status"] = "pending"): Checkpoint[] {
  return [
    { id: "cp-auto", label: "自动检查", status: "pending", verifier: "auto" },
    { id: "cp-human", label: "人工签核", status: humanStatus, verifier: "human" },
  ];
}

describe("F06 requiresHuman 派生（纯函数两态）", () => {
  it("存在 verifier=human 的未完成 checkpoint → true（pending/running/failed 均算未完成）", () => {
    expect(requiresHuman(mixedCheckpoints("pending"))).toBe(true);
    expect(requiresHuman(mixedCheckpoints("running"))).toBe(true);
    expect(requiresHuman(mixedCheckpoints("failed"))).toBe(true);
  });

  it("human checkpoint 全部 passed/skipped、无 human 检查点、无 checkpoints → false", () => {
    // passed / skipped：人工义务解除（skipped 是裁决性豁免）
    expect(requiresHuman(mixedCheckpoints("passed"))).toBe(false);
    expect(requiresHuman(mixedCheckpoints("skipped"))).toBe(false);
    // 只有 auto 检查点
    expect(
      requiresHuman([{ id: "c1", label: "x", status: "pending", verifier: "auto" }]),
    ).toBe(false);
    // 无 checkpoints
    expect(requiresHuman(undefined)).toBe(false);
    expect(requiresHuman([])).toBe(false);
  });
});

describe("F06/F07 调度桶条目：requires_human / waiting_human 标注（条件缺省）", () => {
  it("ready 桶：human 票带 requires_human + waiting_human（无人认领）；机器票两字段缺省", () => {
    createNode(tmpDir, { id: "h1", type: NodeType.Task, label: "人工票", checkpoints: mixedCheckpoints() });
    createNode(tmpDir, { id: "m1", type: NodeType.Task, label: "机器票" });
    updateNodeStatus(tmpDir, "h1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "m1", NodeStatus.Ready);

    const r = computeNextActions(tmpDir);
    const h = r.ready.find((n) => n.id === "h1")!;
    expect(h.requires_human).toBe(true);
    expect(h.waiting_human).toBe(true);
    const m = r.ready.find((n) => n.id === "m1")!;
    expect(m.requires_human).toBeUndefined();
    expect(m.waiting_human).toBeUndefined();
  });

  it("ready_eligible 桶同款标注；human checkpoint 全 passed 后标注消失（派生两态）", () => {
    createNode(tmpDir, { id: "h2", type: NodeType.Task, label: "人工票", checkpoints: mixedCheckpoints() });
    const r = computeNextActions(tmpDir); // 冷启动 pending → ready_eligible
    expect(r.ready_eligible.map((n) => n.id)).toEqual(["h2"]);
    expect(r.ready_eligible[0].requires_human).toBe(true);
    expect(r.ready_eligible[0].waiting_human).toBe(true);

    // 人工检查点签核通过 → 派生标注消失（读面回归普通票，零 schema 字段残留）
    updateCheckpoint(tmpDir, "h2", "cp-human", "passed");
    const r2 = computeNextActions(tmpDir);
    expect(r2.ready_eligible[0].requires_human).toBeUndefined();
    expect(r2.ready_eligible[0].waiting_human).toBeUndefined();
  });

  it("running 桶：human 票带 requires_human（已认领，不再打 waiting_human）", () => {
    createNode(tmpDir, { id: "h3", type: NodeType.Task, label: "人工票", checkpoints: mixedCheckpoints() });
    updateNodeStatus(tmpDir, "h3", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "h3", NodeStatus.Running, "agent-1");

    const r = computeNextActions(tmpDir);
    expect(r.running).toHaveLength(1);
    expect(r.running[0].requires_human).toBe(true);
    expect((r.running[0] as { waiting_human?: boolean }).waiting_human).toBeUndefined();
  });
});

describe("F06 buildClaimNudgePackage requires_human 槽位接线（arch-c3a 埋点）", () => {
  it("含未完成 human checkpoint → requires_human: true；机器票缺省", () => {
    createNode(tmpDir, { id: "h1", type: NodeType.Task, label: "人工票", checkpoints: mixedCheckpoints() });
    createNode(tmpDir, { id: "m1", type: NodeType.Task, label: "机器票" });
    expect(buildClaimNudgePackage(tmpDir, "h1").requires_human).toBe(true);
    expect(buildClaimNudgePackage(tmpDir, "m1").requires_human).toBeUndefined();
  });

  it("human checkpoint passed 后槽位静默（认领提示不再提示人工介入）", () => {
    createNode(tmpDir, { id: "h1", type: NodeType.Task, label: "人工票", checkpoints: mixedCheckpoints() });
    updateCheckpoint(tmpDir, "h1", "cp-human", "passed");
    expect(buildClaimNudgePackage(tmpDir, "h1").requires_human).toBeUndefined();
  });
});

describe("F07 human stale 阈值（注入时钟，YAML 时间戳零改写）", () => {
  interface Claimed {
    startedMs: number;
    nodeFile: string;
    yamlBefore: string;
  }
  /** 建票 → ready → running（认领），返回注入时钟基准（started_at）与 YAML 快照 */
  function claimRunning(id: string, checkpoints?: Checkpoint[]): Claimed {
    createNode(tmpDir, { id, type: NodeType.Task, label: id, checkpoints });
    updateNodeStatus(tmpDir, id, NodeStatus.Ready);
    updateNodeStatus(tmpDir, id, NodeStatus.Running, "agent-1");
    const startedMs = Date.parse(getNode(tmpDir, id).execution_report!.started_at!);
    const nodeFile = path.join(tmpDir, ".graph", "nodes", `${id}.yaml`);
    return { startedMs, nodeFile, yamlBefore: fs.readFileSync(nodeFile, "utf-8") };
  }

  it("常量单源：基线 30 分钟 × 默认放大 8 = 4 小时（真人节奏定稿）", () => {
    expect(BASE_STALE_MS).toBe(30 * 60 * 1000);
    expect(HUMAN_STALE_MULTIPLIER).toBe(8);
    expect(BASE_STALE_MS * HUMAN_STALE_MULTIPLIER).toBe(4 * 60 * 60 * 1000);
  });

  it("默认放宽生效：31 分钟处机器票疑似卡住、human 票不误报；4 小时 +1 分处 human 票也卡住", () => {
    const h = claimRunning("h", mixedCheckpoints());
    const m = claimRunning("m");

    // 读数一：31 分钟——机器票 > 30 分钟基线 → stale；human 票 < 4 小时 → 不 stale
    const r1 = computeNextActions(tmpDir, { clock: () => h.startedMs + 31 * 60_000 });
    expect(r1.stale_running.map((n) => n.id)).toEqual(["m"]);
    expect(r1.running.find((n) => n.id === "h")!.requires_human).toBe(true);

    // 读数二：4 小时 + 1 分钟（同一份 YAML，零写入）——human 票也疑似卡住
    const r2 = computeNextActions(tmpDir, {
      clock: () => h.startedMs + BASE_STALE_MS * HUMAN_STALE_MULTIPLIER + 60_000,
    });
    expect(r2.stale_running.map((n) => n.id).sort()).toEqual(["h", "m"]);

    // 期间节点 YAML 未被改写（时钟注入替代时间戳伪造的证据）
    expect(fs.readFileSync(h.nodeFile, "utf-8")).toBe(h.yamlBefore);
  });

  it("显式 staleMs 优先生效：human 票不再放大，31 分钟同样疑似卡住", () => {
    claimRunning("h", mixedCheckpoints());
    const r = computeNextActions(tmpDir, {
      staleMs: 30 * 60 * 1000, // 显式传值（--stale-ms / stale_ms 语义）
      clock: () => Date.parse(getNode(tmpDir, "h").execution_report!.started_at!) + 31 * 60_000,
    });
    expect(r.stale_running.map((n) => n.id)).toEqual(["h"]);
  });

  it("放大倍数可配：humanStaleMultiplier=2 → human 票 31 分钟不报、61 分钟报", () => {
    const h = claimRunning("h", mixedCheckpoints());
    const at = (min: number) =>
      computeNextActions(tmpDir, { humanStaleMultiplier: 2, clock: () => h.startedMs + min * 60_000 });
    expect(at(31).stale_running.map((n) => n.id)).toEqual([]); // 31min < 30min×2
    expect(at(61).stale_running.map((n) => n.id)).toEqual(["h"]); // 61min > 60min
  });
});
