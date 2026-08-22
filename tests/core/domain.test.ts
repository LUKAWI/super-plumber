// tests/core/domain.test.ts — v0.5 领域语义：map 派生 + 六条跨文件校验规则
// 溯源：设计共识 §1（数据模型）/ §2（契约边激活）；规格 A
import { describe, it, expect } from "vitest";
import {
  nodeMapOf,
  deriveMaps,
  edgeMapsOf,
  validateDomainRules,
} from "../../src/core/domain.js";
import {
  EdgeType,
  NodeType,
  NodeStatus,
  type NodeSchema,
  type EdgeSchema,
} from "../../src/core/types.js";

function node(id: string, type: NodeType, extra: Partial<NodeSchema> = {}): NodeSchema {
  return {
    id,
    type,
    label: id,
    level: 1,
    status: NodeStatus.Pending,
    attempts: 0,
    max_attempts: 3,
    created_at: "2026-08-22T00:00:00.000Z",
    updated_at: "2026-08-22T00:00:00.000Z",
    ...extra,
  };
}

function edge(id: string, source: string, target: string, type: EdgeType, extra: Partial<EdgeSchema> = {}): EdgeSchema {
  return { id, source, target, type, ...extra };
}

describe("map 派生", () => {
  it("工作流类型 → workflow；知识类型（context/adr）→ domain", () => {
    expect(nodeMapOf(node("a", NodeType.Task))).toBe("workflow");
    expect(nodeMapOf(node("a", NodeType.Gate))).toBe("workflow");
    expect(nodeMapOf(node("a", NodeType.Context))).toBe("domain");
    expect(nodeMapOf(node("a", NodeType.Adr))).toBe("domain");
  });

  it("deriveMaps 把节点集分成两个视图", () => {
    const maps = deriveMaps([
      node("t1", NodeType.Task),
      node("c1", NodeType.Context),
      node("a1", NodeType.Adr),
      node("t2", NodeType.Decision),
    ]);
    expect(maps.workflow.map((n) => n.id)).toEqual(["t1", "t2"]);
    expect(maps.domain.map((n) => n.id)).toEqual(["c1", "a1"]);
  });

  it("decides 边跨两个 map（只在叠加视图可见）；工作流边单 map", () => {
    const byId = new Map([
      ["t1", node("t1", NodeType.Task)],
      ["t2", node("t2", NodeType.Task)],
      ["a1", node("a1", NodeType.Adr)],
      ["c1", node("c1", NodeType.Context)],
    ]);
    expect(new Set(edgeMapsOf(edge("d1", "a1", "t1", EdgeType.Decides), byId))).toEqual(
      new Set(["domain", "workflow"]),
    );
    expect(edgeMapsOf(edge("e1", "t1", "t2", EdgeType.DependsOn), byId)).toEqual([
      "workflow",
    ]);
  });
});

