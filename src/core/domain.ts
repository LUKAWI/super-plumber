// src/core/domain.ts — v0.5 领域语义：map 派生 + 六条跨文件校验规则
// 知识顶点（context/adr）与工作流顶点同图共存，分镜（map）呈现：
// 归属由顶点类型派生（零新存储），校验规则做成纯函数供 CLI / MCP / Web UI 复用。
import {
  EdgeType,
  NodeType,
  isKnowledgeType,
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

  // 3. 跨 context 工作流边未填 contract → warning（激活休眠 contract 字段：两个上下文间的
  //    依赖必须声明"产出什么、谁消费、怎么验收"；知识边 decides/relates 不适用此规则）
  const KNOWLEDGE_EDGE_TYPES = [EdgeType.Decides, EdgeType.Relates];
  for (const e of edges) {
    if (KNOWLEDGE_EDGE_TYPES.includes(e.type)) continue;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s?.context || !t?.context || s.context === t.context) continue;
    const hasContract =
      e.contract !== undefined &&
      (e.contract.produces !== undefined ||
        (e.contract.consumed_by?.length ?? 0) > 0 ||
        e.contract.validation !== undefined);
    if (!hasContract) {
      issues.push({
        level: "warning",
        message: `边 ${e.id} (${e.type}) 跨 context（${s.context} → ${t.context}）但未填 contract（契约边须声明 produces/consumed_by/validation）`,
      });
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
