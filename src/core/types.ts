// src/core/types.ts

// ── 状态机 ──
export enum NodeStatus {
  Pending = "pending",
  Ready = "ready",
  Running = "running",
  Passed = "passed",
  Failed = "failed",
  Blocked = "blocked",
  Cancelled = "cancelled",
}

// ── 节点类型 ──
export enum NodeType {
  Task = "task",
  Checkpoint = "checkpoint",
  Decision = "decision",
  Gate = "gate",
}

// ── 边类型 ──
export enum EdgeType {
  DependsOn = "depends_on",
  Validates = "validates",
  SharesContext = "shares_context",
  FanOut = "fan_out",
  FanIn = "fan_in",
  Fallback = "fallback",
  Iterates = "iterates",
}

// 参与拓扑排序的边类型（不包含 fallback / iterates 等运行时边）
export const TOPOLOGICAL_EDGE_TYPES: EdgeType[] = [
  EdgeType.DependsOn,
  EdgeType.Validates,
];

// ── Checkpoint ──
export type CheckpointStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface Checkpoint {
  id: string;
  label: string;
  status: CheckpointStatus;
  verifier: "auto" | "cross_review" | "human";
}

// ── 节点 schema ──
export interface Plan {
  description: string;
  input_from?: { node: string; artifact: string }[];
  required_context?: { key: string; source: string }[];
  output_to?: { node: string; artifact: string }[];
}

export interface ExpectedOutcome {
  definition_of_done: string[];
  quality_gates?: { check: string; method: "auto" | "cross_review" | "human" }[];
}

export interface NodeSchema {
  id: string;
  type: NodeType;
  label: string;
  level: number;
  plan?: Plan;
  expected_outcome?: ExpectedOutcome;
  checkpoints?: Checkpoint[];
  status: NodeStatus;
  assigned_to?: string;
  attempts: number;
  max_attempts: number;
  created_at: string;  // ISO 8601
  updated_at: string;  // ISO 8601
}

// ── 边 schema ──
export interface Contract {
  produces?: string;
  consumed_by?: { artifact: string; used_as: string }[];
  validation?: { required: boolean; method: string };
}

export interface EdgeSchema {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  contract?: Contract;
}

// ── 图 schema ──
export interface GraphEntry {
  description: string;
  defined_by: "human" | "llm";
  level: number;
}

export interface GraphExit {
  description: string;
  acceptance_criteria: string[];
  defined_by: "human" | "llm";
  level: number;
}

export interface GraphSchema {
  id: string;
  version: string;
  label: string;
  entry: GraphEntry;
  exit: GraphExit;
  nodes: { file: string }[];
  edges: { file: string }[];
  root_context?: Record<string, unknown>;
}

// ── 目录常量 ──
export const GRAPH_DIR = ".graph";
export const NODES_DIR = ".graph/nodes";
export const EDGES_DIR = ".graph/edges";
export const INDEX_DIR = ".graph/index";
export const GRAPH_FILE = ".graph/graph.yaml";
