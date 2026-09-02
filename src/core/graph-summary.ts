// src/core/graph-summary.ts — 图目录定位与图摘要（arch-c2 自 cli/graph-ops.ts 下沉）
//
// 层次归位：graphDirOf（旧布局 default 目录判定）与 summarize（图摘要）原在
// cli/graph-ops.ts（S3-2/f14 合一为唯一实现），mcp/server.ts 反向 import cli 层——
// MCP → CLI 的层次倒挂。本文件把这两个纯 core 面（只依赖 core 的 node/edge/parser
// 读原语）下沉到 core：CLI graph-ops 命令与 MCP graph_list_graphs/graph_switch
// 都从这里消费，cli ↔ mcp 各自只做呈现。
// 逐字段等价（含键序）曾由 tests/f14-dedupe.test.ts 金测对照保障；单源下沉后该
// 金测退役（同源实现无可对照的第二通道），输出形状不变。

import * as fs from "node:fs";
import * as path from "node:path";
import { listNodes } from "./node.js";
import { listEdges } from "./edge.js";
import { readGraph } from "./parser.js";
import type { NodeStatus } from "./types.js";

export interface GraphSummary {
  name: string;
  label: string;
  nodeCount: number;
  edgeCount: number;
  running: number;
  passed: number;
  lastActivity: string | null;
}

// S3-2（f14）：旧布局 default 目录解析的唯一实现（原本 graph-ops.ts graphDirOf、
// mcp/server.ts hintMissing 与 graphBriefOf 三处手写同一判定，合一后随 arch-c2
// 下沉 core）。
export function graphDirOf(wsRoot: string, name: string): string {
  // 旧布局 default = .graph/ 原地；多图 = .graph/<名>/
  if (name === "default" && fs.existsSync(path.join(wsRoot, ".graph", "graph.yaml"))) {
    return path.join(wsRoot, ".graph");
  }
  return path.join(wsRoot, ".graph", name);
}

// S3-2（f14）：图摘要的唯一实现（原 CLI summarize 与 MCP graphBriefOf 近乎逐行
// 重复，合一后随 arch-c2 下沉 core；MCP 侧 graphBriefOf = summarize + isCurrent）。
export function summarize(wsRoot: string, name: string): GraphSummary {
  const dir = graphDirOf(wsRoot, name);
  let label = name;
  try {
    label = readGraph(dir).label;
  } catch {
    /* graph.yaml 损坏时退回图名 */
  }
  const nodes = listNodes(dir);
  const edges = listEdges(dir);
  const lastActivity =
    nodes
      .map((n) => n.updated_at ?? "")
      .sort()
      .pop() || null;
  return {
    name,
    label,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    running: nodes.filter((n) => n.status === ("running" as NodeStatus)).length,
    passed: nodes.filter((n) => n.status === ("passed" as NodeStatus)).length,
    lastActivity,
  };
}
