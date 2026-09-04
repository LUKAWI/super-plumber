// src/cli/get-node.ts — arch-c1（C1）全迁：flags 声明 + 纯渲染，错误/图解析/JSON
// 切换归 runner。原 isNodeNotFound 三副本之一已删——NODE_NOT_FOUND 由 core 落码、
// runner 单源渲染 `节点不存在: <id>`（本文件不再持有错误分类逻辑）。
import { getNode, checkReadyGate, getGoverningAdrs } from "../core/node.js";
import { buildClaimNudgePackage } from "../core/scheduler.js";
import { buildGraphIndex } from "../core/graph.js";
import { allowedTransitionsFor, aggregateCheckpointStatus } from "../core/state-machine.js";
import { requiresHuman } from "../core/domain.js";
import { isKnowledgeType } from "../core/types.js";
import { defineCommand, type RunContext } from "./runner.js";

export const getNodeCommand = defineCommand("get-node").alias("gn")
  .description("读取单个节点全部内容（解压压缩包）+ 合法转换 + 门禁状态")
  .requiredOption("-i, --id <id>", "节点 ID")
  .option("--json", "输出稳定 JSON（供脚本/agent 消费）")
  .option(
    "--neighbors <up|down|none>",
    "附加返回拓扑上游(up)/下游(down)相邻节点（紧凑字段，默认 none）",
    "none",
  )
  .action((options: { id: string; neighbors: string }, _cmd, ctx: RunContext) => {
    const rootDir = ctx.rootDir;
    const node = getNode(rootDir, options.id);
    const allowed = allowedTransitionsFor(node);
    const gate = isKnowledgeType(node.type)
      ? { ok: true, unmet: [] }
      : checkReadyGate(rootDir, node.id);
    const cpAgg = node.checkpoints?.length
      ? aggregateCheckpointStatus(node.checkpoints)
      : null;
    // v0.5：管辖 ADR（context/adr 知识顶点不适用）
    const governing = isKnowledgeType(node.type)
      ? { current: [], superseded: [] }
      : getGoverningAdrs(rootDir, node.id);

    // 拓扑邻居（基于索引缓存，无全图扫描）
    let neighborsUp: { id: string; status: string }[] = [];
    let neighborsDown: { id: string; status: string }[] = [];
    if (options.neighbors === "up" || options.neighbors === "down") {
      const index = buildGraphIndex(rootDir, { useCache: true });
      const statusOf = new Map(index.nodes.map((n) => [n.id, n.status]));
      const compact = (ids: string[]) =>
        ids.map((nid) => ({ id: nid, status: statusOf.get(nid) ?? "missing" }));
      if (options.neighbors === "up") {
        neighborsUp = compact(index.reverseAdj.get(node.id) ?? []);
      } else {
        neighborsDown = compact(index.adjacency.get(node.id) ?? []);
      }
    }

    // 纯格式化函数：人读面（runner 负责输出通道与错误渲染）
    const renderText = () => {
      ctx.out(`节点: ${node.id} (${node.label})`);
      ctx.out(`类型: ${node.type} | 层级: L${node.level} | 状态: ${node.status}`);
      ctx.out(`重试: ${node.attempts}/${node.max_attempts}${node.assigned_to ? ` | 执行者: ${node.assigned_to}` : ""}`);
      ctx.out(`合法转换: [${allowed.join(", ") || "无（终止态）"}]`);
      if (cpAgg !== null) {
        ctx.out(`checkpoint 聚合: ${cpAgg} (${node.checkpoints!.length} 个)`);
      }
      if (requiresHuman(node.checkpoints)) {
        ctx.out(`🧑 requires_human: 存在 verifier=human 的未完成 checkpoint（等真人处理，勿代签）`);
      }
      if (!gate.ok) {
        ctx.out(
          `⚠️  ready 门禁未满足: ${gate.unmet
            .map((u) => `${u.id}(${u.status}, via ${u.edgeType})`)
            .join(", ")}`,
        );
      }
      if (governing.current.length > 0) {
        ctx.out(`📖 管辖 ADR（claim 后必读）: ${governing.current.map((g) => `${g.id} ${g.title}`).join(" | ")}`);
      }
      // arch-c3a 残留收敛：⚠️ 措辞与调度面 adr_flags 同源（buildClaimNudgePackage），零手写变体
      const nudge = buildClaimNudgePackage(rootDir, node.id);
      if (nudge.adr_flags !== undefined) {
        ctx.out(`⚠️  ${nudge.adr_flags.join(" | ")}`);
      }
      if (node.plan?.description) {
        ctx.out(`\n计划: ${node.plan.description}`);
      }
      if (node.expected_outcome?.definition_of_done?.length) {
        ctx.out(`完成标准:`);
        for (const d of node.expected_outcome.definition_of_done) {
          ctx.out(`  - ${d}`);
        }
      }
      if (node.checkpoints?.length) {
        ctx.out(`检查点:`);
        for (const c of node.checkpoints) {
          ctx.out(`  [${c.status}] ${c.id}: ${c.label}`);
        }
      }
      if (node.execution_report?.summary) {
        ctx.out(`\n执行报告: ${node.execution_report.summary}`);
        if (node.execution_report.artifacts?.length) {
          ctx.out(`产物: ${node.execution_report.artifacts.join(", ")}`);
        }
      }
    };

    ctx.emit(
      () => ({
        node,
        allowed_transitions: allowed,
        checkpoint_aggregate: cpAgg,
        // F06（0.9.1 渐进审批）：存在未完成 human checkpoint 的派生标注
        // （core/domain.ts 单源；仅真值出现，条件缺省同 adr_flags/review_flag）
        ...(requiresHuman(node.checkpoints) ? { requires_human: true } : {}),
        ready_gate: gate,
        ...(governing.current.length > 0 || governing.superseded.length > 0
          ? { governing_adrs: governing }
          : {}),
        ...(neighborsUp.length > 0 ? { neighbors_up: neighborsUp } : {}),
        ...(neighborsDown.length > 0 ? { neighbors_down: neighborsDown } : {}),
      }),
      renderText,
    );
  });
