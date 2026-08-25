// src/cli/init.ts
import { Command } from "commander";
import { createGraph, listGraphNames, writeWorkspaceDefault, trashGraph, migrateLegacyLayout } from "../core/graph-dir.js";
import { VERSION } from "../version.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const initCommand = new Command("init").alias("i")
  .description("初始化图：新仓库必须带图名（内容命名，如 refactor-auth）；旧仓库带名 init = 一次性迁移 + 建新图")
  .argument("[name]", "图名（^小写[a-z0-9-]，内容命名；新仓库必填）")
  .option("-l, --label <label>", "图显示名", "untitled")
  .option("-f, --force", "（仅旧式无名单图）已初始化时强制覆盖，慎用")
  .action((name: string | undefined, options) => {
    const rootDir = process.cwd();
    const existing = listGraphNames(rootDir);
    const isLegacySingle = existing.length > 0 &&
      fs.existsSync(path.join(rootDir, ".graph", "graph.yaml"));

    // schema.yaml：工作区级文档（无论单图/多图都写在 .graph/ 根）
    const writeSchemaDoc = () =>
      fs.writeFileSync(path.join(rootDir, ".graph", "schema.yaml"), SCHEMA_DOC, "utf-8");

    if (name !== undefined) {
      // 带名 init：v0.5.2 语义——建图（旧布局会在此触发一次性迁移，锁内原子）
      try {
        const wasLegacy = isLegacySingle;
        // --force：已存在的同名图原地重置（旧语义保留；软删除旧目录可救回）
        if (options.force && existing.includes(name)) {
          trashGraph(rootDir, name, "cli");
          console.log(`📦 已存在同名图 "${name}"，--force 已将旧图移入 .trash/ 后重建`);
        }
        createGraph(rootDir, name, options.label, { actor: "cli", version: VERSION });
        if (wasLegacy) {
          console.log(`📦 旧布局已一次性迁移至 .graph/default/（建第二图触发，锁内原子）`);
        }
        writeSchemaDoc();
        // 新图建好即设为工作区默认（建它就是为了干活）
        writeWorkspaceDefault(rootDir, name, "cli");
        console.log(`✅ 已创建图 "${name}" 并设为工作区默认: ${path.join(rootDir, ".graph", name)}`);
        console.log(`   切换：graph switch <名>；列举：graph list`);
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
      return;
    }

    // 无名 init：仅保留旧式单图兼容路径（已有多图/已迁移的工作区拒绝）
    const graphFile = path.join(rootDir, ".graph", "graph.yaml");
    if (existing.length > 0 && !isLegacySingle) {
      console.error(
        `❌ 本工作区已有多张图（${existing.join(", ")}）。请带图名创建：graph init <内容名> -l "<显示名>"`,
      );
      process.exit(1);
    }
    if (fs.existsSync(graphFile) && !options.force) {
      console.error(`❌ ${graphFile} 已存在，请勿重复初始化（如需重置请加 --force）`);
      process.exit(1);
    }
    if (!fs.existsSync(graphFile)) {
      // 新仓库无名单图 init：v0.5.2 起要求内容命名（default 式指代不清的名称禁止）
      console.error(
        `❌ 新仓库初始化必须带图名（内容命名）：graph init <名> -l "<显示名>"，如 graph init refactor-auth -l "认证重构"`,
      );
      process.exit(1);
    }
    // S1-10：--force 整目录重置（对齐带名 init 的 trash 语义）——旧实现只把
    // graph.yaml 引用列表清空、不删 nodes/*.yaml，重置后 readdir 与 refs 永久
    // 自相矛盾。旧布局原地先一次性迁移，再整目录回收重建（含 .locks，对齐
    // createGraph 的目录清单）。
    if (isLegacySingle) {
      const moved = migrateLegacyLayout(rootDir, "cli");
      console.log(`📦 旧布局已迁移至 .graph/default/（${moved.length} 项）`);
    }
    trashGraph(rootDir, "default", "cli");
    createGraph(rootDir, "default", options.label, { actor: "cli", version: VERSION });
    writeWorkspaceDefault(rootDir, "default", "cli");
    writeSchemaDoc();
    console.log(`✅ 已整目录重置旧式单图: ${path.join(rootDir, ".graph", "default")}（旧内容在 .graph/.trash/ 可手工救回）`);
  });

// 人类可读 schema 说明（校验的文档化对应物，随版本更新）
const SCHEMA_DOC = `# Super Plumber — 节点/边/图 schema 说明（v${VERSION}）
# 本文件是文档性说明，运行时校验由 core/schema.ts 强制执行（graph validate 可查）。

# ── 节点（nodes/*.yaml）──
# 必填: id (string), label (string), type, status, level, attempts, max_attempts,
#       created_at, updated_at（graph 工具创建时自动补全；手写文件必须齐全——
#       缺字段会被 schema 校验拒绝，不会静默通过）
#       注意：时间戳必须带引号（"2026-08-24T00:00:00.000Z"）——js-yaml 会把
#       裸 ISO 时间戳解析成 Date 对象而非字符串，同样过不了 schema 校验
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

