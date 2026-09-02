// src/core/domain.ts — v0.5 领域语义：map 派生 + 六条跨文件校验规则
// 知识顶点（context/adr）与工作流顶点同图共存，分镜（map）呈现：
// 归属由顶点类型派生（零新存储），校验规则做成纯函数供 CLI / MCP / Web UI 复用。
import {
  AdrStatus,
  EdgeType,
  NodeType,
  isKnowledgeType,
  type Checkpoint,
  type NodeSchema,
  type EdgeSchema,
} from "./types.js";

// ── map 派生 ──

export type MapKind = "workflow" | "domain";

/** 顶点所属 map：知识类型→domain，工作流类型→workflow（按类型派生，无新字段） */
export function nodeMapOf(node: Pick<NodeSchema, "type">): MapKind {
  return isKnowledgeType(node.type) ? "domain" : "workflow";
}

/** 从节点集派生两个 map 视图（图是真相源，map 是视图） */
export function deriveMaps(nodes: NodeSchema[]): Record<MapKind, NodeSchema[]> {
  const workflow: NodeSchema[] = [];
  const domain: NodeSchema[] = [];
  for (const n of nodes) (nodeMapOf(n) === "domain" ? domain : workflow).push(n);
  return { workflow, domain };
}

/**
 * 边可见性规则（Web UI map 过滤架构的核心约束）：
 * 一条边可见 ⇔ 它两端顶点所属的 map 都被激活。
 * decides 边连接 domain(adr) 与 workflow 节点 → 只在叠加视图出现（天然推导，无需特判）。
 */
export function edgeMapsOf(edge: EdgeSchema, byId: Map<string, NodeSchema>): MapKind[] {
  const kinds = new Set<MapKind>();
  const s = byId.get(edge.source);
  const t = byId.get(edge.target);
  if (s) kinds.add(nodeMapOf(s));
  if (t) kinds.add(nodeMapOf(t));
  return [...kinds];
}

// ── 六条领域校验规则 ──

export interface DomainIssue {
  level: "error" | "warning";
  message: string;
}

