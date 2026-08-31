// web-ui/src/lib/frontier.ts — 前沿（frontier）视图的纯逻辑，与后端调度面
// （index-service.ts 的 ready / ready_eligible 两桶）同语义的前端派生：
// ready = 已转 ready 状态的节点；ready_eligible = pending 且全部门控前驱 passed。
// 数据只来自既有 GraphIndex（nodes + edges），不新增任何读接口。
// 术语锚点：ctx-webui 术语表「前沿（frontier）」——两桶的合并呈现档，
// 不是新调度桶，只是呈现层合并。
import { isKnowledgeType, type EdgeType, type GraphIndex, type NodeSchema } from "./types";

/** 门控入边类型（与后端核心 ready 门禁一致：手册 §5 规则 1 的四种） */
export const GATING_EDGE_TYPES: readonly EdgeType[] = [
  "depends_on",
  "validates",
  "fan_in",
  "fan_out",
];

function isGating(type: EdgeType): boolean {
  return GATING_EDGE_TYPES.includes(type);
}

/**
 * 前沿节点集（ready + ready_eligible 合并）：
 * - ready → 入前沿；
 * - pending 且全部门控前驱 passed → 入前沿（无门控入边 = 空门禁自然满足）；
 * - 其余状态与知识顶点（context/adr，不进调度桶）→ 不入。
 * 门控前驱在节点表中缺失或未 passed → 该 pending 节点不入（保守，与后端门禁一致）。
 * 返回按调度建议排序：priority 升序（越小越先，缺省最后），同优先级按 id。
 */
export function frontierNodes(g: Pick<GraphIndex, "nodes" | "edges">): NodeSchema[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  // 门控入边扫描：target 的任一门控前驱非 passed → target 不满足门禁
  const gated = new Set<string>();
  const gateBlocked = new Set<string>();
  for (const e of g.edges) {
    if (!isGating(e.type)) continue;
    gated.add(e.target);
    const src = byId.get(e.source);
    if (!src || src.status !== "passed") gateBlocked.add(e.target);
  }
  const out: NodeSchema[] = [];
  for (const n of g.nodes) {
    if (isKnowledgeType(n.type)) continue;
    if (n.status === "ready") {
      out.push(n);
    } else if (n.status === "pending" && !gateBlocked.has(n.id)) {
      out.push(n);
    }
  }
  return out.sort((a, b) => {
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    return pa !== pb ? pa - pb : a.id.localeCompare(b.id);
  });
}

/** 前沿 id 集（画布过滤用）：Set 语义，O(1) 命中查询 */
export function frontierIds(g: Pick<GraphIndex, "nodes" | "edges">): Set<string> {
  return new Set(frontierNodes(g).map((n) => n.id));
}
