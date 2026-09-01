export type NodeStatus =
	| "pending"
	| "ready"
	| "running"
	| "passed"
	| "failed"
	| "blocked"
	| "cancelled";
// v0.5 知识顶点：领域语义一等公民（与后端 core/types.ts 对齐）
export type NodeType =
	| "task"
	| "checkpoint"
	| "decision"
	| "gate"
	| "context"
	| "adr";
// ADR 顶点私有状态机（context 顶点完全无状态，恒 pending）
export type AdrStatus = "proposed" | "accepted" | "superseded";
export type EdgeType =
	| "depends_on"
	| "validates"
	| "shares_context"
	| "fan_out"
	| "fan_in"
	| "fallback"
	| "iterates"
	| "decides"
	| "relates";

// 知识顶点集合（context/adr）：不进调度桶、不占拓扑序
export const KNOWLEDGE_NODE_TYPES: readonly NodeType[] = ["context", "adr"];

export function isKnowledgeType(type: NodeType): boolean {
	return KNOWLEDGE_NODE_TYPES.includes(type);
}

export interface Plan {
	description: string;
	input_from?: { node: string; artifact: string }[];
	required_context?: { key: string; source: string }[];
	output_to?: { node: string; artifact: string }[];
}

export interface ExpectedOutcome {
	definition_of_done: string[];
	quality_gates?: { check: string; method: string }[];
}

export interface Checkpoint {
	id: string;
	label: string;
	status: string;
	verifier: string;
}

export interface ExecutionReport {
	summary: string;
	artifacts?: string[];
	blockers?: string[];
	notes?: string;
	started_at?: string;
	completed_at?: string;
	verification?: {
		verdict: "pending" | "passed" | "failed";
		checked_at?: string;
		note?: string;
	};
}

// v0.5 术语表条目（context 顶点内容，"节点即文档"）
export interface GlossaryEntry {
	term: string;
	definition: string;
}

export interface NodeSchema {
	id: string;
	type: NodeType;
	label: string;
	level: number;
	/** FIX-F1：调度优先级（≥0，越小越先被推荐；缺省 = 最低优先级） */
	priority?: number;
	/** v0.5：归属的 context 顶点 id（外键；知识顶点自身不用此字段） */
	context?: string;
	/** v0.5（context 顶点）：上下文边界描述 */
	boundary?: string;
	/** v0.5（context 顶点）：术语表 */
	glossary?: GlossaryEntry[];
	/** v0.5（adr 顶点）：决策内容（label 即标题，decision 必填） */
	decision?: string;
	background?: string;
	considered_options?: string;
	why?: string;
	consequences?: string;
	/** v0.5（adr 顶点）：接替者 ADR id（status=superseded 时必填） */
	superseded_by?: string;
	plan?: Plan;
	expected_outcome?: ExpectedOutcome;
	checkpoints?: Checkpoint[];
	/** 工作流七态；adr 顶点为三态（proposed/accepted/superseded）；context 恒 pending */
	status: NodeStatus | AdrStatus;
	assigned_to?: string;
	execution_report?: ExecutionReport;
	attempts: number;
	max_attempts: number;
	created_at: string;
	updated_at: string;
	[key: string]: unknown;
}

export interface EdgeContract {
	produces?: string;
	consumed_by?: { artifact: string; used_as: string }[];
	validation?: { required: boolean; method: string };
}

export interface EdgeSchema {
	id: string;
	source: string;
	target: string;
	type: EdgeType;
	contract?: EdgeContract;
	/** v0.5（relates 边）：领域关系自由标注（upstream/downstream/shared-kernel…），非枚举 */
	rel_kind?: string;
}

// adr_0007（0.9.0）：图级雾区概要——/api/graph 与 ws graph:full/graph:update
// 载荷顶层透出（serializeGraphIndex），图无雾时字段缺省；毕业后刷新即消失。
// 与后端 src/core/types.ts 的 GraphFog 对齐（前端不 import 后端）。
export interface GraphFog {
	/** 雾区标识（非节点 id；如 "release-automation"） */
	id: string;
	/** 雾区描述：哪里模糊、为什么暂时不展开 */
	description: string;
	/** 毕业条件：怎样算想清楚了 */
	graduation: string;
	/** 已点火的 research 票节点 id */
	ignited?: string[];
}

