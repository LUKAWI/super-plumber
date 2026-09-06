// F11：MCP description 预算与逐工具语义锚点。
// token-equivalent 口径：汉字=1、非空 ASCII 字符=0.25、空白=0；用于稳定比较，
// 不是特定模型 tokenizer。baseline 来自清扫前 27 个工具的 listTools 快照。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    (total, ch) => total + (/[一-鿿]/u.test(ch) ? 1 : /s/u.test(ch) ? 0 : 0.25),
    0,
  );
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
  const result = {
    tool_count: rows.length,
    total_tokens: total,
    baseline_tokens: baseline.baseline_tokens,
    ratio: total / baseline.baseline_tokens,
    max_tokens: max,
    semantic_gaps: missing,
    rows: rows.map(({ name, tokens }) => ({ name, tokens })),
  };
  console.log(JSON.stringify(result, null, 2));
  if (rows.length !== baseline.tool_count || total > max || missing.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
