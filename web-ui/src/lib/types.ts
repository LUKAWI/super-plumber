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
	label?: string;
	version?: string;
	nodes: NodeSchema[];
	edges: EdgeSchema[];
	adjacency?: Record<string, string[]>;
	reverseAdj?: Record<string, string[]>;
}

export interface WsMessage {
	type: "graph:full" | "graph:update" | "node:updated";
	data: GraphIndex & { file?: string; type?: string; timestamp?: number };
	nodeId?: string;
	node?: NodeSchema | null;
	removed?: boolean;
}

// 边类型 → 基础色相（默认状态下微妙差异，hover 时增强）
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
// pending #8a8f98 | ready #4a93e8 | running #f0a73a | passed #34c964
// failed #e5504f | blocked #a574e6 | cancelled #5b5f66
export const STATUS_COLORS: Record<NodeStatus, string> = {
	pending: "#8a8f98",
	ready: "#4a93e8",
	running: "#f0a73a",
	passed: "#34c964",
	failed: "#e5504f",
	blocked: "#a574e6",
	cancelled: "#5b5f66",
};

// ADR 三态色（与状态色体系同源：proposed 中性 / accepted 绿 / superseded 红）
export const ADR_STATUS_COLORS: Record<AdrStatus, string> = {
	proposed: "#8a8f98",
	accepted: "#34c964",
	superseded: "#e5504f",
};

/** 统一取状态色：adr 三态优先，其余查工作流七态表 */
export function statusColorOf(status: NodeStatus | AdrStatus): string {
	if (status === "proposed" || status === "accepted" || status === "superseded") {
		return ADR_STATUS_COLORS[status];
	}
	return STATUS_COLORS[status] ?? STATUS_COLORS.pending;
}
