// src/core/scheduler.ts — 调度决策与旗标装配（arch-c2 自 index-service.ts 分家落位）
//
// 职责边界（与 index-service.ts 分工）：
//   - index-service.ts：索引缓存基础设施（两级缓存 + 新鲜度校验 + 写路径失效）；
//   - 本文件：next 五桶调度策略（computeNextActions）、旗标装配面（review/fog/
//     class 提示——DEC-1 / F04 / v091-class-command）与认领提示包
//     （buildClaimNudgePackage，arch-c3a 落位）。
// 分家为纯移动：调度语义、文案、桶排序均不变；唯二增量 = ①可注入时钟
// （computeNextActions 的 stale 判定，缺省系统时间）；②依赖方向改为
// scheduler → index-service（取缓存索引），index-service 不再反向依赖本文件。
//
// 为什么与索引缓存分开：index-service 的热点是"读得快"（文件 I/O 缓存），
// 本文件的热点是"决策得对"（桶归置/旗标/文案装配）。两者变更节奏不同——
// 调度策略迭代频繁（DEC-1/F04/v091 连续加旗标），缓存设施要求稳。

import {
  type NodeSchema,
  type GraphFog,
  NodeStatus,
  isKnowledgeType,
} from "./types.js";
import { readGraph } from "./parser.js";
import {
  adrFlagsFor,
  governingAdrsFor,
  requiresHuman,
  type GoverningAdrsResult,
} from "./domain.js";
import { fogClassNudge, fogGraduationNudge } from "./fog.js";
import { readEvents } from "./eventlog.js";
import { buildGraphIndex } from "./index-service.js";

// DEC-1（g080-approve-core）：review_flag 注入面（core 侧）。
// 图级判定一次：图无 review 凭据 → ready_eligible 条目附 review_flag（≤10 token，
// 风格对齐 adr_flags——只提示不拦截）。红线：review 仅记录、零门禁，核心状态机
// 不因此新增任何拒绝规则。文案已定稿（v082-tooling，设计文档 §4-4 收口）。
export const REVIEW_FLAG_UNREVIEWED =
  "设计审核凭据缺失或已失效——仅提示，可照常认领";

/** 图级 review_flag 判定（一次读 graph.yaml，不进索引缓存）：
 * 无 review 字段或 status=unreviewed → 注入定稿文案；有凭据 → undefined（不注入）。
 * F21（DEC-7）：结构修订把 review 回置为 status=unreviewed（只写凭据字段）——
 * 该状态同样视为未审核，nudge 重新亮起走增量人审。
 * 图未初始化/不可读同样视为未审核（提示不阻塞调度）。 */
export function reviewFlagFor(rootDir: string): string | undefined {
  try {
    const review = readGraph(rootDir).review;
    return review === undefined || review.status === "unreviewed"
      ? REVIEW_FLAG_UNREVIEWED
      : undefined;
  } catch {
    return REVIEW_FLAG_UNREVIEWED;
  }
}

// F04（adr_0007，0.9.0）：雾区概要读面（调度结果透出用）。
// 与 reviewFlagFor 同款：一次读 graph.yaml、不进索引缓存，图不可读 → undefined。
export function fogSummaryFor(rootDir: string): GraphFog | undefined {
  try {
    return readGraph(rootDir).fog;
  } catch {
    return undefined;
  }
}

// v091-class-command（adr_0016）：雾/档矛盾 nudge 读面（与 fogSummaryFor 同款：
// 一次读 graph.yaml、不进索引缓存，图不可读 → undefined）。派生函数单源在
// core/fog.ts（fogClassNudge）；next 是热路径，先图级条件短路、命中才读事件日志。
// 循环依赖说明：scheduler → fog → parser 与既有 index-service ↔ parser 环同构，
// 两侧都只在函数体内调用对方导出，ESM 函数声明提升下安全。
export function classNudgeFor(rootDir: string): string | undefined {
  try {
    const graph = readGraph(rootDir);
    if (
      graph.fog === undefined ||
      graph.class === undefined ||
      graph.class === "program"
    ) {
      return undefined;
    }
    return fogClassNudge(graph, readEvents(rootDir, { kind: "class_changed" }));
  } catch {
    return undefined;
  }
}

// ── 认领提示包（arch-c3a：core 单源组装，渠道只渲染、不改写/增删/省略）──
// 此前 governing_adrs 在 MCP server.ts 认领响应里现场组装、CLI update-status 另有
// 一份手写 ⚠️ 变体（"决策依据已过时: id（由 x 接替）"）——收敛到本文件：
// governing_adrs 取 governingAdrsFor（缓存索引）、adr_flags 取 adrFlagsFor
// （与调度面 ready/ready_eligible/running 各桶同函数派生，⚠️ 文案天然单源）、
// review_flag 取上方 reviewFlagFor（DEC-1 定稿文案）。渠道侧零手写文案。

