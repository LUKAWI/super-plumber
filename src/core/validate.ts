// src/core/validate.ts — arch-c3b：validate 编排单源
// 此前 CLI validate（src/cli/validate.ts）与 MCP graph_validate（src/mcp/server.ts）
// 各自持有同构编排与警告文案，已发生漂移（graph.yaml 引用列表反向漂移警告两侧措辞不一）。
// 现编排步骤（graph.yaml 骨架 → 节点/边逐文件 schema → 幽灵端点 → 领域规则 → 文案 lint
// → 拓扑/环（含 fan 门控隐藏环）→ 引用列表双向漂移）与全部警告文案正文住这里；
// 渠道只做呈现：CLI 渲染进度行与退出码，MCP 渲染五字段 JSON（ok 语义 = errors 为空）。
import { readGraph } from "./parser.js";
import { topologicalSort, detectCycles, detectHiddenCycles } from "./graph.js";
import { validateDomainRules } from "./domain.js";
import { lintNodeWording } from "./style-lint.js";
import { fogWarnings, fogClassNudge, fogGraduationNudge } from "./fog.js";
import { readEvents } from "./eventlog.js";
import { aggregateCheckpointStatus } from "./state-machine.js";
import {
  loadNodeFile,
  loadEdgeFile,
  listNodeFileNames,
  listEdgeFileNames,
  SchemaValidationError,
} from "./schema.js";
import type { NodeSchema, EdgeSchema, GraphSchema } from "./types.js";

/** checkpoint 聚合摘要（CLI 进度行渲染用；MCP 主体只取五字段，不外发） */
export interface CheckpointSummary {
  node_id: string;
  aggregate: string;
  count: number;
}

/**
 * 提前终止的阶段：编排在该步失败、后续步骤未执行（null = 全流程走完）。
 * 供渠道呈现判断哪些进度行不该出现（如 nodes/ 目录损坏时不渲染"✅ 节点: 0 个"假成功行）。
 */
export type ValidateFatalStage = "graph" | "nodes" | "edges" | null;

export interface GraphValidateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  node_count: number;
  edge_count: number;
  /** 以下为呈现辅助字段：五字段主体是 CLI/MCP 双渠道契约，渠道按需取用 */
  fatal_stage: ValidateFatalStage;
  topo_ok: boolean;
  cycles_found: boolean;
  checkpoint_summaries: CheckpointSummary[];
}

function result(
  errors: string[],
  warnings: string[],
  node_count: number,
  edge_count: number,
  fatal_stage: ValidateFatalStage,
  topo_ok: boolean,
  cycles_found: boolean,
  checkpoint_summaries: CheckpointSummary[],
): GraphValidateResult {
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    node_count,
    edge_count,
    fatal_stage,
    topo_ok,
    cycles_found,
    checkpoint_summaries,
  };
}

/**
 * 校验整个拓扑图的结构完整性（CLI validate 与 MCP graph_validate 的唯一编排入口）。
 * 单文件损坏不中断其余文件；结构性问题进 errors（ok=false），提示性信息进 warnings
 * （雾区/运行时边/文案 lint/引用漂移等恒为 warning，不参与退出码与 ok 判定）。
 */
