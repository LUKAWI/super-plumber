import { describe, it, expect } from "vitest";
import { phaseOfNode, phaseGroups, bandOf, PHASE_BANDS } from "./phase";
import type { NodeSchema, NodeType, NodeStatus } from "./types";

function node(id: string, extra: Partial<NodeSchema> = {}): NodeSchema {
  return {
    id,
    type: "task" as NodeType,
    label: id,
    level: 1,
    status: "pending" as NodeStatus,
    attempts: 0,
    max_attempts: 3,
    created_at: "",
    updated_at: "",
    ...extra,
  };
}

describe("phaseOfNode（id 前缀段位）", () => {
  it("fix-v080* / g080* / il-* → debug 修复带", () => {
    expect(phaseOfNode(node("fix-v080-a1"))).toBe("debug");
    expect(phaseOfNode(node("g080-release"))).toBe("debug");
    expect(phaseOfNode(node("il-011-edge-type-ergonomics"))).toBe("debug");
  });

  it("v081–v082 → 0.8.x；v09* → 0.9.x；v100 → 1.0.0", () => {
    expect(phaseOfNode(node("v081-webui"))).toBe("p08x");
    expect(phaseOfNode(node("v082-join"))).toBe("p08x");
    expect(phaseOfNode(node("v090-fogui"))).toBe("p09x");
    expect(phaseOfNode(node("v094-restructure"))).toBe("p09x");
    expect(phaseOfNode(node("v100-freeze"))).toBe("p100");
  });

  it("id 大小写不敏感", () => {
    expect(phaseOfNode(node("FIX-V080-B2"))).toBe("debug");
    expect(phaseOfNode(node("G080-release"))).toBe("debug");
  });

  it("v100 不被 v09 规则误吞；v1 前缀非 100 不入带", () => {
    expect(phaseOfNode(node("v099-x"))).toBe("p09x");
    expect(phaseOfNode(node("v101-x"))).toBe(null);
  });

  it("无段位线索的 id → null（不入带）", () => {
    expect(phaseOfNode(node("t1"))).toBe(null);
    expect(phaseOfNode(node("main-line"))).toBe(null);
  });

  it("知识顶点（context/adr）横切不入带——即使 id 相似", () => {
    expect(phaseOfNode(node("ctx-phase-08x", { type: "context" as NodeType }))).toBe(null);
    expect(phaseOfNode(node("adr_0001", { type: "adr" as NodeType }))).toBe(null);
  });
});

describe("phaseOfNode（标签段位兜底）", () => {
  it("「[0.8.1] 」前缀 → 0.8.x（派单点名的标签段位形态）", () => {
    expect(phaseOfNode(node("misc-1", { label: "[0.8.1] 某任务" }))).toBe("p08x");
  });

  it("「[fix·0.7.0] 」前缀 → debug 修复带", () => {
    expect(phaseOfNode(node("misc-2", { label: "[fix·0.7.0] A1 根治" }))).toBe("debug");
  });

  it("[0.7.x] → debug；[0.9.x] → 0.9.x；[1.0.0] → 1.0.0", () => {
    expect(phaseOfNode(node("m3", { label: "[0.7.2] 早期修复" }))).toBe("debug");
    expect(phaseOfNode(node("m4", { label: "[0.9.4] 结构升级" }))).toBe("p09x");
    expect(phaseOfNode(node("m5", { label: "[1.0.0] 收口" }))).toBe("p100");
  });

  it("id 规则优先于标签兜底", () => {
    expect(phaseOfNode(node("g080-release", { label: "[0.8.0] 发布" }))).toBe("debug");
  });

  it("非段位方括号前缀（如 [IL-011]）不误判", () => {
    expect(phaseOfNode(node("il-x", { label: "[IL-011] 通用性" }))).toBe("debug"); // id 命中
    expect(phaseOfNode(node("m6", { label: "[注] 仅为说明" }))).toBe(null);
  });
});

describe("phaseGroups（图例成员清单）", () => {
  it("工作流节点按段位分组；知识顶点与未判段节点不进任何组", () => {
    const nodes = [
      node("fix-v080-a1"),
      node("g080-release"),
      node("v081-webui"),
      node("v090-fogui"),
      node("v100-freeze"),
      node("t-unknown"),
      node("ctx-tooling", { type: "context" as NodeType }),
    ];
    const groups = phaseGroups(nodes);
    expect(groups.get("debug")?.map((n) => n.id)).toEqual(["fix-v080-a1", "g080-release"]);
    expect(groups.get("p08x")?.map((n) => n.id)).toEqual(["v081-webui"]);
    expect(groups.get("p09x")?.map((n) => n.id)).toEqual(["v090-fogui"]);
    expect(groups.get("p100")?.map((n) => n.id)).toEqual(["v100-freeze"]);
    expect(groups.size).toBe(4);
  });

  it("空图 → 空 Map", () => {
    expect(phaseGroups([]).size).toBe(0);
  });
});

describe("PHASE_BANDS（开发顺序四段元数据）", () => {
  it("四段按开发顺序排列，段位 id 齐全", () => {
    expect(PHASE_BANDS.map((b) => b.id)).toEqual(["debug", "p08x", "p09x", "p100"]);
  });

  it("每段带配套分期索引域 ctx-phase-*", () => {
    expect(PHASE_BANDS.map((b) => b.ctxId)).toEqual([
      "ctx-phase-debug",
      "ctx-phase-08x",
      "ctx-phase-09x",
      "ctx-phase-100",
    ]);
  });

  it("bandOf 已知段位返回元数据、未知返回 null", () => {
    expect(bandOf("p08x")?.label).toBe("0.8.x");
    expect(bandOf("nonexistent" as never)).toBe(null);
  });
});