/** 认领（ready→running）响应的提示包。各字段条件缺省：无话可说即不出现，
 * 消费方按渠道形状渲染，不得改写/增删渠道已渲染字段的内容。 */
export interface ClaimNudgePackage {
  /** 管辖 ADR 标题级指针（current=claim 后必读；superseded=决策依据已过时）。
   * 无任何管辖 ADR → 缺省 */
  governing_adrs?: GoverningAdrsResult;
  /** superseded 管辖 ADR 的 adr_flags 提示行（与调度面 adr_flags 逐字同源）。
   * 无 → 缺省 */
  adr_flags?: string[];
  /** 图无 review 凭据时的定稿文案（DEC-1 仅提示零门禁）。有凭据 → 缺省 */
  review_flag?: string;
  /** F06（0.9.1 渐进审批）预留槽位接线：节点存在未完成的 human checkpoint
   * （requires_human 派生，core/domain.ts 单源）→ true。缺省 = 无人工介入需求 */
  requires_human?: boolean;
}

/**
 * 认领提示包组装（core 单源，CLI / MCP 共用；渠道只渲染）。
 * 复用缓存索引：governingAdrsFor（管辖 ADR 指针）+ adrFlagsFor（superseded ⚠️ 提示，
 * 与 computeNextActions 各桶同一派生函数）+ reviewFlagFor（图级 review 判定）。
 */
export function buildClaimNudgePackage(
  rootDir: string,
  nodeId: string,
): ClaimNudgePackage {
  const index = buildGraphIndex(rootDir, { useCache: true });
  const gov = governingAdrsFor(index.nodes, index.edges, nodeId);
  const pkg: ClaimNudgePackage = {};
  if (gov.current.length > 0 || gov.superseded.length > 0) {
    pkg.governing_adrs = gov;
  }
  const flags = adrFlagsFor(index.nodes, index.edges).get(nodeId);
  if (flags !== undefined) pkg.adr_flags = flags;
  const rf = reviewFlagFor(rootDir);
  if (rf !== undefined) pkg.review_flag = rf;
  // F06（0.9.1）：requires_human 槽位接线（arch-c3a 埋点）——认领前告知
  // 「此票含未完成的真人 checkpoint」（渐进审批：agent 不得代真人签核）。
  const target = index.nodes.find((n) => n.id === nodeId);
  if (target !== undefined && requiresHuman(target.checkpoints)) {
    pkg.requires_human = true;
  }
  return pkg;
}

export interface NextActionsResult {
  /** 可认领节点（状态 ready），按 priority 升序 → level → id 排序。
   * F06/F07：含未完成 human checkpoint 的条目带 requires_human: true；
   * 无人认领的此类条目再带 waiting_human: true（「等真人」，agent 勿认领）。
   * 两者均条件缺省（仅真值出现） */
  ready: {
    id: string;
    label: string;
    priority?: number;
    adr_flags?: string[];
    requires_human?: boolean;
    waiting_human?: boolean;
  }[];
  /** 门禁已满足、可转 ready 的 pending/failed 节点（冷启动与重试入口），同上排序。
   * DEC-1：图无 review 凭据时条目附 review_flag（仅提示、零门禁；只在
   * ready_eligible 注入，ready 桶不注入）。requires_human / waiting_human 同 ready 桶 */
  ready_eligible: {
    id: string;
    label: string;
    priority?: number;
    adr_flags?: string[];
    review_flag?: string;
    requires_human?: boolean;
    waiting_human?: boolean;
  }[];
  /** pending/failed 且门控前驱未齐的节点 */
  blocked: {
    id: string;
    label: string;
    unmet: { id: string; status: string }[];
  }[];
  /** 执行中节点（含认领者与已运行时长）。F06：含未完成 human checkpoint
   * 的条目带 requires_human: true（条件缺省） */
  running: {
    id: string;
    label: string;
    assigned_to?: string;
    started_at?: string;
    elapsed_ms: number | null;
    adr_flags?: string[];
    requires_human?: boolean;
  }[];
  /** 超过 stale 阈值无更新的"疑似卡住"节点（F07：基线默认 30 分钟；
   * requires_human 节点默认放大 8 倍 = 4 小时；显式 --stale-ms / stale_ms
   * 对全部节点生效） */
  stale_running: { id: string; label: string; elapsed_ms: number }[];
  /** F04（adr_0007）：雾区概要（图无雾时缺省；读面透出，零门禁） */
  fog?: GraphFog;
  /** v091-class-command（adr_0016）：雾/档矛盾 nudge（core/fog.ts 单源派生文案；
   * 条件不命中或用户直发凭据 --by user 后缺省，零门禁） */
  class_nudge?: string;
  /** IL-025：雾可毕业 nudge——已点火研究票全部 passed 时提示毕业留痕
   * （core/fog.ts 单源派生文案，含 fog id 与 graduate-fog 命令建议；零门禁，
   * 条件不命中或毕业后缺省） */
  fog_graduation_nudge?: string;
  /** 工作流顶点状态分布（知识顶点不参与——"全部 task 节点 passed 即完成"排除它们） */
  summary: Record<NodeStatus, number> & { total: number };
}