export function validateGraphDir(rootDir: string): GraphValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. 检查图根文件 + 入口/出口骨架
  let graph: GraphSchema;
  try {
    graph = readGraph(rootDir);
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      errors.push("无法读取 graph.yaml，图未初始化");
    } else if (e instanceof SchemaValidationError) {
      errors.push(`${e.file}: ${e.message}`);
    } else {
      errors.push(`无法读取 graph.yaml: ${e.message}`);
    }
    return result(errors, warnings, 0, 0, "graph", false, false, []);
  }
  if (!graph.entry.description) {
    warnings.push("图入口(entry)描述为空");
  }
  // D1 修复（v0.5.1）：拆分出口检查——原 `!exit.description || criteria 为空` 的或逻辑
  // 会在"description 空但验收标准实有"时误报"验收标准为空"；两个关注点各自警告
  if (!graph.exit.description) {
    warnings.push("图出口(exit)描述为空");
  }
  if (graph.exit.acceptance_criteria.length === 0) {
    warnings.push("图出口(exit)验收标准为空");
  }

  // 2. 检查节点（逐文件读取 + schema 校验，单文件损坏不中断其余）
  let nodeFiles: string[];
  try {
    nodeFiles = listNodeFileNames(rootDir);
  } catch (e: any) {
    errors.push(`无法读取 nodes/ 目录: ${e.message}`);
    return result(errors, warnings, 0, 0, "nodes", false, false, []);
  }
  const nodes: NodeSchema[] = [];
  for (const f of nodeFiles) {
    const r = loadNodeFile(rootDir, f);
    if (r.ok) {
      nodes.push(r.data);
    } else {
      for (const i of r.issues) {
        errors.push(`nodes/${f}: ${i.field}: ${i.message}`);
      }
    }
  }
  if (nodes.length === 0) {
    warnings.push("图中没有节点");
  }
  // F17（adr_0007）：雾区提示——只提示不阻止，零新拒绝规则（core/fog.ts 单源）
  for (const fw of fogWarnings(graph, nodes)) {
    warnings.push(fw);
  }
  // v091-class-command（adr_0016）：雾/档矛盾 nudge——同址单源派生（core/fog.ts），
  // 条件不命中（无雾/program 档/用户直发凭据）即静默；零门禁，恒为 warning
  const classNudge = fogClassNudge(graph, readEvents(rootDir, { kind: "class_changed" }));
  if (classNudge !== undefined) {
    warnings.push(classNudge);
  }
  // IL-025：雾可毕业 nudge——已点火研究票全部 passed 时提示毕业留痕（core/fog.ts
  // 同址单源派生；ignited 缺省/空或任一票未 passed 即静默）；零门禁，恒为 warning
  if (graph.fog !== undefined) {
    const graduationNudge = fogGraduationNudge(
      graph.fog,
      new Map(nodes.map((n) => [n.id, n.status as string])),
    );
    if (graduationNudge !== undefined) {
      warnings.push(graduationNudge);
    }
  }
  const checkpoint_summaries: CheckpointSummary[] = [];
  for (const node of nodes) {
    // S2-5：max_attempts=0 表示不限重试，不参与超限判定
    if (node.max_attempts > 0 && node.attempts > node.max_attempts) {
      warnings.push(
        `节点 ${node.id} 已超出最大重试次数 (${node.attempts}/${node.max_attempts})`,
      );
    }
    // checkpoint 聚合态（供裁决 agent 快速判断节点是否可进入完成裁决；正文由渠道渲染）
    if (node.checkpoints && node.checkpoints.length > 0) {
      checkpoint_summaries.push({
        node_id: node.id,
        aggregate: aggregateCheckpointStatus(node.checkpoints),
        count: node.checkpoints.length,
      });
    }
  }

  // 3. 检查边（逐文件读取 + schema 校验 + 幽灵端点）
  let edgeFiles: string[];
  try {
    edgeFiles = listEdgeFileNames(rootDir);
  } catch (e: any) {
    errors.push(`无法读取 edges/ 目录: ${e.message}`);
    return result(errors, warnings, nodes.length, 0, "edges", false, false, checkpoint_summaries);
  }
  const edges: EdgeSchema[] = [];
  for (const f of edgeFiles) {
    const r = loadEdgeFile(rootDir, f);
    if (r.ok) {
      edges.push(r.data);
    } else {
      for (const i of r.issues) {
        errors.push(`edges/${f}: ${i.field}: ${i.message}`);
      }
    }
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`边 ${edge.id} 引用了不存在的源节点: ${edge.source}`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`边 ${edge.id} 引用了不存在的目标节点: ${edge.target}`);
    }
  }
  // F09（adr_0017）收窄 FIX-B1 警告口径：iterates 维持文档性标注（迭代语义由
  // 内建 attempts 重试链承担，不参与门禁与排序）；fallback 已有最小读语义
  // （调度面死节点替代路线标注），不再触发任何 warning
  for (const edge of edges) {
    if (edge.type === "iterates") {
      warnings.push(
        `边 ${edge.id} (iterates) 为文档性标注——迭代语义由内建 attempts 重试链承担，不参与门禁与排序`,
      );
    }
  }
  const ctxEdges = edges.filter((e) => e.type === "shares_context");
  if (ctxEdges.length > 0) {
    warnings.push(
      `检测到 ${ctxEdges.length} 条 shares_context 边：不参与门禁与拓扑排序，仅表达上下文共享意图`,
    );
  }

  // 4. v0.5 领域语义六规则（core/domain.ts：悬空归属/术语重复/跨context契约/relates端点/孤儿ADR/decides源）
  for (const d of validateDomainRules(nodes, edges)) {
    if (d.level === "error") errors.push(d.message);
    else warnings.push(d.message);
  }

  // 4b. F16：plan/DoD 文案 lint（core/style-lint.ts：规则码 a 脆弱定位/b 行号式/c 不可验证措辞，
  // manual §2.8 四原则）。恒为 warning——文案规范不参与退出码
  for (const node of nodes) {
    for (const li of lintNodeWording(node)) warnings.push(li.message);
  }

  // 5. 拓扑排序 + 循环检测
  let topo_ok = true;
  let cycles_found = false;
  if (nodes.length > 1) {
    try {
      topologicalSort(
        nodes.map((n) => n.id),
        edges,
      );
    } catch (e: any) {
      errors.push(`拓扑排序失败: ${e.message}`);
      topo_ok = false;
    }

    const cycles = detectCycles(
      nodes.map((n) => n.id),
      edges,
    );
    cycles_found = cycles.length > 0;
    for (const cycle of cycles) {
      errors.push(`检测到循环依赖: ${cycle.join(" → ")}`);
    }

    // FIX-B1：隐藏环路（fan 门控边闭合的互等环——ready 门禁今天就会死锁，
    // 但拓扑排序不可见。fallback/iterates 闭合属设计内回退/迭代，仅 per-edge 警告）
    const hidden = detectHiddenCycles(
      nodes.map((n) => n.id),
      edges,
    );
    for (const cycle of hidden) {
      warnings.push(
        `隐藏环路（fan_out/fan_in 门控边闭合: ${cycle.join(" → ")}）：门禁互等，节点可能永远无法 ready`,
      );
    }
  }

  // 6. 引用完整性（双向）
  const edgeFileIds = new Set(edges.map((e) => e.id));
  for (const n of graph.nodes) {
    const nid = n.file.replace(/^nodes\//, "").replace(/\.yaml$/, "");
    if (!nodeIds.has(nid)) {
      warnings.push(`graph.yaml 引用了不存在的节点文件: ${n.file}`);
    }
  }
  for (const e of graph.edges) {
    const eid = e.file.replace(/^edges\//, "").replace(/\.yaml$/, "");
    if (!edgeFileIds.has(eid)) {
      warnings.push(`graph.yaml 引用了不存在的边文件: ${e.file}`);
    }
  }
  // S2-6：反方向——文件存在但 graph.yaml 未引用（丢引用竞态 S1-4、半重置 S1-10
  // 产生的正是这个方向的漂移，此前完全不可见）。
  // arch-c3b 定稿（单源正文，渠道只加前缀不改写）：CLI 原文案为主语对偶句式；
  // 补救提示并收两通道事实——CLI 的 graph rebuild 只重建 index/ 不改 refs，
  // 故"重建引用"入口明确标注 MCP 通道（graph_rebuild），CLI 侧手工补回引用。
  const refNodeIds = new Set(
    graph.nodes.map((n) => n.file.replace(/^nodes\//, "").replace(/\.yaml$/, "")),
  );
  for (const f of nodeFiles) {
    const id = f.replace(/\.yaml$/, "");
    if (!refNodeIds.has(id)) {
      warnings.push(
        `graph.yaml 未引用已存在的节点文件: nodes/${f}（引用列表与目录漂移，请检查 graph.yaml 补回引用；MCP 通道可用 graph_rebuild 重建引用自愈）`,
      );
    }
  }
  const refEdgeIds = new Set(
    graph.edges.map((e) => e.file.replace(/^edges\//, "").replace(/\.yaml$/, "")),
  );
  for (const f of edgeFiles) {
    const id = f.replace(/\.yaml$/, "");
    if (!refEdgeIds.has(id)) {
      warnings.push(
        `graph.yaml 未引用已存在的边文件: edges/${f}（引用列表与目录漂移，请检查 graph.yaml 补回引用；MCP 通道可用 graph_rebuild 重建引用自愈）`,
      );
    }
  }

  return result(
    errors,
    warnings,
    nodes.length,
    edges.length,
    null,
    topo_ok,
    cycles_found,
    checkpoint_summaries,
  );
}
