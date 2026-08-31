import { describe, it, expect } from "vitest";
import { frontierNodes, frontierIds, GATING_EDGE_TYPES } from "./frontier";
import type { GraphIndex, NodeSchema, NodeType, EdgeType, NodeStatus } from "./types";

function node(
  id: string,
  extra: Partial<NodeSchema> = {},
): NodeSchema {
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

function edge(id: string, source: string, target: string, type: EdgeType) {
  return { id, source, target, type };
}

function graph(nodes: NodeSchema[], edges: GraphIndex["edges"]): GraphIndex {
  return { nodes, edges } as GraphIndex;
}

describe("frontierNodes（前沿 = ready + ready_eligible 合并）", () => {
  it("ready 直接入前沿；pending 无门控入边自然满足（空门禁）", () => {
    const g = graph(
      [
        node("a", { status: "ready" }),
        node("b", { status: "pending" }),
        node("c", { status: "running" }),
        node("d", { status: "passed" }),
        node("e", { status: "failed" }),
      ],
      [],
    );
    expect(frontierIds(g)).toEqual(new Set(["a", "b"]));
  });

  it("ready_eligible：pending 且唯一门控前驱 passed → 入前沿", () => {
    const g = graph(
      [
        node("pred", { status: "passed" }),
        node("elig", { status: "pending" }),
      ],
      [edge("e1", "pred", "elig", "depends_on")],
    );
    expect(frontierIds(g)).toEqual(new Set(["elig"]));
  });

  it("门控前驱未 passed（running）→ pending 不入前沿", () => {
    const g = graph(
      [
        node("pred", { status: "running" }),
        node("elig", { status: "pending" }),
      ],
      [edge("e1", "pred", "elig", "depends_on")],
    );
    expect(frontierIds(g)).toEqual(new Set());
  });

  it("多前驱合流：全部 passed 才入（fan_in 汇聚语义）", () => {
    const base = [
      node("p1", { status: "passed" }),
      node("p2", { status: "pending" }),
      node("join", { status: "pending" }),
    ];
    const edges = [
      edge("e1", "p1", "join", "fan_in"),
      edge("e2", "p2", "join", "fan_in"),
    ];
    expect(frontierIds(graph(base, edges))).toEqual(new Set(["p2"]));
    const allPassed = base.map((n) =>
      n.id === "p2" ? { ...n, status: "passed" as NodeStatus } : n,
    );
    expect(frontierIds(graph(allPassed, edges))).toEqual(new Set(["join"]));
  });

  it("混合门控：一条 depends_on 满足、一条 validates 未满足 → 不入", () => {
    const g = graph(
      [
        node("p1", { status: "passed" }),
        node("p2", { status: "blocked" }),
        node("t", { status: "pending" }),
      ],
      [
        edge("e1", "p1", "t", "depends_on"),
        edge("e2", "p2", "t", "validates"),
      ],
    );
    expect(frontierIds(g)).toEqual(new Set());
  });

  it("门控前驱在节点表中缺失 → 按未满足处理（保守）", () => {
    const g = graph(
      [node("t", { status: "pending" })],
      [edge("e1", "ghost", "t", "depends_on")],
    );
    expect(frontierIds(g)).toEqual(new Set());
  });

  it("知识顶点（context/adr）不入前沿——不进调度桶", () => {
    const g = graph(
      [
        node("c1", { type: "context" as NodeType }),
        node("a1", { type: "adr" as NodeType, status: "proposed" as NodeStatus }),
        node("t1", { status: "ready" }),
      ],
      [],
    );
    expect(frontierIds(g)).toEqual(new Set(["t1"]));
  });

  it("非门控边（decides/relates/shares_context）不影响前沿判定", () => {
    const g = graph(
      [
        node("adr", { type: "adr" as NodeType, status: "proposed" as NodeStatus }),
        node("c1", { type: "context" as NodeType }),
        node("t1", { status: "pending" }),
      ],
      [
        edge("e1", "adr", "t1", "decides"),
        edge("e2", "c1", "t1", "shares_context"),
      ],
    );
    expect(frontierIds(g)).toEqual(new Set(["t1"]));
  });

  it("排序：priority 升序在前，缺省垫底，同优先级按 id", () => {
    const g = graph(
      [
        node("z", { status: "ready" }),
        node("b", { status: "pending", priority: 10 }),
        node("a", { status: "pending", priority: 10 }),
        node("m", { status: "ready", priority: 1 }),
      ],
      [],
    );
    expect(frontierNodes(g).map((n) => n.id)).toEqual(["m", "a", "b", "z"]);
  });

  it("门控边类型全集与后端核心一致（四种）", () => {
    expect(GATING_EDGE_TYPES).toEqual(["depends_on", "validates", "fan_in", "fan_out"]);
  });
});
