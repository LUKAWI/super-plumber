#!/usr/bin/env node
// sp-check-design.mjs — 拓扑设计质量体检（plumber-design skill 配套）
// 在 graph validate（结构）之上补语义层检查：entry/exit、节点三要素、孤立节点、
// 根→汇双向可达、topo 环、边引用完整性。
// v0.5+ 语义：context/adr 知识顶点与 decides/relates 知识边不参与调度类检查；
// 可达性以「无入边根/无出边汇」锚定，不需要 entry/exit 虚拟边文件。
// 正本位：integrations/src/sp-scripts/（0.9.4 S03 八脚本收敛起，adr_0008）；运行位由
// gen 分发到 .pi/skills/plumber-execute/scripts/ 与 integrations/plugin/scripts/。
// Usage: node sp-check-design.mjs [--json] [root] [--graph <name>]   （从含 .graph/ 的工作区根目录运行）
//        等价入口：node sp.mjs check-design [--json] [root] [--graph <name>]
// 退出码：0 = 无 error；1 = 有 error（warning 不影响退出码）
import path from "node:path";
import * as fs from "node:fs";
import { loadCore } from "./sp.mjs";

// 位置参数 = 可选的工作区根目录（缺省 cwd）；--graph 指定工作区内目标图。
// 过滤掉 --json/--graph 等旗标，避免旗标被误当路径。
const _args = process.argv.slice(2);

function parseTargetArgs(args) {
  const positional = [];
  let graph;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--graph" || arg.startsWith("--graph=")) {
      const value = arg === "--graph" ? args[++i] : arg.slice("--graph=".length);
      if (!value || value.startsWith("--")) {
        console.error("❌ --graph 需要图名");
        process.exit(1);
      }
      if (graph !== undefined) {
        console.error("❌ --graph 只能指定一次");
        process.exit(1);
      }
      graph = value;
      continue;
    }
    if (arg === "--json") continue;
    positional.push(arg);
  }
  if (positional.length > 1) {
    console.error("Usage: node sp-check-design.mjs [--json] [root] [--graph <name>]");
    process.exit(1);
  }
  return { graph, root: path.resolve(positional[0] ?? process.cwd()), json: args.includes("--json") };
}

const _targetArgs = parseTargetArgs(_args);
const ROOT = _targetArgs.root;
const GRAPH_NAME = _targetArgs.graph;
const JSON_OUT = _targetArgs.json;

const { readGraph, readNode, readEdge, lintNodeWording, resolveGraphDir } = await loadCore();

const TOPO_TYPES = new Set(["depends_on", "validates"]);
const EDGE_TYPES = new Set([
  "depends_on",
  "validates",
  "shares_context",
  "fan_out",
  "fan_in",
  "fallback",
  "iterates",
  "decides", // v0.5 知识边：ADR → 管辖对象
  "relates", // v0.5 知识边：仅 context↔context
]);
// v0.5 知识顶点：无执行语义，不参与三要素/孤立/可达/id 前缀检查
const KNOWLEDGE_TYPES = new Set(["context", "adr"]);

/** 节点三要素检查 */
function checkTriad(node, issues) {
  const id = node.id;
  if (!node.plan?.description?.trim()) {
    issues.push({ level: "error", code: "E4", msg: `${id}: plan.description 缺失` });
  }
  const cps = node.checkpoints;
  if (!Array.isArray(cps) || cps.length === 0) {
    issues.push({ level: "error", code: "E4", msg: `${id}: checkpoints 缺失（需 ≥1 个子步骤）` });
  } else if (node.plan?.description?.length > 60 && cps.length < 2) {
    issues.push({ level: "warning", code: "W4", msg: `${id}: plan 较长但 checkpoints 仅 ${cps.length} 个` });
  }
  const dod = node.expected_outcome?.definition_of_done;
  if (!Array.isArray(dod) || dod.length === 0) {
    issues.push({ level: "error", code: "E4", msg: `${id}: definition_of_done 缺失（需 ≥1 条）` });
  }
}

