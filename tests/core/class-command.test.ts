// tests/core/class-command.test.ts — v091-class-command（adr_0016）：档位凭据三件套 core 面
// 1) class_changed 事件两态：首次设置（from 缺省）/ 实际变更（from/to/by 断言）落事件，
//    同值重设不落事件（events 计数不变）；
// 2) 雾/档矛盾 nudge（core/fog.ts fogClassNudge 单源派生）：纯函数条件矩阵 +
//    validateGraphDir 警告编排与 computeNextActions 装配的双态注入（用户直发凭据
//    --by user 后 validate/next 均静默）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { updateGraph, readGraph, writeGraph } from "../../src/core/parser.js";
import { fogClassNudge, fogWarnings } from "../../src/core/fog.js";
import { createNode } from "../../src/core/node.js";
import { computeNextActions } from "../../src/core/scheduler.js";
import { readEvents } from "../../src/core/eventlog.js";
import { validateGraphDir } from "../../src/core/validate.js";
import { NodeType } from "../../src/core/types.js";

let tmpDir: string;

function skeletonGraph() {
  return {
    id: "g1",
    version: "0.9.0",
    label: "class-command-test",
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

const FOG = {
  id: "release-automation",
  description: "发布链哪些步能机械化",
  graduation: "人工判定点清单成文",
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-class-cmd-"));
  writeGraph(tmpDir, skeletonGraph());
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("v091 class_changed 事件两态（凭据血统，adr_0016）", () => {
  it("首次设置（无 class → quick）落事件：from 缺省表示首次，by 缺省 agent", () => {
    updateGraph(tmpDir, { class: "quick" });
    const events = readEvents(tmpDir, { kind: "class_changed" });
    expect(events).toHaveLength(1);
    expect(events[0].from).toBeUndefined();
    expect(events[0].to).toBe("quick");
    expect(events[0].by).toBe("agent");
    expect(events[0].actor).toBe("agent");
    expect(readGraph(tmpDir).class).toBe("quick");
  });

  it("quick → standard（--by user）落事件：from=quick / to=standard / by=user", () => {
    updateGraph(tmpDir, { class: "quick" });
    updateGraph(tmpDir, { class: "standard", by: "user" });
    const events = readEvents(tmpDir, { kind: "class_changed" });
    expect(events).toHaveLength(2);
    expect(events[1].from).toBe("quick");
    expect(events[1].to).toBe("standard");
    expect(events[1].by).toBe("user");
    expect(events[1].actor).toBe("user");
    expect(events[1].detail).toContain("quick → standard");
    expect(events[1].detail).toContain("by=user");
  });

  it("同值重设不落事件：class_changed 计数与事件总数均不变", () => {
    updateGraph(tmpDir, { class: "quick", by: "user" });
    const before = readEvents(tmpDir, { kind: "class_changed" }).length;
    const totalBefore = readEvents(tmpDir).length;
    updateGraph(tmpDir, { class: "quick", by: "user" });
    updateGraph(tmpDir, { class: "quick" });
    expect(readEvents(tmpDir, { kind: "class_changed" })).toHaveLength(before);
    expect(readEvents(tmpDir)).toHaveLength(totalBefore);
    expect(readGraph(tmpDir).class).toBe("quick");
  });

  it("不带 --class 的更新（改 label）不落 class_changed 事件", () => {
    updateGraph(tmpDir, { label: "改名" });
    expect(readEvents(tmpDir, { kind: "class_changed" })).toHaveLength(0);
  });
});

describe("v091 雾/档矛盾 nudge（fogClassNudge 单源派生，零门禁）", () => {
  it("条件矩阵：雾+非 program 档+无凭据 → 文案；雾中绘图对应 program 档三信息齐备", () => {
    const nudge = fogClassNudge(
      { fog: FOG, class: "quick" },
      [],
    );
    expect(nudge).toBeDefined();
    expect(nudge).toContain("release-automation"); // 雾未毕业
    expect(nudge).toContain("quick"); // 当前档位
    expect(nudge).toContain("program"); // 建议方向（雾中绘图对应 program 档）
    expect(nudge).toContain("update-graph --class program"); // 修法命令
  });

  it("用户直发凭据（最近一次 by=user）→ 静默；program 档/无雾/无档 → 静默", () => {
    expect(fogClassNudge({ fog: FOG, class: "quick" }, [{ by: "user" }])).toBeUndefined();
    expect(fogClassNudge({ fog: FOG, class: "standard" }, [{ by: "agent" }, { by: "user" }])).toBeUndefined();
    // 最近一次是 agent 自判 → 仍提示（只有 user 凭据能静默）
    expect(fogClassNudge({ fog: FOG, class: "quick" }, [{ by: "user" }, { by: "agent" }])).toBeDefined();
    expect(fogClassNudge({ fog: FOG, class: "program" }, [])).toBeUndefined();
    expect(fogClassNudge({ fog: undefined, class: "quick" }, [])).toBeUndefined();
    expect(fogClassNudge({ fog: FOG, class: undefined }, [])).toBeUndefined();
  });

  it("注入两态（validateGraphDir 警告编排）：--by user 凭据后 nudge 静默、雾区提示仍在", () => {
    createNode(tmpDir, { id: "r1", type: NodeType.Task, label: "研究票" });
    updateGraph(tmpDir, { fog: FOG });
    updateGraph(tmpDir, { class: "quick" }); // 缺省 by=agent
    const v1 = validateGraphDir(tmpDir);
    expect(v1.ok).toBe(true); // 零门禁：恒为 warning，不参与 ok
    expect(v1.warnings.some((w) => w.includes("release-automation") && w.includes("quick"))).toBe(true);
    // 用户直发凭据 → nudge 消失，雾区提示（fogWarnings）不受影响
    updateGraph(tmpDir, { class: "standard", by: "user" });
    const v2 = validateGraphDir(tmpDir);
    expect(v2.warnings.some((w) => w.includes("update-graph --class program"))).toBe(false);
    expect(v2.warnings.some((w) => w.includes("未毕业雾区 release-automation"))).toBe(true);
  });

  it("注入两态（computeNextActions 装配）：class_nudge 随凭据出现与消失", () => {
    createNode(tmpDir, { id: "r1", type: NodeType.Task, label: "研究票" });
    updateGraph(tmpDir, { fog: FOG });
    expect(computeNextActions(tmpDir).class_nudge).toBeUndefined(); // 无档不提示
    updateGraph(tmpDir, { class: "quick" });
    const n1 = computeNextActions(tmpDir).class_nudge;
    expect(n1).toBeDefined();
    expect(n1).toContain("release-automation");
    updateGraph(tmpDir, { class: "standard", by: "user" });
    expect(computeNextActions(tmpDir).class_nudge).toBeUndefined();
  });

  it("与 fogWarnings 提示互不替代：雾+agent 自判档时两条提示并存", () => {
    updateGraph(tmpDir, { fog: FOG, class: "standard" });
    const warnings = [
      ...fogWarnings({ fog: FOG }, [{ type: NodeType.Task } as any]),
      fogClassNudge({ fog: FOG, class: "standard" }, []),
    ];
    expect(warnings.filter((w) => w !== undefined)).toHaveLength(2);
  });
});
