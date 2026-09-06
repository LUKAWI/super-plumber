// src/cli/init.ts — arch-c1（C1）全迁：工作区级命令（workspace 模式跳过图目录
// 解析），参数校验改抛 CliUsageError（消息与拆钩前逐字一致），错误渲染/退出码归
// runner——本文件不再持有 console.error + process.exit 散点。
import { createGraph, listGraphNames, writeWorkspaceDefault, trashGraph, migrateLegacyLayout } from "../core/graph-dir.js";
import { GRAPH_CLASSES } from "../core/schema.js";
import { createNode } from "../core/node.js";
import { createEdge } from "../core/edge.js";
import { EdgeType, NodeType } from "../core/types.js";
import { VERSION } from "../version.js";
import { defineCommand, CliUsageError } from "./runner.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const GRAPH_TEMPLATES = [
  "vertical-slice",
  "expand-contract",
  "research-decision-build",
  "hardening",
] as const;
type GraphTemplate = (typeof GRAPH_TEMPLATES)[number];

type TemplateSpec = {
  nodes: readonly {
    id: string;
    label: string;
    plan: string;
    dod: string[];
  }[];
  edges: readonly { id: string; source: string; target: string }[];
};

const TEMPLATE_SPECS: Record<GraphTemplate, TemplateSpec> = {
  "vertical-slice": {
    nodes: [
      { id: "slice-discover", label: "切片澄清", plan: "锁定一条可交付的端到端切片", dod: ["范围与验收标准明确"] },
      { id: "slice-build", label: "切片构建", plan: "实现并联通该切片的最小闭环", dod: ["切片可运行"] },
      { id: "slice-verify", label: "切片验收", plan: "验证切片并记录交付证据", dod: ["测试与验收证据齐全"] },
    ],
    edges: [
      { id: "slice-discover-to-build", source: "slice-discover", target: "slice-build" },
      { id: "slice-build-to-verify", source: "slice-build", target: "slice-verify" },
    ],
  },
  "expand-contract": {
    nodes: [
      { id: "expand", label: "Expand 扩展", plan: "先增加兼容的新结构或接口", dod: ["新旧路径可并存"] },
      { id: "migrate", label: "Migrate 迁移", plan: "迁移数据与调用方并观察结果", dod: ["迁移完成且可回溯"] },
      { id: "contract", label: "Contract 收缩", plan: "移除旧结构并收口兼容层", dod: ["旧路径安全下线"] },
    ],
    edges: [
      { id: "expand-to-migrate", source: "expand", target: "migrate" },
      { id: "migrate-to-contract", source: "migrate", target: "contract" },
    ],
  },
  "research-decision-build": {
    nodes: [
      { id: "research", label: "研究", plan: "收集证据并明确未知项", dod: ["关键事实与风险有证据"] },
      { id: "decision", label: "决策", plan: "比较选项并记录取舍", dod: ["决策与理由成文"] },
      { id: "build", label: "构建", plan: "按决策实现最小可交付方案", dod: ["方案可运行"] },
      { id: "build-verify", label: "验证", plan: "验证结果并回填决策证据", dod: ["验收结论可复核"] },
    ],
    edges: [
      { id: "research-to-decision", source: "research", target: "decision" },
      { id: "decision-to-build", source: "decision", target: "build" },
      { id: "build-to-verify", source: "build", target: "build-verify" },
    ],
  },
  hardening: {
    nodes: [
      { id: "baseline", label: "基线", plan: "记录当前行为、指标与风险", dod: ["基线数据可复测"] },
      { id: "harden", label: "加固", plan: "修复高风险路径并补防护", dod: ["关键风险有对应防护"] },
      { id: "regress", label: "回归", plan: "执行回归验证并检查退化", dod: ["回归测试通过"] },
      { id: "observe", label: "观察", plan: "观察运行指标并确认交付", dod: ["观察窗口与结论记录"] },
    ],
    edges: [
      { id: "baseline-to-harden", source: "baseline", target: "harden" },
      { id: "harden-to-regress", source: "harden", target: "regress" },
      { id: "regress-to-observe", source: "regress", target: "observe" },
    ],
  },
};

function applyGraphTemplate(graphDir: string, template: GraphTemplate | undefined): number {
  if (template === undefined) return 0;
  const spec = TEMPLATE_SPECS[template];
  for (const node of spec.nodes) {
    createNode(graphDir, {
      id: node.id,
      type: NodeType.Task,
      label: node.label,
      plan_description: node.plan,
      definition_of_done: node.dod,
    }, { actor: "cli" });
  }
  for (const edge of spec.edges) {
    createEdge(graphDir, {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: EdgeType.DependsOn,
    }, { actor: "cli" });
  }
  return spec.nodes.length;
}

