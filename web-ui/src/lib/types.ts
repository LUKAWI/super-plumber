export type NodeStatus = "pending" | "ready" | "running" | "passed" | "failed" | "blocked" | "cancelled";
export type NodeType = "task" | "checkpoint" | "decision" | "gate";
export type EdgeType = "depends_on" | "validates" | "shares_context" | "fan_out" | "fan_in" | "fallback" | "iterates";

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
