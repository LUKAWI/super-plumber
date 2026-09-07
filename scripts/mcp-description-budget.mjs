// F11：MCP description 预算与逐工具语义锚点。
// token-equivalent 口径：汉字=1、非空 ASCII 字符=0.25、空白=0；用于稳定比较，
// 不是特定模型 tokenizer。baseline 来自清扫前 27 个工具的 listTools 快照。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = process.cwd();
const baseline = JSON.parse(
  readFileSync(resolve(root, "scripts/mcp-description-baseline.json"), "utf8"),
);
const required = {
  graph_switch: ["active", "running"],
  graph_list_graphs: ["is_current", "oneline", "CLI"],
  graph_get_node: ["allowed_transitions", "ready_gate", "governing_adrs"],
  graph_get_graph: ["summary", "full", "edge_total"],
  graph_get_next_actions: ["ready_eligible", "all_graphs", "fallback_routes"],
  graph_survey: ["blocked", "stale", "ADR"],
  graph_traverse: ["DFS", "truncated"],
  graph_search: ["query", "nodes"],
  graph_validate: ["schema", "errors", "warnings"],
  graph_events: ["events.jsonl", "events"],
  graph_create_node: ["pending", "checkpoints", "context"],
  graph_create_adr: ["adr_NNNN", "proposed", "decides"],
  graph_batch_create: ["重复 id", "depends_on"],
  graph_add_edge: ["fallback 已有最小读语义", "iterates 仍为**文档性标注**", "graph validate"],
  graph_update_node: ["reset_attempts", "contracts"],
  graph_update_node_status: ["claim_by", "max_attempts", "ADR"],
  graph_reclaim_node: ["running→pending", "attempts"],
  graph_update_checkpoint: ["checkpoint", "幂等"],
  graph_update_execution_report: ["artifacts_check", "verification"],
  graph_update_graph: ["acceptance_criteria", "fog"],
  graph_graduate_fog: ["fog_graduated", "produced"],
  graph_approve: ["design_approved", "review"],
  graph_delete_node: [".deleted.yaml", "cascade"],
  graph_delete_edge: [".deleted.yaml"],
  graph_snapshot: ["sha256", "manifest"],
  graph_diff: ["from/to", "状态变化"],
  graph_rollback: ["confirm=true", "design_only"],
};

function estimate(text) {
  return [...text].reduce(
    (total, ch) => total + (/[一-鿿]/u.test(ch) ? 1 : /\s/u.test(ch) ? 0 : 0.25),
    0,
  );
}

function parseToolBody(result) {
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("MCP 工具未返回 JSON 文本");
  return JSON.parse(text);
}

function percentile95(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

async function measureNudgeBudget() {
  const dir = mkdtempSync(join(tmpdir(), "super-plumber-q4-"));
  const cli = resolve(root, "dist/cli/index.js");
  const serverJs = resolve(root, "dist/mcp/server.js");
  const runCli = (args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, stdio: "pipe" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverJs],
    cwd: dir,
  });
  const sampleClient = new Client({ name: "q4-nudge-budget", version: "1.0.0" });
  const samples = [];
  const gaps = [];
  const add = (scene, text, anchors = []) => {
    const value = text ?? "";
    for (const anchor of anchors) {
      if (!value.includes(anchor)) gaps.push(`${scene}: 缺少 ${anchor}`);
    }
    samples.push({ scene, text: value, tokens: estimate(value) });
  };
  const call = async (name, args = {}) => {
    const result = await sampleClient.callTool({ name, arguments: args });
    if (result.isError) {
      const detail = result.content?.find((item) => item.type === "text")?.text ?? "未知错误";
      throw new Error(`${name} 失败：${detail}`);
    }
    return parseToolBody(result);
  };

  try {
    runCli(["init", "q4-budget", "--class", "quick"]);
    runCli(["create-node", "--id", "amend", "--label", "Amend"]);
    runCli(["create-node", "--id", "research", "--label", "Research"]);
    runCli(["create-node", "--id", "claim", "--label", "Claim"]);
    await sampleClient.connect(transport);

    await call("graph_update_graph", {
      class: "standard",
      fog: {
        id: "q4-fog",
        description: "关键未知",
        graduation: "证据齐备",
        ignited: ["research"],
      },
    });

    for (const id of ["research", "amend"]) {
      await call("graph_update_node_status", { id, status: "ready" });
      await call("graph_update_node_status", { id, status: "running", claim_by: "q4-budget" });
      await call("graph_update_execution_report", { node_id: id, summary: `${id} sample complete` });
      await call("graph_update_node_status", { id, status: "passed" });
    }

    const next = await call("graph_get_next_actions");
    add("next", next.class_nudge, ["雾区", "关键未知", "program"]);
    add("next", next.fog_graduation_nudge, ["雾区", "graduate-fog", "standard"]);

    await call("graph_update_node_status", { id: "claim", status: "ready" });
    const claimed = await call("graph_update_node_status", {
      id: "claim",
      status: "running",
      claim_by: "q4-budget",
    });
    add("claim", claimed.review_flag, ["仅提示", "认领"]);

    const amended = await call("graph_update_node", {
      id: "amend",
      plan_description: "更新后的最小计划",
    });
    add("amend", amended.plan_amend_nudge, ["计划已变更", "不自动流转", "重开/重验"]);

    const approved = await call("graph_approve", { by: "q4-budget" });
    add("approve", undefined);
    if (approved.review?.status !== "approved") gaps.push("approve: review 未落 approved");
  } finally {
    await sampleClient.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }

  const hardLimit = 64;
  const p95 = percentile95(samples.map((sample) => sample.tokens));
  return {
    samples,
    p95_tokens: p95,
    hard_limit_tokens: hardLimit,
    semantic_gaps: gaps,
  };
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(root, "dist/mcp/server.js")],
  cwd: root,
});
const client = new Client({ name: "description-budget", version: "1.0.0" });
try {
  await client.connect(transport);
  const listed = await client.listTools();
  const rows = listed.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    tokens: estimate(tool.description ?? ""),
  }));
  const missing = [];
  for (const [name, terms] of Object.entries(required)) {
    const row = rows.find((item) => item.name === name);
    if (!row) {
      missing.push(`${name}: 工具不存在`);
      continue;
    }
    for (const term of terms) {
      if (!row.description.includes(term)) missing.push(`${name}: 缺少 ${term}`);
    }
  }
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  const max = baseline.baseline_tokens * baseline.max_ratio;
  const nudgeBudget = await measureNudgeBudget();
  const result = {
    tool_count: rows.length,
    total_tokens: total,
    baseline_tokens: baseline.baseline_tokens,
    ratio: total / baseline.baseline_tokens,
    max_tokens: max,
    semantic_gaps: missing,
    rows: rows.map(({ name, tokens }) => ({ name, tokens })),
    nudge_budget: nudgeBudget,
  };
  console.log(JSON.stringify(result, null, 2));
  if (
    rows.length !== baseline.tool_count ||
    total > max ||
    missing.length > 0 ||
    nudgeBudget.semantic_gaps.length > 0 ||
    nudgeBudget.p95_tokens > 32 ||
    nudgeBudget.samples.some((sample) => sample.tokens > nudgeBudget.hard_limit_tokens)
  ) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