export const initCommand = defineCommand("init", { workspace: true }).alias("i")
  .description("初始化图：新仓库必须带图名（内容命名，如 refactor-auth）；旧仓库带名 init = 一次性迁移 + 建新图")
  .argument("[name]", "图名（^小写[a-z0-9-]，内容命名；新仓库必填）")
  .option("-l, --label <label>", "图显示名", "untitled")
  .option(
    "--class <class>",
    `工作类预设：${GRAPH_CLASSES.join(" | ")}（DEC-2 三级路由；缺省不标注）`,
  )
  .option(
    "--template <template>",
    `骨架模板：${GRAPH_TEMPLATES.join(" | ")}（预留 entry/exit 并生成示例节点）`,
  )
  .option("-f, --force", "（仅旧式无名单图）已初始化时强制覆盖，慎用")
  .action((name: string | undefined, options: {
    label: string;
    class?: string;
    template?: string;
    force?: boolean;
  }) => {
    const rootDir = process.cwd();
    const graphClass = options.class as (typeof GRAPH_CLASSES)[number] | undefined;
    if (graphClass !== undefined && !(GRAPH_CLASSES as readonly string[]).includes(graphClass)) {
      throw new CliUsageError(`--class 仅允许 ${GRAPH_CLASSES.join(" | ")}（收到: ${options.class}）`);
    }
    const template = options.template as GraphTemplate | undefined;
    if (template !== undefined && !(GRAPH_TEMPLATES as readonly string[]).includes(template)) {
      throw new CliUsageError(`--template 仅允许 ${GRAPH_TEMPLATES.join(" | ")}（收到: ${options.template}）`);
    }
    const existing = listGraphNames(rootDir);
    const isLegacySingle = existing.length > 0 &&
      fs.existsSync(path.join(rootDir, ".graph", "graph.yaml"));

    // schema.yaml：工作区级文档（无论单图/多图都写在 .graph/ 根）
    const writeSchemaDoc = () =>
      fs.writeFileSync(path.join(rootDir, ".graph", "schema.yaml"), SCHEMA_DOC, "utf-8");

    if (name !== undefined) {
      // 带名 init：v0.5.2 语义——建图（旧布局会在此触发一次性迁移，锁内原子）
      const wasLegacy = isLegacySingle;
      // --force：已存在的同名图原地重置（旧语义保留；软删除旧目录可救回）
      if (options.force && existing.includes(name)) {
        trashGraph(rootDir, name, "cli");
        console.log(`📦 已存在同名图 "${name}"，--force 已将旧图移入 .trash/ 后重建`);
      }
      const graphDir = createGraph(rootDir, name, options.label, { actor: "cli", version: VERSION, class: graphClass });
      if (wasLegacy) {
        console.log(`📦 旧布局已一次性迁移至 .graph/default/（建第二图触发，锁内原子）`);
      }
      writeSchemaDoc();
      // 新图建好即设为工作区默认（建它就是为了干活）
      writeWorkspaceDefault(rootDir, name, "cli");
      console.log(`✅ 已创建图 "${name}" 并设为工作区默认: ${path.join(rootDir, ".graph", name)}`);
      const seeded = applyGraphTemplate(graphDir, template);
      if (seeded > 0) console.log(`   已按模板 "${template}" 生成 ${seeded} 个示例节点（entry/exit 保留为空待填写）`);
      console.log(`   切换：graph switch <名>；列举：graph list`);
      return;
    }

    // 无名 init：仅保留旧式单图兼容路径（已有多图/已迁移的工作区拒绝）
    const graphFile = path.join(rootDir, ".graph", "graph.yaml");
    if (existing.length > 0 && !isLegacySingle) {
      throw new CliUsageError(
        `本工作区已有多张图（${existing.join(", ")}）。请带图名创建：graph init <内容名> -l "<显示名>"`,
      );
    }
    if (fs.existsSync(graphFile) && !options.force) {
      throw new CliUsageError(`${graphFile} 已存在，请勿重复初始化（如需重置请加 --force）`);
    }
    if (!fs.existsSync(graphFile)) {
      // 新仓库无名单图 init：v0.5.2 起要求内容命名（default 式指代不清的名称禁止）
      throw new CliUsageError(
        `新仓库初始化必须带图名（内容命名）：graph init <名> -l "<显示名>"，如 graph init refactor-auth -l "认证重构"`,
      );
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
    const graphDir = createGraph(rootDir, "default", options.label, { actor: "cli", version: VERSION, class: graphClass });
    writeWorkspaceDefault(rootDir, "default", "cli");
    writeSchemaDoc();
    const seeded = applyGraphTemplate(graphDir, template);
    console.log(`✅ 已整目录重置旧式单图: ${path.join(rootDir, ".graph", "default")}（旧内容在 .graph/.trash/ 可手工救回）`);
    if (seeded > 0) console.log(`   已按模板 "${template}" 生成 ${seeded} 个示例节点（entry/exit 保留为空待填写）`);
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
# class: ${GRAPH_CLASSES.join("|")}                （F03/F13 可选工作类标注，DEC-2；缺省不标注）
# fog: { id, description, graduation, ignited?[] }
#            （F04 adr_0007 可选雾区：单雾起步；毕业=graph graduate-fog 清除 + fog_graduated 事件）
`;
