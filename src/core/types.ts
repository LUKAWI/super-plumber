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
  // v0.5 知识顶点：领域语义的一等公民，豁免工作流调度与状态机
  Context = "context",
  Adr = "adr",
}

// 知识顶点集合（context/adr）：不进调度桶、不占拓扑序、不参与完成判定
export const KNOWLEDGE_NODE_TYPES: readonly NodeType[] = [
  NodeType.Context,
  NodeType.Adr,
];

export function isKnowledgeType(type: NodeType): boolean {
  return KNOWLEDGE_NODE_TYPES.includes(type);
}

// ADR 顶点私有状态机（仅 adr 类型可用；context 顶点完全无状态）
export enum AdrStatus {
  Proposed = "proposed",
  Accepted = "accepted",
  Superseded = "superseded",
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
  // v0.5 知识边：不参与拓扑排序、不构成门禁
  Decides = "decides", // ADR → 任意顶点（决策管辖；superseded 时沿此传播 adr_flags）
  Relates = "relates",  // context ↔ context（领域关系，rel_kind 自由标注）
}

// 参与拓扑排序的边类型（不包含 fallback / iterates 等运行时边，也不含 decides / relates 知识边）
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
  /** v0.5：归属的 context 顶点 id（外键，validate 校验存在性；知识顶点自身不用此字段） */
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
  /** v0.5（adr 顶点）：接替者 ADR id（status=superseded 时必填，schema 强制） */
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
  /** v0.5（relates 边）：领域关系自由标注（upstream/downstream/shared-kernel…），非枚举 */
  rel_kind?: string;
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

// ── 目录常量（v0.5.2：图内相对——相对"图目录"而非工作区根；
// 图目录 = .graph/<名>/（多图）或 .graph/（旧布局原地=default）。归一化见 graph-dir.ts）──
export const GRAPH_DIR = ".graph"; // 工作区级：多图与工作区状态（active/workspace-events/.trash）的容器
export const NODES_DIR = "nodes";
export const EDGES_DIR = "edges";
export const INDEX_DIR = "index";
export const GRAPH_FILE = "graph.yaml";
