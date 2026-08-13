#!/usr/bin/env node
// sp-check-design.mjs — 拓扑设计质量体检（plumber-design skill 配套）
// 在 graph validate（结构）之上补语义层检查：entry/exit、节点三要素、孤立节点、
// entry→exit 双向可达、topo 环、边引用完整性。
// Usage: node sp-check-design.mjs [--json]   （从含 .graph/ 的目录运行）
// 退出码：0 = 无 error；1 = 有 error（warning 不影响退出码）
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import * as fs from "node:fs";

const ROOT = path.resolve(process.argv[2] ?? process.cwd());
const JSON_OUT = process.argv.includes("--json");

// 与 sp-core.mjs 同款加载：优先本地安装，回退全局安装的公开桶
async function loadCore() {
  try {
    return await import("@lukawi/super-plumber/core");
  } catch {
    try {
      const globalRoot = execSync("npm root -g").toString().trim();
      return await import(
        pathToFileURL(
          path.join(globalRoot, "@lukawi/super-plumber/dist/core/index.js"),
        ).href,
      );
    } catch {
      console.error(
        "❌ 无法定位 super-plumber 核心。请先安装: npm install -g @lukawi/super-plumber",
      );
      process.exit(1);
    }
  }
}
const { readGraph, readNode, readEdge } = await loadCore();

const TOPO_TYPES = new Set(["depends_on", "validates"]);
const EDGE_TYPES = new Set([
  "depends_on",
  "validates",
  "shares_context",
  "fan_out",
  "fan_in",
  "fallback",
  "iterates",
]);

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
  try {
    graph = readGraph(ROOT);
  } catch (err) {
    console.error(`❌ 无法读取 ${ROOT}/.graph/graph.yaml: ${err.message}`);
    process.exit(1);
  }
  const nodes = graph.nodes
    .map((f) => {
      try {
        return readNode(ROOT, path.basename(f.file, ".yaml"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const edges = graph.edges
    .map((f) => {
      try {
        return readEdge(ROOT, path.basename(f.file, ".yaml"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const nodeIds = new Set(nodes.map((n) => n.id));
  if (graph.entry) nodeIds.add("entry"); // entry 是 graph.yaml 里的虚拟节点，无文件
  if (graph.exit) nodeIds.add("exit"); // exit 同（有文件最好，无文件也算合法）
  const nodeByLevel = new Map(nodes.map((n) => [n.id, n.level]));

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

  // --- E4: 节点三要素（entry/exit 是图级定义节点，无 plan/checkpoints，跳过）---
  for (const n of nodes) {
    if (n.id === "exit" || n.id === "entry") continue;
    checkTriad(n, issues);
  }

  // --- E5: 孤立节点（entry 可无入边、exit 可无出边）---
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
  for (const id of nodeIds) {
    const isEntry = id === "entry";
    const isExit = id === "exit";
    if (inDegree.get(id) === 0 && outDegree.get(id) === 0) {
      issues.push({ level: "error", code: "E5", msg: `${id}: 孤立节点（无入边无出边）` });
    } else if (!isEntry && !isExit && inDegree.get(id) === 0) {
      issues.push({ level: "warning", code: "W3", msg: `${id}: 无入边（游离节点，谁触发它？）` });
    } else if (!isExit && outDegree.get(id) === 0) {
      issues.push({ level: "warning", code: "W2", msg: `${id}: 无出边（不通向任何下游）` });
    }
  }

  // --- E6/E7: 双向可达（仅 topo 边）---
  const topo = edges.filter((e) => TOPO_TYPES.has(e.type));
  const fromEntry = reachable("entry", topo, "down");
  const toExit = reachable("exit", topo, "up");
  for (const id of nodeIds) {
    if (!fromEntry.has(id)) {
      issues.push({ level: "error", code: "E6", msg: `${id}: 从 entry 不可达（沿 topo 边）` });
    }
    if (!toExit.has(id)) {
      issues.push({ level: "error", code: "E7", msg: `${id}: 无法到达 exit（沿 topo 边）` });
    }
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

  // --- W1: id 前缀 vs level（支持 L1-L5 分层）---
  const prefixOf = (level) => `l${level}_`;
  for (const [id, level] of nodeByLevel) {
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
    const diskDir = path.join(ROOT, ".graph", dir);
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

  // --- 输出 ---
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          root: ROOT,
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
    console.log(`📋 设计体检: ${ROOT}（${nodes.length} 节点 / ${edges.length} 边）`);
    for (const i of issues) console.log(`  ${i.level === "error" ? "❌" : "⚠️"} [${i.code}] ${i.msg}`);
    if (errors.length === 0 && warnings.length === 0) console.log("✅ 全部通过：设计质量达标");
    else if (errors.length === 0) console.log(`⚠️ ${warnings.length} 个 warning（建议修）`);
    else console.log(`❌ ${errors.length} 个 error（必须修）+ ${warnings.length} 个 warning`);
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
