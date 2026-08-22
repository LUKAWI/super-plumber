import { describe, it, expect } from "vitest";
import {
	nodeMapOf,
	deriveMaps,
	edgeMapsOf,
	isEdgeVisibleInMaps,
	isNodeVisibleInMaps,
	contextHullGroups,
	contextColors,
	isContractEdge,
	adrBadgesFor,
	adrFlagsFor,
	type ActiveMaps,
} from "./maps";
import type { NodeSchema, EdgeSchema, NodeType, EdgeType, NodeStatus } from "./types";

function node(
	id: string,
	type: NodeType,
	extra: Partial<NodeSchema> = {},
): NodeSchema {
	return {
		id,
		type,
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

function edge(id: string, source: string, target: string, type: EdgeType, extra: Partial<EdgeSchema> = {}): EdgeSchema {
	return { id, source, target, type, ...extra };
}

const WORKFLOW_ONLY: ActiveMaps = { workflow: true, domain: false };
const DOMAIN_ONLY: ActiveMaps = { workflow: false, domain: true };
const OVERLAY: ActiveMaps = { workflow: true, domain: true };
const NONE: ActiveMaps = { workflow: false, domain: false };

describe("nodeMapOf / deriveMaps", () => {
	it("知识顶点（context/adr）→ domain，工作流顶点 → workflow", () => {
		expect(nodeMapOf(node("c1", "context"))).toBe("domain");
		expect(nodeMapOf(node("a1", "adr"))).toBe("domain");
		expect(nodeMapOf(node("t1", "task"))).toBe("workflow");
		expect(nodeMapOf(node("g1", "gate"))).toBe("workflow");
	});

	it("deriveMaps 把节点集分成两个视图", () => {
		const nodes = [
			node("t1", "task"),
			node("c1", "context"),
			node("a1", "adr"),
			node("k1", "checkpoint"),
		];
		const maps = deriveMaps(nodes);
		expect(maps.workflow.map((n) => n.id)).toEqual(["t1", "k1"]);
		expect(maps.domain.map((n) => n.id)).toEqual(["c1", "a1"]);
	});
});

describe("edgeMapsOf / isEdgeVisibleInMaps（边可见性规则）", () => {
	const nodes = [
		node("t1", "task", { context: "c1" }),
		node("t2", "task", { context: "c2" }),
		node("c1", "context"),
		node("c2", "context"),
		node("a1", "adr"),
	];
	const byId = new Map(nodes.map((n) => [n.id, n]));

	it("工作流↔工作流边只属 workflow map", () => {
		expect(edgeMapsOf(edge("e1", "t1", "t2", "depends_on"), byId)).toEqual(["workflow"]);
	});

	it("decides 边（adr→task）横跨两个 map，只在叠加视图可见", () => {
		const e = edge("e2", "a1", "t1", "decides");
		expect(new Set(edgeMapsOf(e, byId))).toEqual(new Set(["workflow", "domain"]));
		expect(isEdgeVisibleInMaps(e, byId, WORKFLOW_ONLY)).toBe(false);
		expect(isEdgeVisibleInMaps(e, byId, DOMAIN_ONLY)).toBe(false);
		expect(isEdgeVisibleInMaps(e, byId, OVERLAY)).toBe(true);
	});

	it("relates 边（context↔context）只属 domain map，领域视图可见", () => {
		const e = edge("e3", "c1", "c2", "relates", { rel_kind: "upstream" });
		expect(edgeMapsOf(e, byId)).toEqual(["domain"]);
		expect(isEdgeVisibleInMaps(e, byId, DOMAIN_ONLY)).toBe(true);
		expect(isEdgeVisibleInMaps(e, byId, WORKFLOW_ONLY)).toBe(false);
	});

	it("工作流边在工作流视图与叠加视图可见，领域视图不可见", () => {
		const e = edge("e1", "t1", "t2", "depends_on");
		expect(isEdgeVisibleInMaps(e, byId, WORKFLOW_ONLY)).toBe(true);
		expect(isEdgeVisibleInMaps(e, byId, OVERLAY)).toBe(true);
		expect(isEdgeVisibleInMaps(e, byId, DOMAIN_ONLY)).toBe(false);
		expect(isEdgeVisibleInMaps(e, byId, NONE)).toBe(false);
	});

	it("端点节点缺失时按已知端点判定（防悬挂边崩溃）", () => {
		const e = edge("e9", "ghost", "t1", "depends_on");
		expect(edgeMapsOf(e, byId)).toEqual(["workflow"]);
	});
});

describe("isNodeVisibleInMaps", () => {
	it("按所属 map 开关过滤顶点", () => {
		const t = node("t1", "task");
		const c = node("c1", "context");
		expect(isNodeVisibleInMaps(t, WORKFLOW_ONLY)).toBe(true);
		expect(isNodeVisibleInMaps(t, DOMAIN_ONLY)).toBe(false);
		expect(isNodeVisibleInMaps(c, DOMAIN_ONLY)).toBe(true);
		expect(isNodeVisibleInMaps(c, WORKFLOW_ONLY)).toBe(false);
		expect(isNodeVisibleInMaps(t, NONE)).toBe(false);
	});
});

describe("contextHullGroups（hull 成员分组）", () => {
	it("按 context 字段分组工作流成员", () => {
		const nodes = [
			node("t1", "task", { context: "c1" }),
			node("t2", "task", { context: "c1" }),
			node("t3", "task", { context: "c2" }),
			node("t4", "task"), // 无归属
			node("c1", "context"),
			node("a1", "adr", { context: "c1" }), // 知识顶点不算成员
		];
		const groups = contextHullGroups(nodes);
		expect(groups.get("c1")?.map((n) => n.id)).toEqual(["t1", "t2"]);
		expect(groups.get("c2")?.map((n) => n.id)).toEqual(["t3"]);
		expect(groups.has("t4")).toBe(false);
	});

	it("空图返回空 Map", () => {
		expect(contextHullGroups([]).size).toBe(0);
	});
});

describe("contextColors", () => {
	it("按 id 排序稳定分配，重复调用同色", () => {
		const c1 = contextColors(["c-b", "c-a", "c-c"]);
		const c2 = contextColors(["c-a", "c-c", "c-b"]);
		expect(c1.get("c-a")).toBe(c2.get("c-a"));
		expect(c1.get("c-b")).toBe(c2.get("c-b"));
		// 三个不同 id 三种不同色
		expect(new Set(c1.values()).size).toBe(3);
	});

	it("超出调色板长度时取模循环", () => {
		const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
		const colors = contextColors(ids);
		expect(colors.get("c0")).toBe(colors.get("c8")); // 8 色循环
	});
});

describe("isContractEdge（跨 context 契约边）", () => {
	const nodes = [
		node("t1", "task", { context: "c1" }),
		node("t2", "task", { context: "c2" }),
		node("t3", "task", { context: "c1" }),
		node("t4", "task"), // 无归属
		node("c1", "context"),
		node("c2", "context"),
		node("a1", "adr"),
	];
	const byId = new Map(nodes.map((n) => [n.id, n]));

	it("两端 context 不同 → 契约边", () => {
		expect(isContractEdge(edge("e1", "t1", "t2", "depends_on"), byId)).toBe(true);
	});

	it("同 context / 任一端无 context → 非契约边", () => {
		expect(isContractEdge(edge("e2", "t1", "t3", "depends_on"), byId)).toBe(false);
		expect(isContractEdge(edge("e3", "t1", "t4", "depends_on"), byId)).toBe(false);
	});

	it("知识边（decides/relates）恒非契约边", () => {
		expect(isContractEdge(edge("e4", "c1", "c2", "relates"), byId)).toBe(false);
		expect(isContractEdge(edge("e5", "a1", "t1", "decides"), byId)).toBe(false);
	});
});

describe("adrBadgesFor（decides → 徽章）", () => {
	it("decides 指向节点 → 附着该节点的徽章；指向 context → 附着簇的徽章", () => {
		const nodes = [
			node("t1", "task", { context: "c1" }),
			node("c1", "context"),
			node("a1", "adr", { label: "ADR-1", status: "accepted" }),
			node("a2", "adr", {
				label: "ADR-2",
				status: "superseded",
				superseded_by: "a3",
			}),
		];
		const edges = [
			edge("e1", "a1", "t1", "decides"),
			edge("e2", "a2", "c1", "decides"),
		];
		const badges = adrBadgesFor(nodes, edges);
		expect(badges).toHaveLength(2);
		const b1 = badges.find((b) => b.adrId === "a1")!;
		expect(b1.anchorNodeId).toBe("t1");
		expect(b1.anchorIsContext).toBe(false);
		expect(b1.status).toBe("accepted");
		const b2 = badges.find((b) => b.adrId === "a2")!;
		expect(b2.anchorNodeId).toBe("c1");
		expect(b2.anchorIsContext).toBe(true);
		expect(b2.supersededBy).toBe("a3");
	});

	it("非 adr 发出的 decides 边被忽略（防御后端校验前数据）", () => {
		const nodes = [node("t1", "task"), node("t2", "task")];
		const edges = [edge("e1", "t1", "t2", "decides")];
		expect(adrBadgesFor(nodes, edges)).toHaveLength(0);
	});
});

describe("adrFlagsFor（superseded 传播）", () => {
	it("decides 打在节点上 → 该节点打 ⚠️", () => {
		const nodes = [
			node("t1", "task"),
			node("a1", "adr", { status: "superseded", superseded_by: "a2", label: "旧决策" }),
			node("a2", "adr", { status: "accepted" }),
		];
		const edges = [
			edge("e1", "a1", "t1", "decides"),
			edge("e2", "a2", "t1", "decides"),
		];
		const flags = adrFlagsFor(nodes, edges);
		expect(flags.get("t1")).toHaveLength(1);
		expect(flags.get("t1")![0]).toContain("旧决策");
		expect(flags.get("t1")![0]).toContain("a2");
	});

	it("decides 打在 context 上 → 传播给全体成员", () => {
		const nodes = [
			node("t1", "task", { context: "c1" }),
			node("t2", "task", { context: "c1" }),
			node("c1", "context"),
			node("a1", "adr", { status: "superseded" }),
		];
		const edges = [edge("e1", "a1", "c1", "decides")];
		const flags = adrFlagsFor(nodes, edges);
		expect(flags.get("t1")).toHaveLength(1);
		expect(flags.get("t2")).toHaveLength(1);
	});

	it("无 superseded ADR → 空 Map", () => {
		const nodes = [node("t1", "task"), node("a1", "adr", { status: "accepted" })];
		const edges = [edge("e1", "a1", "t1", "decides")];
		expect(adrFlagsFor(nodes, edges).size).toBe(0);
	});
});