// next-actions 条目（ready / ready_eligible）：与后端 index-service.ts 的 schedEntry 对齐
export interface NextActionEntry {
	id: string;
	label: string;
	priority?: number;
	/** superseded ADR 沿 decides 边传播的"决策依据已过时"警告 */
	adr_flags?: string[];
}

export interface GraphIndex {
	id?: string;
	/** 图名（v0.5.2 多图：服务端 serializeGraphIndex 附带；HTTP 兜底刷新时用于定位桶） */
	name?: string;
	label?: string;
	version?: string;
	/** adr_0007（0.9.0）：图级雾区概要（可选；图无雾缺省，毕业刷新后消失） */
	fog?: GraphFog;
	nodes: NodeSchema[];
	edges: EdgeSchema[];
	adjacency?: Record<string, string[]>;
	reverseAdj?: Record<string, string[]>;
}

// v0.5.2 多图并行渲染：图元信息（/api/graphs 与 ws graphs:list 的条目）
export interface GraphMeta {
	name: string;
	label?: string;
	nodeCount: number;
	statuses?: Record<string, number>;
	/** 图内节点最近 updated_at（ISO）；空图/未初始化为 null */
	lastActivity?: string | null;
}

export interface GraphsListData {
	/** 工作区 active 指向的图名（无 active 文件/无效时 null） */
	active: string | null;
	graphs: GraphMeta[];
}

// ws 消息（判别联合）：图数据消息都带 graph: "<图名>"；工作区级消息用 graph: "*"
export type WsMessage =
	| { type: "graph:full" | "graph:update"; graph: string; data: GraphIndex }
	| {
			type: "node:updated";
			graph: string;
			nodeId: string;
			node: NodeSchema | null;
			removed?: boolean;
	  }
	| { type: "graphs:list"; graph: "*"; data: GraphsListData };

// 边类型 → 基础色相。v0.7 设计系统已将画布边线退为单色阶梯
// （依赖/契约/hover 三档白），类型语义由 hover 标签与 EdgeDetail 承载；
// 本表仅剩 EdgeDetail 的类型圆点等非画布场景使用，不再与状态色同屏。
export const EDGE_TYPE_COLORS: Record<EdgeType, string> = {
	depends_on: "#3b82f6",      // 蓝：顺序依赖
	validates: "#22c55e",       // 绿：验证
	shares_context: "#a855f7",  // 紫：上下文共享
	fan_out: "#06b6d4",         // 青：扇出
	fan_in: "#eab308",          // 黄：扇入
	fallback: "#ef4444",        // 红：回退
	iterates: "#f97316",        // 橙：迭代
	decides: "#f43f5e",         // 玫红：ADR 决策管辖（以徽章呈现，不作连线）
	relates: "#2dd4bf",         // 蓝绿：context 领域关系
};

// 边类型中文标签（hover 显示）
export const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
	depends_on: "依赖",
	validates: "验证",
	shares_context: "共享上下文",
	fan_out: "扇出",
	fan_in: "扇入",
	fallback: "回退",
	iterates: "迭代",
	decides: "决策管辖",
	relates: "领域关系",
};

// 状态色单一来源（与 web-ui/index.html 的 CSS 变量、CLI export-mermaid 保持一致）：
// pending #8a8f98 | ready #4a93e8 | running #f0a73a | passed #16a34a
// failed #e5504f | blocked #a574e6 | cancelled #7e848d（v0.7 提亮：原 #5b5f66 仅 3.27:1）
export const STATUS_COLORS: Record<NodeStatus, string> = {
	pending: "#8a8f98",
	ready: "#4a93e8",
	running: "#f0a73a",
	passed: "#16a34a",
	failed: "#e5504f",
	blocked: "#a574e6",
	cancelled: "#7e848d",
};

// ADR 三态色（与状态色体系同源：proposed 中性 / accepted 绿 / superseded 红）
export const ADR_STATUS_COLORS: Record<AdrStatus, string> = {
	proposed: "#8a8f98",
	accepted: "#16a34a",
	superseded: "#e5504f",
};

/** 统一取状态色：adr 三态优先，其余查工作流七态表 */
export function statusColorOf(status: NodeStatus | AdrStatus): string {
	if (status === "proposed" || status === "accepted" || status === "superseded") {
		return ADR_STATUS_COLORS[status];
	}
	return STATUS_COLORS[status] ?? STATUS_COLORS.pending;
}
