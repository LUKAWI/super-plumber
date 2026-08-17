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

// 参与 ready 门禁的边类型：depends_on（顺序依赖）、validates（验证）、
// fan_in（汇聚，全部上游完成）、fan_out（"A 完成后 B/C 可并行"——完成语义同样构成前置）。
// shares_context / fallback / iterates 是运行时控制流边，不构成门禁。
// 定义在 types.ts（而非 node.ts）以避免 index-service ↔ node 的循环依赖。
export const GATE_EDGE_TYPES: readonly EdgeType[] = [
  EdgeType.DependsOn,
  EdgeType.Validates,
  EdgeType.FanIn,
  EdgeType.FanOut,
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

// 执行报告：执行 agent 写给 Super Mario 的交接单
// summary: 执行摘要 | artifacts: 产物路径（供抽查）| blockers: 阻塞原因 | notes: 补充
// started_at / completed_at: 认领与完成时间戳
// verification: Super Mario 抽查后的验证结论

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
  /** FIX-F1：调度优先级（≥0，越小越先被推荐；缺省 = 最低优先级） */
  priority?: number;
  plan?: Plan;
  expected_outcome?: ExpectedOutcome;
  checkpoints?: Checkpoint[];
  status: NodeStatus;
  assigned_to?: string;
  execution_report?: ExecutionReport;
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
