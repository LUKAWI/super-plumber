export type NodeStatus = "pending" | "ready" | "running" | "passed" | "failed" | "blocked" | "cancelled";
export type NodeType = "task" | "checkpoint" | "decision" | "gate";
export type EdgeType = "depends_on" | "validates" | "shares_context" | "fan_out" | "fan_in" | "fallback" | "iterates";

export interface NodeSchema {
  id: string;
  type: NodeType;
  label: string;
  level: number;
  status: NodeStatus;
  assigned_to?: string;
  attempts: number;
  max_attempts: number;
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
  type: "graph:full" | "graph:update";
  data: GraphIndex & { file?: string; type?: string; timestamp?: number };
}

export const STATUS_COLORS: Record<NodeStatus, string> = {
  pending: "#94a3b8",
  ready: "#3b82f6",
  running: "#f59e0b",
  passed: "#22c55e",
  failed: "#ef4444",
  blocked: "#8b5cf6",
  cancelled: "#6b7280",
};