/**
 * 调度决策（O(N+M)，基于缓存索引）：
 * ready / ready_eligible / blocked / running / stale_running 一屏返回。
 *
 * arch-c2：时钟可注入（opts.clock，缺省系统时间）——stale 判定（elapsed_ms 与
 * staleMs 比较）不再绑死 Date.now()，测试用同一份 YAML 配两个时钟读数即可
 * 覆盖"新鲜 / 疑似卡住"两态，无需改写节点文件时间戳。
 *
 * F06/F07（0.9.1）：requires_human 派生标注接入桶条目（ready/ready_eligible/
 * running），ready/ready_eligible 对无人认领的此类条目再打 waiting_human
 * 「等真人」标记；human 类 stale 阈值默认放大（见 BASE_STALE_MS /
 * HUMAN_STALE_MULTIPLIER），显式 staleMs 传值优先生效。
 */

// F07（0.9.1）：human 类 stale 阈值单源——基线 30 分钟（agent 心跳尺度）×
// HUMAN_STALE_MULTIPLIER（默认 8）= 4 小时（真人节奏尺度：真人 checkpoint
// 等签核/等认领以小时计，30 分钟判真人"卡住"必然误报；4 小时覆盖工作时段内
// 的人工周转，又不至于把死任务藏一整天）。倍数可经 opts.humanStaleMultiplier
// 覆盖；显式 staleMs（--stale-ms / stale_ms）是用户对全部节点的明确裁决，
// 优先生效、不再放大。
export const BASE_STALE_MS = 30 * 60 * 1000;
export const HUMAN_STALE_MULTIPLIER = 8;

