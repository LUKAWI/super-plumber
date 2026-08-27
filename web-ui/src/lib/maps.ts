// web-ui/src/lib/maps.ts — v0.5 map 过滤架构的纯逻辑（与后端 src/core/domain.ts 对齐，前端不 import 后端）
// 图是真相源，map 是派生视图：归属按顶点类型推导，边可见性按两端所属 map 交集判定。
import { isKnowledgeType, type EdgeSchema, type NodeSchema } from "./types";

// ── map 派生 ──

export type MapKind = "workflow" | "domain";

/** 透镜开关集：任意子集叠加（工作流默认开） */
export interface ActiveMaps {
	workflow: boolean;
	domain: boolean;
}

export const DEFAULT_ACTIVE_MAPS: ActiveMaps = { workflow: true, domain: false };

/** 顶点所属 map：知识类型（context/adr）→ domain，工作流类型 → workflow（按类型派生，零新存储） */
export function nodeMapOf(node: Pick<NodeSchema, "type">): MapKind {
	return isKnowledgeType(node.type) ? "domain" : "workflow";
}

/** 从节点集派生两个 map 视图 */
export function deriveMaps(nodes: NodeSchema[]): Record<MapKind, NodeSchema[]> {
	const workflow: NodeSchema[] = [];
	const domain: NodeSchema[] = [];
	for (const n of nodes) (nodeMapOf(n) === "domain" ? domain : workflow).push(n);
	return { workflow, domain };
}

/**
 * 边两端顶点所属的 map 集合（去重）。
 * decides 边连接 domain(adr) 与 workflow 节点 → { workflow, domain }。
 */
export function edgeMapsOf(edge: EdgeSchema, byId: Map<string, NodeSchema>): MapKind[] {
	const kinds = new Set<MapKind>();
	const s = byId.get(edge.source);
	const t = byId.get(edge.target);
	if (s) kinds.add(nodeMapOf(s));
	if (t) kinds.add(nodeMapOf(t));
	return [...kinds];
}

/**
 * 边可见性规则（map 过滤架构核心约束）：
 * 一条边可见 ⇔ 它两端顶点所属的 map 全部被勾选。
 * decides 边需要 workflow+domain 同时激活，天然只在叠加视图出现。
 */
export function isEdgeVisibleInMaps(
	edge: EdgeSchema,
	byId: Map<string, NodeSchema>,
	active: ActiveMaps,
): boolean {
	return edgeMapsOf(edge, byId).every((k) => active[k]);
}

/** 顶点在其所属 map 透镜下是否可见 */
export function isNodeVisibleInMaps(node: NodeSchema, active: ActiveMaps): boolean {
	return active[nodeMapOf(node)];
}

// ── 叠加视图：context hull 分组 ──

/** context → 成员工作流节点（知识顶点不参与成员分组——后端同款语义） */
export function contextHullGroups(nodes: NodeSchema[]): Map<string, NodeSchema[]> {
	const groups = new Map<string, NodeSchema[]>();
	for (const n of nodes) {
		if (!n.context || isKnowledgeType(n.type)) continue;
		const list = groups.get(n.context);
		if (list) list.push(n);
		else groups.set(n.context, [n]);
	}
	return groups;
}

// context 着色调色板（与 EDGE_TYPE_COLORS 协调但独立，避免语义混淆）
export const CONTEXT_PALETTE: readonly string[] = [
	"#f0a73a", // 琥珀
	"#4a93e8", // 蓝
	"#34c964", // 绿
	"#a574e6", // 紫
	"#06b6d4", // 青
	"#ec4899", // 粉
	"#eab308", // 黄
	"#2dd4bf", // 蓝绿
];

/** context 稳定着色：按 context id 排序后取模分配（节点增删不跳色） */
export function contextColors(contextIds: Iterable<string>): Map<string, string> {
	const sorted = [...new Set(contextIds)].sort();
	return new Map(sorted.map((id, i) => [id, CONTEXT_PALETTE[i % CONTEXT_PALETTE.length]]));
}

// ── 跨 context 契约边 ──

const KNOWLEDGE_EDGE_TYPES: readonly string[] = ["decides", "relates"];

/**
 * 契约边：非知识边 + 两端工作流节点各属不同 context。
 * （relates 连接的 context 顶点自身无 context 字段、decides 的 adr 无 context——天然不命中）
 */
export function isContractEdge(edge: EdgeSchema, byId: Map<string, NodeSchema>): boolean {
	if (KNOWLEDGE_EDGE_TYPES.includes(edge.type)) return false;
	const s = byId.get(edge.source);
	const t = byId.get(edge.target);
	if (!s?.context || !t?.context) return false;
	return s.context !== t.context;
}

// ── ADR 徽章（叠加视图：decides 关系的视觉呈现，不画连线）──

export interface AdrBadge {
	/** 徽章锚定对象：工作流节点 id，或 context id（附着于整个簇） */
	anchorNodeId: string;
	/** 锚定的是否为 context（簇） */
	anchorIsContext: boolean;
	adrId: string;
	title: string;
	status: "proposed" | "accepted" | "superseded";
	supersededBy?: string;
}

