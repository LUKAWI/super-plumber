export type NodeStatus =
	| "pending"
	| "ready"
	| "running"
	| "passed"
	| "failed"
	| "blocked"
	| "cancelled";
export type NodeType = "task" | "checkpoint" | "decision" | "gate";
export type EdgeType =
	| "depends_on"
	| "validates"
	| "shares_context"
	| "fan_out"
	| "fan_in"
	| "fallback"
	| "iterates";

export interface Plan {
	description: string;
	input_from?: { node: string; artifact: string }[];
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

export interface NodeSchema {
	id: string;
	type: NodeType;
	label: string;
	level: number;
	status: NodeStatus;
	plan?: Plan;
	expected_outcome?: ExpectedOutcome;
	checkpoints?: Checkpoint[];
	assigned_to?: string;
	execution_report?: ExecutionReport;
	attempts: number;
	max_attempts: number;
	created_at: string;
	updated_at: string;
	[key: string]: unknown;
}

export interface EdgeSchema {
	id: string;
	source: string;
	target: string;
	type: EdgeType;
}

export interface GraphIndex {
	nodes: NodeSchema[];
	edges: EdgeSchema[];
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
};

export const STATUS_COLORS: Record<NodeStatus, string> = {
	pending: "#6b7280",
	ready: "#3b82f6",
	running: "#f59e0b",
	passed: "#22c55e",
	failed: "#ef4444",
	blocked: "#8b5cf6",
	cancelled: "#64748b",
};