describe("validateDomainRules 六规则", () => {
  it("旧图零迁移：无知识顶点/无领域字段 → 零 issue", () => {
    const nodes = [node("t1", NodeType.Task), node("t2", NodeType.Task)];
    const edges = [edge("e1", "t1", "t2", EdgeType.DependsOn)];
    expect(validateDomainRules(nodes, edges)).toEqual([]);
  });

  it("规则1：悬空 context 引用 → error；指向非 context 顶点同样 error", () => {
    const nodes = [
      node("t1", NodeType.Task, { context: "ctx_ghost" }),
      node("t2", NodeType.Task, { context: "t1" }), // 指向 task，不是 context 顶点
      node("ctx_ok", NodeType.Context),
      node("t3", NodeType.Task, { context: "ctx_ok" }),
    ];
    const issues = validateDomainRules(nodes, []);
    const errs = issues.filter((i) => i.level === "error");
    expect(errs).toHaveLength(2);
    expect(errs[0].message).toContain("ctx_ghost");
    expect(errs[1].message).toContain("t1");
  });

  it("规则2：同一 context 内术语重复 → warning；跨 context 同名合法", () => {
    const dup = validateDomainRules(
      [
        node("ctx1", NodeType.Context, {
          glossary: [
            { term: "订单", definition: "A" },
            { term: "订单", definition: "B" },
          ],
        }),
      ],
      [],
    );
    expect(dup).toHaveLength(1);
    expect(dup[0].level).toBe("warning");
    expect(dup[0].message).toContain("订单");

    const crossOk = validateDomainRules(
      [
        node("ctx1", NodeType.Context, { glossary: [{ term: "订单", definition: "A" }] }),
        node("ctx2", NodeType.Context, { glossary: [{ term: "订单", definition: "B" }] }),
      ],
      [],
    );
    expect(crossOk).toEqual([]);
  });

  it("规则3：跨 context 工作流边未填 contract → warning；填了或同 context 则不警告", () => {
    const nodes = [
      node("ctx1", NodeType.Context),
      node("ctx2", NodeType.Context),
      node("t1", NodeType.Task, { context: "ctx1" }),
      node("t2", NodeType.Task, { context: "ctx2" }),
      node("t3", NodeType.Task, { context: "ctx1" }),
    ];
    const issues = validateDomainRules(nodes, [
      edge("e1", "t1", "t2", EdgeType.DependsOn), // 跨 context 无 contract
      edge("e2", "t1", "t3", EdgeType.DependsOn), // 同 context
      edge("e3", "t2", "t3", EdgeType.DependsOn, {
        contract: { produces: "产物" },
      }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warning");
    expect(issues[0].message).toContain("e1");
    expect(issues[0].message).toContain("contract");
  });

  it("规则3 例外：知识边（decides/relates）不适用契约规则", () => {
    const nodes = [
      node("ctx1", NodeType.Context),
      node("ctx2", NodeType.Context),
      node("t1", NodeType.Task, { context: "ctx1" }),
    ];
    const issues = validateDomainRules(nodes, [
      edge("r1", "ctx1", "ctx2", EdgeType.Relates),
    ]);
    expect(issues.filter((i) => i.message.includes("contract"))).toEqual([]);
  });

  it("规则4：relates 边端点非 context 顶点 → error（两端各报）", () => {
    const nodes = [
      node("ctx1", NodeType.Context),
      node("t1", NodeType.Task),
      node("t2", NodeType.Task),
    ];
    const issues = validateDomainRules(nodes, [
      edge("r1", "ctx1", "t1", EdgeType.Relates),
      edge("r2", "t1", "t2", EdgeType.Relates),
    ]);
    const errs = issues.filter((i) => i.level === "error" && i.message.includes("relates"));
    expect(errs).toHaveLength(3); // r1 一端 + r2 两端
  });

  it("规则5：孤儿 ADR（无 decides 出边）→ warning", () => {
    const nodes = [
      node("adr1", NodeType.Adr),
      node("adr2", NodeType.Adr),
      node("t1", NodeType.Task),
    ];
    const issues = validateDomainRules(nodes, [
      edge("d1", "adr2", "t1", EdgeType.Decides),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warning");
    expect(issues[0].message).toContain("adr1");
    expect(issues[0].message).toContain("decides");
  });

  it("规则6：decides 边 source 非 adr 顶点 → error", () => {
    const issues = validateDomainRules(
      [node("t1", NodeType.Task), node("t2", NodeType.Task)],
      [edge("d1", "t1", "t2", EdgeType.Decides)],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("error");
    expect(issues[0].message).toContain("decides");
    expect(issues[0].message).toContain("t1");
  });

  it("全绿样例：合法领域结构零 issue", () => {
    const nodes = [
      node("ctx1", NodeType.Context, {
        boundary: "订单上下文",
        glossary: [
          { term: "订单", definition: "带明细行的购买单据" },
          { term: "账单", definition: "待收款引用" },
        ],
      }),
      node("ctx2", NodeType.Context, {
        glossary: [{ term: "订单", definition: "billing 视角的订单引用" }], // 跨 context 同名合法
      }),
      node("adr1", NodeType.Adr, { decision: "纯文件存储" }),
      node("t1", NodeType.Task, { context: "ctx1" }),
      node("t2", NodeType.Task, { context: "ctx2" }),
    ];
    const issues = validateDomainRules(nodes, [
      edge("d1", "adr1", "t1", EdgeType.Decides),
      edge("r1", "ctx1", "ctx2", EdgeType.Relates, { rel_kind: "upstream-downstream" }),
      edge("e1", "t1", "t2", EdgeType.DependsOn, {
        contract: { produces: "订单事件", consumed_by: [{ artifact: "订单", used_as: "计费输入" }] },
      }),
    ]);
    expect(issues).toEqual([]);
  });
});
