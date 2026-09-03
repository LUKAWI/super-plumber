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

// IL-012（context 顶点）：对其他 context 的默认契约声明——契约是
// "两个 bounded context 之间的关系"属性（DDD），按 context 对声明一次，
// 跨 context 工作流边自动继承（validate 层面：声明存在即视为契约已声明）；
// 单边 contract 仍可覆写（例外集成点精确表达），存量逐边契约继续合法。
export interface ContextContractDecl {
  /** 目标 context id：跨 context 边的 target 所在 context
   * （声明挂在边的 source 侧 context 上，语义 = "我交付给 to 什么"，与
   * "source 是被依赖的前置/产出方"的方向约定一致） */
  to: string;
  /** 默认契约（形状与边 contract 完全一致：produces/consumed_by/validation） */
  contract: Contract;
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
  /** IL-012（context 顶点）：对其他 context 的默认契约声明（按 context 对一次；
   * 跨 context 工作流边自动继承，单边 contract 仍可覆写） */
  contracts?: ContextContractDecl[];
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

// DEC-1（g080-approve-core）：设计审核凭据——approve 双通道（CLI approve /
// MCP graph_approve）写入 graph.yaml，仅记录、零门禁：核心状态机不加任何
// 拒绝规则，调度面只在 ready_eligible 与 claim 响应以 review_flag 提示。
// status: 'approved'=人工审核 | 'self'=quick 自签（可区分）
//       | 'unreviewed'=结构修订后回置（F21/DEC-7：resetGraphReview 只写凭据字段，
//         review_flag nudge 重新亮起，走增量人审）。
// 可选字段：缺省不存在（存量图零迁移、零默认拒绝）。
export interface GraphReview {
  status: "approved" | "self" | "unreviewed";
  by: string; // 审核人（quick 自签时为 quick 操作者名；回置时为触发修订的通道/actor）
  at: string; // ISO 8601
  // F08（0.9.2 渐进审批）：分层批准记录（approve --level 追加式写入；缺省不存在
  // =存量图零迁移）。同层重复 approve 覆盖更新该层 by/at，首次批准顺序保持；
  // 整体 status/by/at 语义不变（始终是最新一次 approve 的整图凭据）。
  layers?: GraphReviewLayer[];
}

// F08：单层分层批准凭据（level 为档位层标，如 L1/L2/...——档位路由是 skill 口径，
// 工具不强制格式，仅要求非空；零门禁红线：layers 仅记录，不加任何拒绝规则）
export interface GraphReviewLayer {
  level: string;
  by: string;
  at: string; // ISO 8601
}

// adr_0007（0.9.0）：雾区——"还没想清楚的区域"进 schema 为图级轻字段。
// 试跑结论（docs/fog-recon-trial-report.md 卡点 2/4）定生死：**单一真相源，
// 不做节点载体**（`_fog` 过不了 ID 规则；双载体必漂移）。点火不建边（卡点 1：
// fog→票 depends_on 死锁 ready 门禁）——research 票与雾的挂接走 ignited 字段承载。
export interface GraphFog {
  /** 雾区标识（非节点 id，不拼文件路径；如 "release-automation"） */
  id: string;
  /** 雾区描述：哪里模糊、为什么暂时不展开 */
  description: string;
  /** 毕业条件：怎样算想清楚了（F17 validate 提示与 Q3 毕业率观测的依据） */
  graduation: string;
  /** 已点火的 research 票节点 id（字段承载，非拓扑边，零门禁） */
  ignited?: string[];
}

// DEC-2 三级工作类路由（F03/F13 随 0.9.0 雾区机制进 schema，用户 2026-09-01 预批）：
// quick=单节点轻流程 | standard=全流程（缺省心智） | program=雾区渐进（F08 渐进审批仅对它生效）
export type GraphClass = "quick" | "standard" | "program";

export interface GraphSchema {
  id: string;
  version: string;
  label: string;
  entry: GraphEntry;
  exit: GraphExit;
  nodes: { file: string }[];
  edges: { file: string }[];
  root_context?: Record<string, unknown>;
  /** DEC-1：设计审核凭据（可选，缺省=未审核；写入走 approveGraph） */
  review?: GraphReview;
  /** adr_0007（0.9.0 F04）：雾区（可选，单雾起步；缺省不存在=零迁移零默认拒绝） */
  fog?: GraphFog;
  /** DEC-2：工作类标注（可选，缺省=未标注；init --class 预设，update_graph 可改） */
  class?: GraphClass;
}

// ── 目录常量（v0.5.2：图内相对——相对"图目录"而非工作区根；
// 图目录 = .graph/<名>/（多图）或 .graph/（旧布局原地=default）。归一化见 graph-dir.ts）──
export const GRAPH_DIR = ".graph"; // 工作区级：多图与工作区状态（active/workspace-events/.trash）的容器
export const NODES_DIR = "nodes";
export const EDGES_DIR = "edges";
export const INDEX_DIR = "index";
export const GRAPH_FILE = "graph.yaml";
