// src/cli/init.ts
import { Command } from "commander";
import { writeGraph } from "../core/parser.js";
import { VERSION } from "../version.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const initCommand = new Command("init").alias("i")
  .description("在当前目录初始化 .graph/ 结构")
  .option("-l, --label <label>", "图名称", "untitled")
  .option("-f, --force", "已初始化时强制覆盖（慎用，会重置引用列表）")
  .action((options) => {
    const rootDir = process.cwd();
    const graphFile = path.join(rootDir, ".graph", "graph.yaml");
    // 重复 init：默认拒绝（避免静默覆盖已有图的 label/id/引用列表），--force 才覆盖
    if (fs.existsSync(graphFile) && !options.force) {
      console.error(
        `❌ ${graphFile} 已存在，请勿重复初始化（如需重置请加 --force）`,
      );
      process.exit(1);
    }
    const graph = {
      id: `graph_${Date.now()}`,
      version: VERSION,
      label: options.label,
      entry: {
        description: "",
        defined_by: "human" as const,
        level: 0,
      },
      exit: {
        description: "",
        acceptance_criteria: [],
        defined_by: "human" as const,
        level: 0,
      },
      nodes: [],
      edges: [],
    };
    writeGraph(rootDir, graph);
    // 完整目录骨架（需求 4.7：nodes/edges/snapshots/index）
    for (const d of ["nodes", "edges", "snapshots", "index"]) {
      fs.mkdirSync(path.join(rootDir, ".graph", d), { recursive: true });
    }
    // schema.yaml：人类可读的 schema 说明（需求 4.7 存储结构；运行时校验在 core/schema.ts）
    fs.writeFileSync(
      path.join(rootDir, ".graph", "schema.yaml"),
      SCHEMA_DOC,
      "utf-8",
    );
    console.log(`✅ 已初始化 .graph/ 目录: ${rootDir}`);
  });

// 人类可读 schema 说明（校验的文档化对应物，随版本更新）
const SCHEMA_DOC = `# Super Plumber — 节点/边/图 schema 说明（v${VERSION}）
# 本文件是文档性说明，运行时校验由 core/schema.ts 强制执行（graph validate 可查）。

# ── 节点（nodes/*.yaml）──
# 必填: id (string), label (string)
# 可选: type: task|checkpoint|decision|gate          （工作流顶点，默认 task）
#       type: context|adr                             （v0.5 知识顶点：豁免调度与工作流状态机）
#       level: number ≥ 0                             （默认 1）
#       status: 工作流七态 pending|ready|running|passed|failed|blocked|cancelled
#               adr 三态 proposed|accepted|superseded （label 即标题，decision 必填）
#               context 仅 pending                     （无状态）
#       assigned_to: string
#       attempts: number ≥ 0 | max_attempts: number ≥ 0（0 = 不限重试）
#       context: string                               （v0.5 归属的 context 顶点 id，外键）
#       boundary: string                              （v0.5 context 顶点：边界描述）
#       glossary: [{ term, definition }]              （v0.5 context 顶点：术语表，节点即文档）
#       decision / background / considered_options / why / consequences
#                                                    （v0.5 adr 顶点：决策内容）
#       superseded_by: string                         （v0.5 adr 顶点：status=superseded 时必填）
#       plan: { description, input_from[], required_context[], output_to[] }
#       expected_outcome: { definition_of_done[], quality_gates[] }
#       checkpoints: [{ id, label, status: pending|running|passed|failed|skipped,
#                       verifier: auto|cross_review|human }]
#       execution_report: { summary, artifacts[], blockers[], notes,
#                           started_at, completed_at,
#                           verification: { verdict: pending|passed|failed, note } }
#       created_at / updated_at: string

# ── 边（edges/*.yaml）──
# 必填: id, source, target
# 可选: type: depends_on|validates|shares_context|fan_out|fan_in|fallback|iterates
#       type: decides|relates                         （v0.5 知识边：不参与拓扑排序与门禁）
#       decides: ADR → 任意顶点（决策管辖，superseded 时沿此传播 adr_flags）
#       relates: context ↔ context（rel_kind 自由标注领域关系）
#       rel_kind: string                              （v0.5 relates 边的领域关系标注）
#       contract: { produces, consumed_by[], validation }
#                  （跨 context 的工作流边为契约边，未填会被 validate 警告）

# ── 图（graph.yaml）──
# 必填: id, label
# entry/exit: { description, defined_by: human|llm, level }
# exit.acceptance_criteria: string[]
# nodes/edges: [{ file }] | root_context: object
`;

