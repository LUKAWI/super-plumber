// src/core/workspace-read.ts — 多图工作区只读聚合与体检（F10/F20）
//
// 这里只读各图，不切换 active、不写 .graph；CLI 与 MCP 共用同一份派生结果。
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listGraphNames } from "./graph-dir.js";
import { graphDirOf, summarize } from "./graph-summary.js";
import { buildGraphIndex } from "./index-service.js";
import { governingAdrsFor } from "./domain.js";
import { computeNextActions, type NextActionsResult } from "./scheduler.js";
import { isKnowledgeType } from "./types.js";

export type WorkspaceNextActionsEntry = {
  graph: string;
  label: string;
} & NextActionsResult;

/** 多图工作区只读前沿聚合；结果保留图名标签，绝不改变 active 图。 */
export function computeNextActionsAll(
  wsRoot: string,
  opts: Parameters<typeof computeNextActions>[1] = {},
): WorkspaceNextActionsEntry[] {
  return listGraphNames(wsRoot).map((name) => {
    const dir = graphDirOf(wsRoot, name);
    return {
      graph: name,
      label: summarize(wsRoot, name).label,
      ...computeNextActions(dir, opts),
    };
  });
}

export interface SurveyAdrConflict {
  node_id: string;
  node_label: string;
  current: ReturnType<typeof governingAdrsFor>["current"];
  superseded: ReturnType<typeof governingAdrsFor>["superseded"];
  action: string;
}

export interface SurveyGraph {
  graph: string;
  label: string;
  blocked: NextActionsResult["blocked"];
  stale: NextActionsResult["stale_running"];
  adr_conflicts: SurveyAdrConflict[];
  summary: NextActionsResult["summary"];
}

export interface WorkspaceSurveyReport {
  workspace: string;
  generated_at: string;
  graphs: SurveyGraph[];
}

/**
 * 多图体检：汇总 blocked、stale_running 与需要重审的 ADR 管辖冲突。
 * 冲突口径是同一工作流节点同时受多个 current ADR 管辖，或仍带 superseded
 * 管辖依据；它们只进报告，不改变调度门禁，也不替代裁决方改 ADR。
 */
export function surveyWorkspace(
  wsRoot: string,
  opts: Parameters<typeof computeNextActions>[1] = {},
): WorkspaceSurveyReport {
  const graphs: SurveyGraph[] = listGraphNames(wsRoot).map((name) => {
    const dir = graphDirOf(wsRoot, name);
    const next = computeNextActions(dir, opts);
    const index = buildGraphIndex(dir, { useCache: true });
    const conflicts: SurveyAdrConflict[] = [];
    for (const node of index.nodes.filter((n) => !isKnowledgeType(n.type))) {
      const governing = governingAdrsFor(index.nodes, index.edges, node.id);
      if (governing.current.length <= 1 && governing.superseded.length === 0) continue;
      const reasons: string[] = [];
      if (governing.current.length > 1) reasons.push("多个 current ADR 同时管辖");
      if (governing.superseded.length > 0) reasons.push("存在 superseded 管辖依据");
      conflicts.push({
        node_id: node.id,
        node_label: node.label,
        current: governing.current,
        superseded: governing.superseded,
        action: `重审并裁决：${reasons.join("；")}`,
      });
    }
    return {
      graph: name,
      label: summarize(wsRoot, name).label,
      blocked: next.blocked,
      stale: next.stale_running,
      adr_conflicts: conflicts,
      summary: next.summary,
    };
  });
  return {
    workspace: wsRoot,
    generated_at: new Date().toISOString(),
    graphs,
  };
}

/** 把体检报告落系统临时目录；仓库不产生临时文件。 */
export function writeSurveyReport(report: WorkspaceSurveyReport): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "super-plumber-survey-"));
  const file = path.join(dir, "report.json");
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return file;
}
