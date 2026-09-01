// src/core/fog.ts
// adr_0007（0.9.0 F17）：雾区 validate 提示——只提示不阻止（DEC-3/DEC-1 红线：
// 零新拒绝规则，不参与退出码）。CLI validate 与 MCP graph_validate 双通道引用
// 同一实现，保证提示文案与触发条件一致（同 planAmendNudge 的单源先例）。
import { isKnowledgeType, type GraphSchema, type NodeSchema } from "./types.js";

/** 雾区提示（F17）：图有未毕业雾区 → 一条 warning，执行期照常推进。
 * 零工作流节点时不重复提示——"图中没有节点"已在案，雾挂在空图上无执行语义。 */
export function fogWarnings(
  graph: Pick<GraphSchema, "fog">,
  nodes: Pick<NodeSchema, "type">[],
): string[] {
  const fog = graph.fog;
  if (fog === undefined) return [];
  if (!nodes.some((n) => !isKnowledgeType(n.type))) return [];
  return [
    `图中有未毕业雾区 ${fog.id}（毕业条件：${fog.graduation}）——雾区表示尚未想清楚的领域，执行期照常推进；想清楚后用 graduate-fog 毕业留痕`,
  ];
}
