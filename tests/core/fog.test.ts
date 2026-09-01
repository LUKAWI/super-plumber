// tests/core/fog.test.ts — F04/F05/F17（adr_0007，0.9.0）：雾区进 schema
// 图级 fog 字段读写（updateGraph）、fog_graduated 毕业事件与 DEC-7 amend 守卫
// （自动快照 + graph_amended + review 回置）、validate 雾区提示单源（fogWarnings）、
// 零迁移零默认拒绝（缺省 fog/class 的图全链路照常）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { approveGraph, graduateFog, readGraph, updateGraph, writeGraph } from "../../src/core/parser.js";
import { createNode } from "../../src/core/node.js";
import { computeNextActions } from "../../src/core/index-service.js";
import { readEvents } from "../../src/core/eventlog.js";
import { validateGraph } from "../../src/core/schema.js";
import { fogWarnings } from "../../src/core/fog.js";
import { AMEND_SNAPSHOT_PREFIX } from "../../src/core/amend.js";
import { createSnapshot, listSnapshots } from "../../src/core/snapshot.js";
import { NodeType } from "../../src/core/types.js";

let tmpDir: string;

function skeletonGraph() {
  return {
    id: "g1",
    version: "0.9.0",
    label: "fog-test",
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
  description: "发布链哪些步能机械化、哪些必须留人工判断",
  graduation: "人工判定点清单成文",
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-fog-"));
  writeGraph(tmpDir, skeletonGraph());
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("F04 fog/class 字段读写（updateGraph + schema）", () => {
  it("零迁移：缺省 fog/class 的图读入零 issue，字段缺省不存在", () => {
    const issues = validateGraph(JSON.parse(JSON.stringify(skeletonGraph())));
    expect(issues).toEqual([]);
    expect(readGraph(tmpDir).fog).toBeUndefined();
    expect(readGraph(tmpDir).class).toBeUndefined();
  });

  it("updateGraph 登记/更新雾区（整体 upsert）+ class 标注，重读一致", () => {
    updateGraph(tmpDir, { fog: { ...FOG, ignited: ["r1"] }, class: "program" });
    const g = readGraph(tmpDir);
    expect(g.fog).toEqual({ ...FOG, ignited: ["r1"] });
    expect(g.class).toBe("program");
    // 覆盖更新
    updateGraph(tmpDir, { fog: { ...FOG, graduation: "判定点清单 v2" } });
    expect(readGraph(tmpDir).fog!.graduation).toBe("判定点清单 v2");
    // class 可改
    updateGraph(tmpDir, { class: "quick" });
    expect(readGraph(tmpDir).class).toBe("quick");
  });

  it("形状拒绝：fog 缺 graduation / class 非法值在读入层拦截（手编防线）", () => {
    const badFog = { ...skeletonGraph(), fog: { id: "x", description: "d" } };
    // reqString 产出裸字段名（与 review 块同约定：issue 字段不带 fog. 前缀）
    expect(validateGraph(badFog).some((i) => i.field === "graduation")).toBe(true);
    const badClass = { ...skeletonGraph(), class: "huge" };
    expect(validateGraph(badClass).some((i) => i.field === "class")).toBe(true);
  });

  it("读面透出：computeNextActions 返回雾区概要（无雾缺省）", () => {
    expect(computeNextActions(tmpDir).fog).toBeUndefined();
    updateGraph(tmpDir, { fog: FOG });
    const fog = computeNextActions(tmpDir).fog!;
    expect(fog.id).toBe(FOG.id);
    expect(fog.graduation).toBe(FOG.graduation);
  });
});

describe("F05 graduateFog 毕业（专用凭据 + DEC-7 amend 守卫）", () => {
  it("无雾毕业报错（毕业是事实陈述，不是清理操作）", () => {
    expect(() => graduateFog(tmpDir, {})).toThrow(/没有雾区/);
  });

  it("毕业清除 fog 字段 + fog_graduated 事件留痕完整（fog/produced/reason）", () => {
    updateGraph(tmpDir, { fog: { ...FOG, ignited: ["r1"] } });
    const { fog, graph } = graduateFog(tmpDir, { produced: ["r1"], reason: "清单成文" }, { actor: "cli" });
    expect(fog.id).toBe(FOG.id);
    expect(graph.fog).toBeUndefined();
    expect(readGraph(tmpDir).fog).toBeUndefined();
    const events = readEvents(tmpDir, { kind: "fog_graduated" });
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe("cli");
    expect(events[0].detail).toContain("fog=release-automation");
    expect(events[0].detail).toContain("produced=r1");
    expect(events[0].detail).toContain('reason="清单成文"');
  });

  it("毕业复用 DEC-7 amend 守卫：自动快照 + graph_amended + 已审核图 review 回置", () => {
    updateGraph(tmpDir, { fog: FOG });
    createNode(tmpDir, { id: "r1", type: NodeType.Task, label: "研究票" });
    approveGraph(tmpDir, { by: "alice" });
    const before = listSnapshots(tmpDir).length;
    graduateFog(tmpDir, { reason: "想清楚了" }, { actor: "mcp" });
    // (a) 自动快照落下（listSnapshots 按 created_at 升序，末位即最新）
    expect(listSnapshots(tmpDir).length).toBe(before + 1);
    const newest = listSnapshots(tmpDir)[listSnapshots(tmpDir).length - 1]!;
    expect(newest.message).toContain(AMEND_SNAPSHOT_PREFIX);
    expect(newest.message).toContain("graduate-fog release-automation");
    // (b) graph_amended 事件 + review 回置 unreviewed（零门禁）
    const amended = readEvents(tmpDir, { kind: "graph_amended" });
    expect(amended.some((e) => e.detail.includes("action=graduate-fog target=release-automation"))).toBe(true);
    expect(readGraph(tmpDir).review!.status).toBe("unreviewed");
  });

  it("从未审核的图毕业：review 字段原样不动（回置只作用于已有凭据）", () => {
    updateGraph(tmpDir, { fog: FOG });
    graduateFog(tmpDir, {});
    expect(readGraph(tmpDir).review).toBeUndefined();
  });
});

describe("F17 validate 雾区提示（fogWarnings 单源，只提示不阻止）", () => {
  it("有雾 + 有工作流节点 → 恰一条提示；提示含毕业条件与出口指引", () => {
    updateGraph(tmpDir, { fog: FOG });
    const warnings = fogWarnings(readGraph(tmpDir), [{ type: NodeType.Task } as any]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("release-automation");
    expect(warnings[0]).toContain(FOG.graduation);
  });

  it("零工作流节点不重复提示（图中没有节点已在案）；无雾零提示", () => {
    updateGraph(tmpDir, { fog: FOG });
    expect(fogWarnings(readGraph(tmpDir), [])).toEqual([]);
    expect(fogWarnings(readGraph(tmpDir), [{ type: NodeType.Context } as any])).toEqual([]);
  });
});