export function validateDomainRules(
  nodes: NodeSchema[],
  edges: EdgeSchema[],
): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isContext = (id: string) => byId.get(id)?.type === NodeType.Context;
  const isAdr = (id: string) => byId.get(id)?.type === NodeType.Adr;

  // 1. 悬空 context 引用 → error（context 已删/拼错，成员归属失焦，必须修）
  for (const n of nodes) {
    if (n.context !== undefined && !isContext(n.context)) {
      issues.push({
        level: "error",
        message: `节点 ${n.id} 的 context 引用不存在或不是 context 顶点: ${n.context}`,
      });
    }
  }

  // 2. 同一 context 内 glossary term 重复 → warning（跨 context 同名合法——DDD 本义，各说各话）
  for (const n of nodes) {
    if (n.type !== NodeType.Context || !n.glossary) continue;
    const seen = new Set<string>();
    for (const g of n.glossary) {
      if (seen.has(g.term)) {
        issues.push({
          level: "warning",
          message: `context ${n.id} 术语重复: "${g.term}"（同上下文内一词一义）`,
        });
      }
      seen.add(g.term);
    }
  }

  // 3. 跨 context 工作流边契约检查（IL-012 改造：契约按 context 对声明一次、边继承）。
  //    声明索引：context 顶点的 contracts[]（"对 to 的默认契约"）——跨 context 工作流边
  //    自动继承其 source 侧 context 对 target 侧 context 的声明（逻辑继承：只影响
  //    validate 判定，不改写边数据——存量图零迁移，逐边契约继续合法）。
  //    优先级：单边 contract > context 对声明（单边覆写仍可精确表达例外集成点）。
  //    警告条件从"边无 contract"收紧为"该 context 对无声明且边无 contract"。
  //    D3 修复（v0.5.1）：按集成点（source→target 对）分组判定——平行同向的标注边
  //    （如 fan_out 与 depends_on 并存）只要任一条声明了契约即视为集成点已声明，
  //    警告按集成点汇总一次（列全部未声明边 id），不再逐边重复告警。
  //    知识边 decides/relates 不适用此规则。
  const KNOWLEDGE_EDGE_TYPES = [EdgeType.Decides, EdgeType.Relates];
  const defaultDecls = new Map<string, Set<string>>(); // source 侧 context → 其声明过的 to 集合
  for (const n of nodes) {
    if (n.type !== NodeType.Context || !n.contracts) continue;
    let tos = defaultDecls.get(n.id);
    if (!tos) {
      tos = new Set<string>();
      defaultDecls.set(n.id, tos);
    }
    for (const d of n.contracts) tos.add(d.to);
  }
  const contractGroups = new Map<string, { ids: string[]; hasContract: boolean; from: string; to: string }>();
  for (const e of edges) {
    if (KNOWLEDGE_EDGE_TYPES.includes(e.type)) continue;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s?.context || !t?.context || s.context === t.context) continue;
    const key = `${e.source}->${e.target}`;
    const hasContract =
      e.contract !== undefined &&
      (e.contract.produces !== undefined ||
        (e.contract.consumed_by?.length ?? 0) > 0 ||
        e.contract.validation !== undefined);
    const group = contractGroups.get(key) ?? {
      ids: [],
      hasContract: false,
      from: s.context,
      to: t.context,
    };
    group.ids.push(e.id);
    group.hasContract = group.hasContract || hasContract;
    contractGroups.set(key, group);
  }
  for (const [key, g] of contractGroups) {
    // IL-012：source 侧 context 声明了对 target 侧的默认契约 → 集成点视为已声明（边继承）
    const declared = defaultDecls.get(g.from)?.has(g.to) ?? false;
    if (!g.hasContract && !declared) {
      issues.push({
        level: "warning",
        message: `集成点 ${key} 跨 context（${g.from} → ${g.to}）但该 context 对无默认契约声明（${g.from} 的 contracts 里无 to: ${g.to}），其所有边（${g.ids.join(", ")}）也未填 contract（契约边须声明 produces/consumed_by/validation，或由 context 对默认契约声明覆盖）`,
      });
    }
  }

  // 3b. 声明侧完整性（IL-012）：context 顶点 contracts[] 自身的跨文件校验——
  //     to 悬空（不存在/非 context 顶点）→ error（拼错会静默失效，继承永不命中）；
  //     同一 context 内 to 重复 → warning（生效取首条，与 glossary 重复同级的提示）
  for (const n of nodes) {
    if (n.type !== NodeType.Context || !n.contracts) continue;
    const seen = new Set<string>();
    for (const d of n.contracts) {
      if (!isContext(d.to)) {
        issues.push({
          level: "error",
          message: `context ${n.id} 的默认契约声明 to 引用不存在或不是 context 顶点: ${d.to}`,
        });
      }
      if (seen.has(d.to)) {
        issues.push({
          level: "warning",
          message: `context ${n.id} 对 ${d.to} 的默认契约声明重复（生效取首条）`,
        });
      }
      seen.add(d.to);
    }
  }

  // 4. relates 边任一端非 context 顶点 → error（relates 仅限 context↔context）
  for (const e of edges) {
    if (e.type !== EdgeType.Relates) continue;
    for (const end of [e.source, e.target]) {
      if (!isContext(end)) {
        issues.push({
          level: "error",
          message: `边 ${e.id} (relates) 端点 ${end} 不是 context 顶点（relates 仅限 context ↔ context）`,
        });
      }
    }
  }

  // 5. 孤儿 ADR → warning（无 decides 出边 = 决策没有挂接到它管辖的对象，传播链断裂）
  for (const n of nodes) {
    if (n.type !== NodeType.Adr) continue;
    const hasDecides = edges.some((e) => e.type === EdgeType.Decides && e.source === n.id);
    if (!hasDecides) {
      issues.push({
        level: "warning",
        message: `ADR ${n.id} 是孤儿（无 decides 出边）——决策未挂接到它管辖的节点/context，superseded 时无法传播`,
      });
    }
  }

  // 6. decides 边 source 非 adr 顶点 → error（只有 ADR 能"决定"）
  for (const e of edges) {
    if (e.type !== EdgeType.Decides) continue;
    if (!isAdr(e.source)) {
      issues.push({
        level: "error",
        message: `边 ${e.id} (decides) 的 source ${e.source} 不是 adr 顶点（decides 边必须由 ADR 发出）`,
      });
    }
  }

  return issues;
}

