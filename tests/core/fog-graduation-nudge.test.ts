// tests/core/fog-graduation-nudge.test.ts — IL-025：雾可毕业 nudge（零门禁）
// 纯函数派生（core/fog.ts，与 fogClassNudge 同址单源）：图有未毕业雾区且
// fog.ignited 列票全部 passed → 提示毕业留痕（含 fog id 与 graduate-fog 命令建议）；
// 两态装配断言（computeNextActions 桶装配 + validateGraphDir 警告编排）+
// 毕业后不再注入（graduateFog 清除 fog 字段，nudge 自然静默）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fogGraduationNudge } from "../../src/core/fog.js";
import { computeNextActions } from "../../src/core/scheduler.js";
import { validateGraphDir } from "../../src/core/validate.js";
import { graduateFog, updateGraph, writeGraph } from "../../src/core/parser.js";
import { createNode, updateNodeStatus, updateExecutionReport } from "../../src/core/node.js";
import { NodeType, NodeStatus } from "../../src/core/types.js";

let tmpDir: string;

const FOG = {
  id: "release-automation",
  description: "发布链哪些步能机械化",
  graduation: "人工判定点清单成文",
};

function skeletonGraph() {
  return {
    id: "g1",
    version: "0.9.0",
    label: "fog-grad-test",
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-fog-grad-"));
  writeGraph(tmpDir, skeletonGraph());
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("fogGraduationNudge 纯函数（单源派生）", () => {
  const statusOf = new Map<string, string>([
    ["r1", NodeStatus.Passed],
    ["r2", NodeStatus.Passed],
  ]);

  it("ignited 全部 passed → 提示含 fog id 与 graduate-fog 命令建议", () => {
    const nudge = fogGraduationNudge({ ...FOG, ignited: ["r1", "r2"] }, statusOf);
    expect(nudge).toBeDefined();
    expect(nudge).toContain("release-automation");
    expect(nudge).toContain("graduate-fog");
    expect(nudge).toContain(FOG.graduation);
  });

  it("任一票未 passed / 缺失、ignited 缺省或空 → 不提示（宁缺勿滥）", () => {
    // 一票 pending
    expect(
      fogGraduationNudge(
        { ...FOG, ignited: ["r1", "r2"] },
        new Map([...statusOf, ["r2", NodeStatus.Pending]]),
      ),
    ).toBeUndefined();
    // 点火票在状态视图缺失（幽灵 id）
    expect(fogGraduationNudge({ ...FOG, ignited: ["r1", "ghost"] }, statusOf)).toBeUndefined();
    // ignited 缺省 / 空
    expect(fogGraduationNudge({ ...FOG }, statusOf)).toBeUndefined();
    expect(fogGraduationNudge({ ...FOG, ignited: [] }, statusOf)).toBeUndefined();
  });
});

describe("IL-025 装配两态（computeNextActions + validateGraphDir）", () => {
  it("next 桶装配：ignited 全 passed 注入 fog_graduation_nudge；有票未 passed 不注入", () => {
    createNode(tmpDir, { id: "r1", type: NodeType.Task, label: "研究票一" });
    createNode(tmpDir, { id: "r2", type: NodeType.Task, label: "研究票二" });
    updateGraph(tmpDir, { fog: { ...FOG, ignited: ["r1", "r2"] } });

    // 两票均未 passed → 不提示
    expect(computeNextActions(tmpDir).fog_graduation_nudge).toBeUndefined();

    // 一票 passed、一票 pending → 仍不提示
    updateNodeStatus(tmpDir, "r1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "r1", NodeStatus.Running);
    updateExecutionReport(tmpDir, "r1", { summary: "研究完成" });
    updateNodeStatus(tmpDir, "r1", NodeStatus.Passed);
    expect(computeNextActions(tmpDir).fog_graduation_nudge).toBeUndefined();

    // 全部 passed → 注入（零门禁，随调度结果透出）
    updateNodeStatus(tmpDir, "r2", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "r2", NodeStatus.Running);
    updateExecutionReport(tmpDir, "r2", { summary: "研究完成" });
    updateNodeStatus(tmpDir, "r2", NodeStatus.Passed);
    const nudge = computeNextActions(tmpDir).fog_graduation_nudge;
    expect(nudge).toBeDefined();
    expect(nudge).toContain("release-automation");
    expect(nudge).toContain("graduate-fog");
  });

  it("validate 警告编排：ignited 全 passed → 警告含毕业建议；ok 不受影响（零门禁）", () => {
    createNode(tmpDir, { id: "r1", type: NodeType.Task, label: "研究票" });
    updateGraph(tmpDir, { fog: { ...FOG, ignited: ["r1"] } });
    updateNodeStatus(tmpDir, "r1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "r1", NodeStatus.Running);
    updateExecutionReport(tmpDir, "r1", { summary: "研究完成" });
    updateNodeStatus(tmpDir, "r1", NodeStatus.Passed);

    const r = validateGraphDir(tmpDir);
    expect(r.ok).toBe(true); // 恒为 warning，不参与退出码
    expect(r.warnings.some((w) => w.includes("雾可毕业") && w.includes("graduate-fog"))).toBe(true);

    // 票未 passed → 警告静默
    const g = JSON.parse(JSON.stringify(skeletonGraph()));
    writeGraph(tmpDir, g);
    createNode(tmpDir, { id: "r2", type: NodeType.Task, label: "研究票二" });
    updateGraph(tmpDir, { fog: { ...FOG, ignited: ["r2"] } });
    expect(validateGraphDir(tmpDir).warnings.some((w) => w.includes("雾可毕业"))).toBe(false);
  });

  it("毕业后不再注入（graduateFog 清除 fog 字段，nudge 条件自然不命中）", () => {
    createNode(tmpDir, { id: "r1", type: NodeType.Task, label: "研究票" });
    updateGraph(tmpDir, { fog: { ...FOG, ignited: ["r1"] } });
    updateNodeStatus(tmpDir, "r1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "r1", NodeStatus.Running);
    updateExecutionReport(tmpDir, "r1", { summary: "研究完成" });
    updateNodeStatus(tmpDir, "r1", NodeStatus.Passed);
    expect(computeNextActions(tmpDir).fog_graduation_nudge).toBeDefined();

    graduateFog(tmpDir, { produced: ["r1"], reason: "清单成文" }, { actor: "cli" });
    const r = computeNextActions(tmpDir);
    expect(r.fog).toBeUndefined();
    expect(r.fog_graduation_nudge).toBeUndefined();
    expect(validateGraphDir(tmpDir).warnings.some((w) => w.includes("雾可毕业"))).toBe(false);
  });
});