/** BFS 可达性：从 start 沿 edges（按 direction 取向）能到哪些节点 */
function reachable(start, edges, direction) {
  const out = new Map(); // nodeId -> [{target, type}]
  for (const e of edges) {
    if (direction === "down") out.set(e.source, [...(out.get(e.source) ?? []), e]);
    else out.set(e.target, [...(out.get(e.target) ?? []), e]);
  }
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of out.get(cur) ?? []) {
      const nxt = direction === "down" ? e.target : e.source;
      if (!seen.has(nxt)) {
        seen.add(nxt);
        queue.push(nxt);
      }
    }
  }
  return seen;
}

function main() {
  const issues = [];

  // --- 读取 ---
  let graph;
  let target;
  try {
    target = resolveGraphDir(ROOT, {
      name: GRAPH_NAME,
      env: process.env.SUPER_PLUMBER_GRAPH,
    });
    graph = readGraph(target.dir);
  } catch (err) {
    console.error(`❌ 无法读取目标图（工作区 ${ROOT}）: ${err.message}`);
    process.exit(1);
  }
  const nodes = graph.nodes
    .map((f) => {
      try {
        return readNode(target.dir, path.basename(f.file, ".yaml"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const edges = graph.edges
    .map((f) => {
      try {
        return readEdge(target.dir, path.basename(f.file, ".yaml"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const nodeIds = new Set(nodes.map((n) => n.id));
  if (graph.entry) nodeIds.add("entry"); // entry 是 graph.yaml 里的虚拟节点，无文件
  if (graph.exit) nodeIds.add("exit"); // exit 同（有文件最好，无文件也算合法）
  const nodeByLevel = new Map(nodes.map((n) => [n.id, n.level]));
  const nodeType = new Map(nodes.map((n) => [n.id, n.type]));
  // 工作流节点视图：entry/exit 虚拟点 + 非知识顶点（v0.5 起 context/adr 不进调度）
  const wfIds = new Set(
    nodes.filter((n) => !KNOWLEDGE_TYPES.has(n.type)).map((n) => n.id),
  );
  if (graph.entry) wfIds.add("entry");
  if (graph.exit) wfIds.add("exit");

  // --- E1/E2/E3: entry / exit / 验收标准 ---
  if (!graph.entry?.description?.trim()) {
    issues.push({ level: "error", code: "E1", msg: "entry.description 缺失（graph.yaml 手写）" });
  }
  if (!graph.exit?.description?.trim()) {
    issues.push({ level: "error", code: "E2", msg: "exit.description 缺失（graph.yaml 手写）" });
  }
  if (!Array.isArray(graph.exit?.acceptance_criteria) || graph.exit.acceptance_criteria.length === 0) {
    issues.push({ level: "error", code: "E3", msg: "exit.acceptance_criteria 缺失（需 ≥1 条可验证标准）" });
  }

  // --- E4: 节点三要素（entry/exit 是图级定义节点，无 plan/checkpoints；知识顶点同跳过）---
  for (const n of nodes) {
    if (n.id === "exit" || n.id === "entry") continue;
    if (KNOWLEDGE_TYPES.has(n.type)) continue;
    checkTriad(n, issues);
  }

  // --- E5/W2/W3: 孤立/游离节点（预计算根汇集合，唯一根=主干起点、唯一汇=收口）---
  const inDegree = new Map();
  const outDegree = new Map();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    outDegree.set(id, 0);
  }
  for (const e of edges) {
    if (inDegree.has(e.target)) inDegree.set(e.target, inDegree.get(e.target) + 1);
    if (outDegree.has(e.source)) outDegree.set(e.source, outDegree.get(e.source) + 1);
  }
  const topoEdgesAll = edges.filter((e) => TOPO_TYPES.has(e.type));
  const realWf = [...wfIds].filter((id) => id !== "entry" && id !== "exit");
  const roots = realWf.filter((id) => !topoEdgesAll.some((e) => e.target === id));
  const sinks = realWf.filter((id) => !topoEdgesAll.some((e) => e.source === id));
  const isSoleRoot = (id) => roots.length === 1 && roots[0] === id;
  const isSoleSink = (id) => sinks.length === 1 && sinks[0] === id;
  for (const id of realWf) {
    if (inDegree.get(id) === 0 && outDegree.get(id) === 0) {
      issues.push({ level: "error", code: "E5", msg: `${id}: 孤立节点（无入边无出边）` });
    } else if (inDegree.get(id) === 0) {
      if (!isSoleRoot(id)) {
        issues.push({ level: "warning", code: "W3", msg: `${id}: 无入边（游离节点，谁触发它？）` });
      }
    } else if (outDegree.get(id) === 0) {
      if (!isSoleSink(id)) {
        issues.push({ level: "warning", code: "W2", msg: `${id}: 无出边（不通向任何下游）` });
      }
    }
  }

  // --- E6/E7: 双向可达（仅 topo 边；v0.5.2 起不依赖手写 entry/exit 虚拟边：
  //     根 = 无入边的工作流节点，汇 = 无出边的工作流节点 —— 与引擎 ready_gate
  //     冷启动语义一致。检查内容：①每个工作流节点从某根可达 ②可到达某汇；
  //     多根/多汇降级为 warning（提示收敛为单入口单出口） ---
  const topo = edges.filter((e) => TOPO_TYPES.has(e.type));
  const wfTopo = topo.filter((e) => wfIds.has(e.source) && wfIds.has(e.target));
  let coveredDown = new Set(["entry", "exit"]);
  for (const r of roots) {
    for (const id of reachable(r, wfTopo, "down")) coveredDown.add(id);
  }
  let coveredUp = new Set(["entry", "exit"]);
  for (const s of sinks) {
    for (const id of reachable(s, wfTopo, "up")) coveredUp.add(id);
  }
  if (wfIds.size > 2 && roots.length === 0) {
    issues.push({ level: "error", code: "E6", msg: "无可达根：全部工作流节点都有入边（疑似全环拓扑）" });
  }
  for (const id of wfIds) {
    if (id === "entry" || id === "exit") continue;
    if (!coveredDown.has(id)) {
      issues.push({ level: "error", code: "E6", msg: `${id}: 从任何根都不可达（沿 topo 边；断头图？）` });
    }
    if (!coveredUp.has(id)) {
      issues.push({ level: "error", code: "E7", msg: `${id}: 无法到达任何汇（沿 topo 边）` });
    }
  }
  if (roots.length > 1) {
    issues.push({
      level: "warning",
      code: "W6",
      msg: `多个入口根（${roots.join(", ")}）：建议收敛为单一主干起点`,
    });
  }
  if (sinks.length > 1) {
    issues.push({
      level: "warning",
      code: "W6",
      msg: `多个出口汇（${sinks.join(", ")}）：建议收敛为单一收口节点`,
    });
  }

  // --- E8: topo 环（DFS 三色标记）---
  const color = new Map();
  for (const id of nodeIds) color.set(id, 0);
  const adj = new Map();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of topo) adj.get(e.source).push(e.target);
  const stack = [];
  function dfs(id) {
    color.set(id, 1);
    stack.push(id);
    for (const nxt of adj.get(id)) {
      if (color.get(nxt) === 1) {
        const cycle = [...stack.slice(stack.indexOf(nxt)), nxt].join(" → ");
        issues.push({ level: "error", code: "E8", msg: `topo 环: ${cycle}` });
      } else if (color.get(nxt) === 0) {
        dfs(nxt);
      }
    }
    stack.pop();
    color.set(id, 2);
  }
  for (const id of nodeIds) if (color.get(id) === 0) dfs(id);

  // --- E9/E10: 边引用完整 + 类型合法 ---
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      issues.push({ level: "error", code: "E9", msg: `边 ${e.id}: source/target 引用不存在（${e.source} → ${e.target}）` });
    }
    if (!EDGE_TYPES.has(e.type)) {
      issues.push({ level: "error", code: "E10", msg: `边 ${e.id}: 非法类型 ${e.type}（允许: ${[...EDGE_TYPES].join("/")}）` });
    }
  }

  // --- W1: id 前缀 vs level（支持 L1-L5 分层；知识顶点无工作流层级语义，跳过）---
  const prefixOf = (level) => `l${level}_`;
  for (const [id, level] of nodeByLevel) {
    if (KNOWLEDGE_TYPES.has(nodeType.get(id))) continue;
    if (level >= 1 && level <= 5 && !id.startsWith(prefixOf(level))) {
      issues.push({
        level: "warning",
        code: "W1",
        msg: `${id}: level ${level} 但 id 不以 ${prefixOf(level)} 开头`,
      });
    }
  }

  // --- W5: 磁盘文件 vs graph.yaml 引用列表不一致（孤儿文件/幽灵边）---
  for (const dir of ["nodes", "edges"]) {
    const diskDir = path.join(target.dir, dir);
    if (!fs.existsSync(diskDir)) continue;
    const disk = fs.readdirSync(diskDir).filter((f) => f.endsWith(".yaml"));
    const refs = new Set(
      (dir === "nodes" ? graph.nodes : graph.edges).map((f) => path.basename(f.file)),
    );
    for (const f of disk) {
      if (!refs.has(f)) {
        issues.push({
          level: "warning",
          code: "W5",
          msg: `${dir}/${f}: 磁盘存在但 graph.yaml 未引用（孤儿文件/幽灵边）`,
        });
      }
    }
  }

  // --- W7: 多关注点图整体略过领域建模（issue log C1 防线）---
  // 触发条件：工作流节点 ≥ DOMAIN_NUDGE_NODES 且 context 顶点 = 0 → 建议评估 bounded context 划分。
  // 阈值取值理由（DOMAIN_NUDGE_NODES = 8）：designer 协议 L1 主干为 3–7 个阶段，是单关注点
  // 任务的常态规模；工作流节点 ≥8 通常意味着主干满配后仍有细分层（或多主干并行关注点），
  // 跨关注点概率显著上升；v080 事发图（11 个工作流节点、0 context）在该阈值下可被拦截。
  // 取更低（如 5）会对合法的单关注点小任务频繁误报；取更高（如 ≥12）则漏掉事发规模。
  // ADR=0 刻意不提示：单关注点小任务合法地没有 ADR，只查 context 全缺这一"跳过领域建模"信号。
  const DOMAIN_NUDGE_NODES = 8;
  const contextCount = nodes.filter((n) => n.type === "context").length;
  if (realWf.length >= DOMAIN_NUDGE_NODES && contextCount === 0) {
    issues.push({
      level: "warning",
      code: "W7",
      msg: `${realWf.length} 个工作流节点但 context 顶点 = 0：若需求跨多个关注点，请评估 bounded context 划分（领域建模 → 手册 §2.4）；确属单关注点任务可忽略本提示`,
    });
  }

  // --- W8: plan/DoD 文案 lint（manual §2.8 三类规则码 a 脆弱定位/b 行号式/c 不可验证措辞）---
  // 规则单源：经 loadCore() 消费 @lukawi/super-plumber/core 的 lintNodeWording
  // （src/core/style-lint.ts），脚本侧零复制——与 graph validate / MCP graph_validate 同源。
  // lint 恒为 warning（文案规范不参与退出码）；message 内嵌规则码〔a/b/c〕与 manual §2.8 判据。
  for (const n of nodes) {
    if (n.id === "exit" || n.id === "entry") continue;
    for (const li of lintNodeWording(n)) {
      issues.push({ level: "warning", code: "W8", msg: li.message });
    }
  }

  // --- 输出 ---
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          root: ROOT,
          graph: target.name,
          graph_dir: target.dir,
          nodes: nodes.length,
          edges: edges.length,
          errors: errors.map((i) => ({ code: i.code, message: i.msg })),
          warnings: warnings.map((i) => ({ code: i.code, message: i.msg })),
          pass: errors.length === 0,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`📋 设计体检: ${ROOT} / 图 ${target.name}（${nodes.length} 节点 / ${edges.length} 边）`);
    for (const i of issues) console.log(`  ${i.level === "error" ? "❌" : "⚠️"} [${i.code}] ${i.msg}`);
    if (errors.length === 0 && warnings.length === 0) console.log("✅ 全部通过：设计质量达标");
    else if (errors.length === 0) console.log(`⚠️ ${warnings.length} 个 warning（建议修）`);
    else console.log(`❌ ${errors.length} 个 error（必须修）+ ${warnings.length} 个 warning`);
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
