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
# 可选: type: task|checkpoint|decision|gate   （默认 task）
#       level: number ≥ 0                      （默认 1）
#       status: pending|ready|running|passed|failed|blocked|cancelled
#       assigned_to: string
#       attempts: number ≥ 0 | max_attempts: number ≥ 0（0 = 不限重试）
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
#       contract: { produces, consumed_by[], validation }

# ── 图（graph.yaml）──
# 必填: id, label
# entry/exit: { description, defined_by: human|llm, level }
# exit.acceptance_criteria: string[]
# nodes/edges: [{ file }] | root_context: object
`;