export function computeNextActions(
  rootDir: string,
  opts: {
    staleMs?: number;
    /** F07：requires_human 节点的 stale 阈值放大倍数（≥1；仅 staleMs 缺省时生效） */
    humanStaleMultiplier?: number;
    clock?: () => number;
  } = {},
): NextActionsResult {
  const staleMs = opts.staleMs ?? BASE_STALE_MS;
  const humanStaleMs =
    opts.staleMs !== undefined
      ? staleMs
      : staleMs * (opts.humanStaleMultiplier ?? HUMAN_STALE_MULTIPLIER);
  const now = opts.clock ? opts.clock() : Date.now();
  const index = buildGraphIndex(rootDir, { useCache: true });
  const { nodes, edges, gateReverseAdj } = index;
  const statusOf = new Map(nodes.map((n) => [n.id, n.status]));
  // v0.5：知识顶点（context/adr）调度豁免——永不进任何调度桶，也不计入完成判定。
  // adr_flags：superseded 的 ADR 沿 decides 边把"决策依据已过时"传播到工作流条目。
  const workflowNodes = nodes.filter((n) => !isKnowledgeType(n.type));
  const adrFlags = adrFlagsFor(nodes, edges);
  // DEC-1：review_flag 图级判定一次——无 review 凭据的图，ready_eligible 条目统一注入
  const reviewFlag = reviewFlagFor(rootDir);

  const summary = {
    total: workflowNodes.length,
    pending: 0,
    ready: 0,
    running: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
  } as NextActionsResult["summary"];
  for (const n of workflowNodes) {
    summary[n.status as NodeStatus] = (summary[n.status as NodeStatus] ?? 0) + 1;
  }

  const ready: NextActionsResult["ready"] = [];
  const readyEligible: NextActionsResult["ready_eligible"] = [];
  const blocked: NextActionsResult["blocked"] = [];
  const running: NextActionsResult["running"] = [];
  const staleRunning: NextActionsResult["stale_running"] = [];

  for (const n of workflowNodes) {
    if (n.status === NodeStatus.Ready) {
      // F06/F07：未完成 human checkpoint 的可认领票标注 requires_human；
      // 无人认领的此类票再打「等真人」标记（agent 勿认领，等真人接手）
      const human = requiresHuman(n.checkpoints);
      ready.push({
        ...schedEntry(n),
        ...(adrFlags.get(n.id) ? { adr_flags: adrFlags.get(n.id) } : {}),
        ...(human ? { requires_human: true } : {}),
        ...(human && n.assigned_to === undefined ? { waiting_human: true } : {}),
      });
      continue;
    }
    if (n.status === NodeStatus.Running) {
      const started = n.execution_report?.started_at;
      // FIX-F2：stale 判据 = 最后活动时间 max(updated_at, started_at)。
      // checkpoint / execution_report 上报都会刷新 updated_at——"上报即心跳"，
      // 持续工作的长任务不再因 started_at 陈旧被误报疑似卡住。
      const lastActivity = Math.max(
        Date.parse(n.updated_at ?? "") || 0,
        started ? Date.parse(started) || 0 : 0,
      );
      const elapsed_ms = lastActivity > 0 ? now - lastActivity : null;
      // F06：human checkpoint 未完成的执行中节点带 requires_human 读面标记
      const human = requiresHuman(n.checkpoints);
      running.push({
        id: n.id,
        label: n.label,
        assigned_to: n.assigned_to,
        started_at: started,
        elapsed_ms,
        ...(adrFlags.get(n.id) ? { adr_flags: adrFlags.get(n.id) } : {}),
        ...(human ? { requires_human: true } : {}),
      });
      // F07：human 类 stale 阈值放宽（默认基线 × 8；显式 staleMs 对全部节点一致）
      if (
        elapsed_ms !== null &&
        !Number.isNaN(elapsed_ms) &&
        elapsed_ms > (human ? humanStaleMs : staleMs)
      ) {
        staleRunning.push({ id: n.id, label: n.label, elapsed_ms });
      }
      continue;
    }
    if (n.status === NodeStatus.Pending || n.status === NodeStatus.Failed) {
      // 门控前驱检查：只查该节点的门控入边（gateReverseAdj），不再全量扫边
      const unmet: { id: string; status: string }[] = [];
      for (const src of gateReverseAdj.get(n.id) ?? []) {
        const s = statusOf.get(src);
        if (s !== NodeStatus.Passed) {
          unmet.push({ id: src, status: s ?? "missing" });
        }
      }
      if (unmet.length > 0) {
        blocked.push({ id: n.id, label: n.label, unmet });
      } else {
        // F06/F07：requires_human / waiting_human 标注与 ready 桶同款
        const human = requiresHuman(n.checkpoints);
        readyEligible.push({
          ...schedEntry(n),
          ...(adrFlags.get(n.id) ? { adr_flags: adrFlags.get(n.id) } : {}),
          ...(reviewFlag !== undefined ? { review_flag: reviewFlag } : {}),
          ...(human ? { requires_human: true } : {}),
          ...(human && n.assigned_to === undefined ? { waiting_human: true } : {}),
        });
      }
    }
  }

  // FIX-F1：可认领桶按调度优先级排序（priority 升序，缺省最低；level、id 决胜），
  // agent 面对几十个 ready 节点时不再只能按 readdir 字典序盲选
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));
  const bySched = (
    a: { id: string },
    b: { id: string },
  ): number => {
    const na = nodeOf.get(a.id)!;
    const nb = nodeOf.get(b.id)!;
    return (
      (na.priority ?? Number.MAX_SAFE_INTEGER) -
        (nb.priority ?? Number.MAX_SAFE_INTEGER) ||
      na.level - nb.level ||
      na.id.localeCompare(nb.id)
    );
  };
  ready.sort(bySched);
  readyEligible.sort(bySched);

  // F04：雾区概要随调度结果透出（与 review_flag 同源读法，零门禁）
  const fog = fogSummaryFor(rootDir);
  // v091：雾/档矛盾 nudge 随调度结果透出（core/fog.ts 单源派生，零门禁）
  const classNudge = classNudgeFor(rootDir);
  // IL-025：雾可毕业 nudge——已点火研究票全部 passed 时提示毕业留痕（零门禁）。
  // 复用本函数已取的缓存索引装配状态视图，不额外读盘；无雾短路。
  const graduationNudge =
    fog !== undefined
      ? fogGraduationNudge(
          fog,
          new Map(nodes.map((n) => [n.id, n.status as string])),
        )
      : undefined;

  return {
    ready,
    ready_eligible: readyEligible,
    blocked,
    running,
    stale_running: staleRunning,
    ...(fog !== undefined ? { fog } : {}),
    ...(classNudge !== undefined ? { class_nudge: classNudge } : {}),
    ...(graduationNudge !== undefined ? { fog_graduation_nudge: graduationNudge } : {}),
    summary,
  };
}

function schedEntry(n: NodeSchema): { id: string; label: string; priority?: number } {
  return {
    id: n.id,
    label: n.label,
    ...(n.priority !== undefined ? { priority: n.priority } : {}),
  };
}