/** decides 边 → 徽章列表：ADR 附着于它管辖的节点或 context（簇） */
export function adrBadgesFor(nodes: NodeSchema[], edges: EdgeSchema[]): AdrBadge[] {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const badges: AdrBadge[] = [];
	for (const e of edges) {
		if (e.type !== "decides") continue;
		const adr = byId.get(e.source);
		const target = byId.get(e.target);
		if (!adr || adr.type !== "adr" || !target) continue;
		if (target.type === "context") {
			badges.push({
				anchorNodeId: target.id,
				anchorIsContext: true,
				adrId: adr.id,
				title: adr.label,
				status: adr.status as AdrBadge["status"],
				...(adr.superseded_by ? { supersededBy: adr.superseded_by } : {}),
			});
		} else if (!isKnowledgeType(target.type)) {
			badges.push({
				anchorNodeId: target.id,
				anchorIsContext: false,
				adrId: adr.id,
				title: adr.label,
				status: adr.status as AdrBadge["status"],
				...(adr.superseded_by ? { supersededBy: adr.superseded_by } : {}),
			});
		}
	}
	badges.sort((a, b) => a.adrId.localeCompare(b.adrId));
	return badges;
}

// ── ADR 角落座 / 决策文档（ADR 屏幕锚定呈现的共享纯逻辑）──

/** ADR 三态展示文案（颜色统一走 types.ADR_STATUS_COLORS / statusColorOf） */
export const ADR_STATUS_META: Record<
	"proposed" | "accepted" | "superseded",
	{ en: string; zh: string; mark: string }
> = {
	proposed: { en: "PROPOSED", zh: "待裁决", mark: "○" },
	accepted: { en: "ACCEPTED", zh: "已生效", mark: "●" },
	superseded: { en: "SUPERSEDED", zh: "已废弃", mark: "⊘" },
};

export interface AdrGovernTarget {
	/** 被管辖对象 id（工作流节点或 context 顶点） */
	nodeId: string;
	label: string;
	/** 是否为 context 簇锚（决定抽屉跳转/图标的呈现语义） */
	isContext: boolean;
}

/** adrId → 它沿 decides 出边管辖的对象清单（目标按 id 排序；孤儿 ADR → 不在表中） */
export function governsOf(
	nodes: NodeSchema[],
	edges: EdgeSchema[],
): Map<string, AdrGovernTarget[]> {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const out = new Map<string, AdrGovernTarget[]>();
	for (const e of edges) {
		if (e.type !== "decides") continue;
		const adr = byId.get(e.source);
		const target = byId.get(e.target);
		if (!adr || adr.type !== "adr" || !target) continue;
		const list = out.get(e.source) ?? [];
		list.push({ nodeId: target.id, label: target.label, isContext: target.type === "context" });
		out.set(e.source, list);
	}
	for (const list of out.values()) list.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
	return out;
}

/** 左下角 ADR 座条目：图内全部 ADR 按编号排序，管辖清单预取好供抽屉复用 */
export interface AdrDockItem {
	id: string;
	label: string;
	status: "proposed" | "accepted" | "superseded";
	governs: AdrGovernTarget[];
	supersededBy?: string;
}

export function adrDockItems(nodes: NodeSchema[], edges: EdgeSchema[]): AdrDockItem[] {
	const governs = governsOf(nodes, edges);
	return nodes
		.filter((n) => n.type === "adr")
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((n) => ({
			id: n.id,
			label: n.label,
			status: n.status as AdrDockItem["status"],
			governs: governs.get(n.id) ?? [],
			...(n.superseded_by ? { supersededBy: n.superseded_by } : {}),
		}));
}

// ── adr_flags 预计算（与后端 adrFlagsFor 同语义：superseded 沿 decides 传播）──

/**
 * 工作流节点 → "决策依据已过时" 警告列表。
 * decides 打在 context 上时传播给全体成员（簇级打标）。
 */
export function adrFlagsFor(nodes: NodeSchema[], edges: EdgeSchema[]): Map<string, string[]> {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const supersededAdrs = nodes.filter(
		(n) => n.type === "adr" && n.status === "superseded",
	);
	if (supersededAdrs.length === 0) return new Map();
	const supersededIds = new Set(supersededAdrs.map((n) => n.id));

	const contextMembers = new Map<string, string[]>();
	for (const n of nodes) {
		if (!n.context || isKnowledgeType(n.type)) continue;
		const list = contextMembers.get(n.context) ?? [];
		list.push(n.id);
		contextMembers.set(n.context, list);
	}

	const flags = new Map<string, string[]>();
	const flag = (nodeId: string, msg: string) => {
		const arr = flags.get(nodeId) ?? [];
		if (!arr.includes(msg)) arr.push(msg);
		flags.set(nodeId, arr);
	};
	for (const e of edges) {
		if (e.type !== "decides" || !supersededIds.has(e.source)) continue;
		const adr = byId.get(e.source);
		const msg =
			`ADR ${e.source}${adr?.label ? `（${adr.label}）` : ""}已 superseded` +
			`${adr?.superseded_by ? `（由 ${adr.superseded_by} 接替）` : ""}——决策依据已过时，建议重审`;
		const target = byId.get(e.target);
		if (target?.type === "context") {
			for (const memberId of contextMembers.get(e.target) ?? []) flag(memberId, msg);
		} else {
			flag(e.target, msg);
		}
	}
	return flags;
}