// ── 管辖 ADR（claim / get-node 注入的标题级指针；上下文经济红线：只给指针不给全文）──

export interface GoverningAdrRef {
  id: string;
  title: string;
}

export interface SupersededAdrRef extends GoverningAdrRef {
  superseded_by?: string;
}

export interface GoverningAdrsResult {
  /** 生效中（proposed/accepted）的管辖 ADR——claim 时必读 */
  current: GoverningAdrRef[];
  /** 已 superseded 的管辖 ADR——决策依据已过时，建议重审 */
  superseded: SupersededAdrRef[];
}

/**
 * 节点（含其所属 context）的管辖 ADR：decides 边指向该节点或其 context 的 ADR 顶点。
 * 纯函数（nodes/edges 输入），rootDir 包装在 node.ts（复用缓存索引）。
 */
export function governingAdrsFor(
  nodes: NodeSchema[],
  edges: EdgeSchema[],
  nodeId: string,
): GoverningAdrsResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return { current: [], superseded: [] };
  const targets = new Set<string>([nodeId]);
  if (node.context) targets.add(node.context);

  const current: GoverningAdrRef[] = [];
  const superseded: SupersededAdrRef[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.type !== EdgeType.Decides || !targets.has(e.target)) continue;
    if (seen.has(e.source)) continue;
    seen.add(e.source);
    const adr = byId.get(e.source);
    if (!adr || adr.type !== NodeType.Adr) continue;
    if (adr.status === AdrStatus.Superseded) {
      superseded.push({ id: adr.id, title: adr.label, superseded_by: adr.superseded_by });
    } else {
      current.push({ id: adr.id, title: adr.label });
    }
  }
  const byIdOrder = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  current.sort(byIdOrder);
  superseded.sort(byIdOrder);
  return { current, superseded };
}

/**
 * adr_flags 预计算（computeNextActions 用）：工作流节点 → "决策依据已过时" 警告列表。
 * 传播语义：superseded 的 ADR 经 decides 边把它管辖的节点（或整个 context 的成员）
 * 打上 ⚠️——这是一等顶点相对纯文件的核心差异化价值。
 */
export function adrFlagsFor(
  nodes: NodeSchema[],
  edges: EdgeSchema[],
): Map<string, string[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const supersededAdrs = nodes.filter(
    (n) => n.type === NodeType.Adr && n.status === AdrStatus.Superseded,
  );
  if (supersededAdrs.length === 0) return new Map();
  const supersededIds = new Set(supersededAdrs.map((n) => n.id));

  // context → 成员节点（decides 打在 context 上时传播给全体成员）
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
    if (e.type !== EdgeType.Decides || !supersededIds.has(e.source)) continue;
    const adr = byId.get(e.source);
    const msg =
      `ADR ${e.source}${adr?.label ? `（${adr.label}）` : ""}已 superseded` +
      `${adr?.superseded_by ? `（由 ${adr.superseded_by} 接替）` : ""}——决策依据已过时，建议重审`;
    const target = byId.get(e.target);
    if (target?.type === NodeType.Context) {
      for (const memberId of contextMembers.get(e.target) ?? []) flag(memberId, msg);
    } else {
      flag(e.target, msg);
    }
  }
  return flags;
}

// ── F06（0.9.1 渐进审批）：requires_human 派生标注 ──

/**
 * requires_human 判定（调度桶 / get-node 读面 / claim 提示包共用的单源纯函数）：
 * 节点存在 verifier:"human" 且未完成的 checkpoint → true。
 * 未完成口径 = status ∉ { passed, skipped }——failed 也是未完成（人工检查点
 * 失败仍等真人处理）；skipped 是裁决性豁免，视为人工义务解除。
 * 纯派生零存储：不落 schema 字段，读面按需条件透出（仅真值出现，条件缺省
 * 与 adr_flags / review_flag 同款）。
 */
export function requiresHuman(
  checkpoints: Pick<Checkpoint, "verifier" | "status">[] | undefined,
): boolean {
  return (checkpoints ?? []).some(
    (c) => c.verifier === "human" && c.status !== "passed" && c.status !== "skipped",
  );
}
