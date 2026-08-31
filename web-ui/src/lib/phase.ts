// web-ui/src/lib/phase.ts — 分期（开发顺序）段位派生的纯逻辑（0.8.1 分期图例）。
// 领域图/叠加视图按开发顺序四段区分节点：debug·0.7.0 修复 / 0.8.x / 0.9.x / 1.0.0。
// 数据源 = 节点 id 前缀段位（fix-v080 / g080 / il-* → 修复带；v081–v082 → 0.8.x；
// v09* → 0.9.x；v100 → 1.0.0），标签段位标签（如「[0.8.1] 」前缀）作兜底；
// 知识顶点（context/adr）横切不入带。不改图数据、不新增读接口。
import { isKnowledgeType, type NodeSchema } from "./types";

export type PhaseBandId = "debug" | "p08x" | "p09x" | "p100";

export interface PhaseBand {
  id: PhaseBandId;
  /** 图例短标签（开发顺序段位） */
  label: string;
  /** 配套分期索引域（context 顶点 id；图内存在时图例可跳转成员清单） */
  ctxId: string;
  /** 图例点色（暗星空已验色域内选取，避开七个状态色） */
  color: string;
}

/** 开发顺序四段（按序即开发顺序：修复带 → 0.8.x → 0.9.x → 1.0.0） */
export const PHASE_BANDS: readonly PhaseBand[] = [
  { id: "debug", label: "debug·0.7.0 修复", ctxId: "ctx-phase-debug", color: "#d47fa6" },
  { id: "p08x", label: "0.8.x", ctxId: "ctx-phase-08x", color: "#4db8c9" },
  { id: "p09x", label: "0.9.x", ctxId: "ctx-phase-09x", color: "#a8c95a" },
  { id: "p100", label: "1.0.0", ctxId: "ctx-phase-100", color: "#d4c25a" },
];

const BAND_BY_ID = new Map(PHASE_BANDS.map((b) => [b.id, b]));

/** 标签段位兜底：形如「[fix·0.7.0]」「[0.8.1]」「[0.9.4]」「[1.0.0]」的方括号版本前缀 */
function phaseFromLabel(label: string): PhaseBandId | null {
  const m = /\[\s*fix[·•]?\s*(\d+)\.(\d+)/.exec(label);
  if (m) return "debug";
  const v = /\[\s*(\d+)\.(\d+)(?:\.\d+)?\s*\]/.exec(label);
  if (v) {
    const major = Number(v[1]);
    const minor = Number(v[2]);
    if (major === 0 && minor <= 7) return "debug";
    if (major === 0 && minor <= 8) return "p08x";
    if (major === 0 && minor <= 9) return "p09x";
    if (major === 1) return "p100";
  }
  return null;
}

/**
 * 节点所属开发顺序段位；知识顶点与无法判段的节点返回 null（不入带）。
 * id 前缀规则优先（roadmap 图的实态：fix-v080、g080、il- 前缀，及 v08x/v09x/v100），
 * 标签「[x.y.z]」段位兜底（其他图无 id 约定时仍可区分）。
 */
export function phaseOfNode(n: Pick<NodeSchema, "id" | "type" | "label">): PhaseBandId | null {
  if (isKnowledgeType(n.type)) return null; // 横切知识顶点不入带
  const id = n.id.toLowerCase();
  if (id.startsWith("fix-") || id.startsWith("g080") || id.startsWith("il-")) return "debug";
  if (/^v08[1-9]/.test(id)) return "p08x";
  if (/^v09\d/.test(id)) return "p09x";
  if (/^v100/.test(id)) return "p100";
  return phaseFromLabel(n.label);
}

/** 段位元数据（图例渲染用）；未知段位返回 null */
export function bandOf(id: PhaseBandId): PhaseBand | null {
  return BAND_BY_ID.get(id) ?? null;
}

/**
 * 工作流节点按段位分组（图例成员清单数据源）。
 * 只有命中的段位出现在 Map 中；知识顶点与未判段节点不进任何组。
 */
export function phaseGroups(nodes: NodeSchema[]): Map<PhaseBandId, NodeSchema[]> {
  const groups = new Map<PhaseBandId, NodeSchema[]>();
  for (const n of nodes) {
    const band = phaseOfNode(n);
    if (!band) continue;
    const list = groups.get(band);
    if (list) list.push(n);
    else groups.set(band, [n]);
  }
  return groups;
}
