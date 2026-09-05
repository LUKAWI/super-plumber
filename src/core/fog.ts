// src/core/fog.ts
// adr_0007（0.9.0）：雾区的单一家——读（graph.fog）/ 警告（fogWarnings，F17）/
// 毕业（graduateFog，F05）收敛在本文件，雾区语义一处可读。
// 红线（adr_0007 / DEC-3 / DEC-1）：只提示不阻止，零新拒绝规则，不参与退出码。
// CLI 与 MCP 双通道引用同一实现，保证提示文案与触发条件一致（同 planAmendNudge 的单源先例）。
// 循环依赖说明：parser → fog（graduateFog 的兼容 re-export）已降为单向——
// fog 的写读原语（readGraph/withGraphLock/writeGraphCore）改道 graph-io
// （arch-c4b 解环），不再 import parser。
import { isKnowledgeType, NodeStatus, type GraphSchema, type GraphFog, type NodeSchema } from "./types.js";
import { readGraph, withGraphLock, writeGraphCore } from "./graph-io.js";
import { withGraphAmend } from "./amend.js";
import { appendEvent, readEvents, type GraphEvent } from "./eventlog.js";

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

// ── v091-class-command（adr_0016）：雾/档矛盾 nudge（零门禁）──
// 缺口：agent 判档无凭据血统，雾/档矛盾提示无法区分"用户明知故选"与"agent 误判"。
// 派生函数与 fogWarnings 同址（雾区语义一处可读），core/validate.ts 警告编排与
// core/index-service.ts 的 next 装配共同消费——CLI/MCP 渲染层不新写文案。
// 条件：图有未毕业 fog 且 class 存在且 class !== "program" 且
// （无 class_changed 事件 或 最近一次 class_changed.by !== "user"）——
// 该条件仅选出待核对的图；fog 存在不证明关键未知阻止可信交付计划，语义判定由 skill 完成。
// 用户直发凭据（/plumber-class 或对话批准，--by user）后此提示自然静默。
// 红线同 fogWarnings：只提示不阻止，零新拒绝规则，不参与退出码。
export function fogClassNudge(
  graph: Pick<GraphSchema, "fog" | "class">,
  classChangedEvents: Pick<GraphEvent, "by">[],
): string | undefined {
  const fog = graph.fog;
  const cls = graph.class;
  if (fog === undefined || cls === undefined || cls === "program") return undefined;
  const last = classChangedEvents[classChangedEvents.length - 1];
  if (last !== undefined && last.by === "user") return undefined;
  return [
    `图中有未毕业雾区 ${fog.id}（毕业条件：${fog.graduation}），当前档位 ${cls}`,
    `——请核对关键未知是否阻止形成可信交付计划；若是，建议经用户批准后 graph update-graph --class program；若仅为节点内可解决的问题，沿用当前档位；跨会话或跨图不单独触发 program`,
    `（用户直发凭据 /plumber-class 或对话批准 --by user 后此提示静默；依据 adr_0007 雾区与 DEC-2 档位，仅提示不阻止）`,
  ].join("");
}

// ── IL-025：毕业证据核对 nudge（零门禁）──
// 缺口：雾毕业（F05）靠人记得——已点火研究票全部 passed（仅表示可开始核对证据）
// 时无人提醒，雾区滞留。派生函数与 fogClassNudge 同址（雾区语义一处可读），
// core/validate.ts 警告编排与 core/scheduler.ts 的 next 装配共同消费——
// CLI/MCP 渲染层不新写文案。
// 条件：图有未毕业 fog 且 fog.ignited 非空且列票全部 passed。ignited 缺省/空
// （无点火证据）或任一票在状态视图缺失/未 passed 一律不提示（宁缺勿滥，不催毕业）。
// 红线同 fogWarnings/fogClassNudge：只提示不阻止，零新拒绝规则，不参与退出码。
export function fogGraduationNudge(
  fog: Pick<GraphFog, "id" | "graduation" | "ignited">,
  statusOf: Map<string, string>,
): string | undefined {
  if (fog.ignited === undefined || fog.ignited.length === 0) return undefined;
  const allPassed = fog.ignited.every((id) => statusOf.get(id) === NodeStatus.Passed);
  if (!allPassed) return undefined;
  return [
    `雾区 ${fog.id} 的已点火研究票已全部 passed（毕业条件：${fog.graduation}）——请核对实际证据是否满足毕业条件`,
    `：满足后执行 graph graduate-fog 毕业留痕；研究票全部 passed 不等于未知已解决，转 standard 还须可信交付计划成立并经增量人审（自动快照 + fog_graduated 事件；依据 IL-025，仅提示不阻止）`,
  ].join("");
}

// ── F05（adr_0007，0.9.0）：雾区毕业 ──
// 毕业 = 清除图级 fog 字段 + fog_graduated 专用审计事件（试跑报告卡点 3：毕业
// 落进通用 node_deleted 无法与删错节点区分）。毕业动作属结构修订，复用 DEC-7
// amend 机制（自动快照 + graph_amended 事件 + review 回置），红线同源：守卫
// 失败不阻断毕业本身。幂等性：无雾时毕业报错（毕业是事实陈述，不是清理操作）。
export interface GraduateFogParams {
  /** 毕业产物节点 id 列表（雾想清楚后落成的票/决议，进事件 payload 可追溯） */
  produced?: string[];
  /** 毕业理由/结论摘要（进事件 payload；理由是凭据不是条件，缺省不写） */
  reason?: string;
}

export function graduateFog(
  rootDir: string,
  params: GraduateFogParams = {},
  opts: { actor?: string } = {},
): { fog: GraphFog; graph: GraphSchema } {
  const initial = readGraph(rootDir);
  const fog = initial.fog;
  if (fog === undefined) {
    throw new Error("图中没有雾区（graph.yaml 无 fog 字段），无雾可毕业");
  }
  const actor = opts.actor ?? "unknown";
  // 结构修订守卫（C5 组合器收拢 begin→写→complete）：begin 与 complete 都必须
  // 在不持图锁处执行——锁序恒为 实体锁→图锁且图锁不可重入，本函数不能持图锁
  // 跨越 complete()（其内 resetGraphReview 要取图锁；deleteNode 先例=持实体锁
  // 不持图锁）。组合器的 fn 恰好框住"图锁段 + 事件"，begin/complete 落在锁外。
  return withGraphAmend(
    rootDir,
    {
      action: "graduate-fog",
      target: fog.id,
      actor,
      detail: params.reason ? `reason="${params.reason}"` : undefined,
    },
    () => {
      // 清除 fog：持图锁读-改-写（与并发 updateGraph 互斥）；锁外快照已落
      withGraphLock(rootDir, () => {
        const graph = readGraph(rootDir);
        delete graph.fog;
        writeGraphCore(rootDir, graph);
      });
      const detailParts = [
        `fog=${fog.id}`,
        ...(params.produced && params.produced.length > 0
          ? [`produced=${params.produced.join(",")}`]
          : []),
        ...(params.reason ? [`reason="${params.reason}"`] : []),
      ];
      appendEvent(rootDir, {
        actor,
        kind: "fog_graduated",
        detail: detailParts.join("; "),
      });
      // 守卫收尾（graph_amended 事件 + review 回置）由组合器在 fn 成功后于
      // 图锁外执行——红线：回置失败不阻断毕业（complete 内部已吞错留痕）
      // 返回毕业后的最新图（review 回置结果可被调用方直接观察，供提示文案判定）
      return { fog, graph: readGraph(rootDir) };
    },
  );
}
