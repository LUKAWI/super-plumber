// tests/mcp/e2e-agent-loop.test.ts
// E2E 验收（成功标准之一）：纯 MCP 通道完成 建图 → 调度 → claim → checkpoint → report
// → verdict → passed → 三层验收 全流程，不碰 CLI、不手改 YAML。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SDK = "@modelcontextprotocol/sdk";

async function connectServer(cwd: string) {
  const { Client } = await import(`${SDK}/client/index.js`);
  const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);
  const serverJs = path.resolve(process.cwd(), "dist/mcp/server.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverJs],
    cwd,
  });
  const client = new Client({ name: "e2e-agent", version: "0.2.0" });
  await client.connect(transport);
  return client;
}

describe("E2E — pure-MCP agent loop", () => {
  let tmpDir: string;
  let client: { callTool: (r: { name: string; arguments: Record<string, unknown> }) => Promise<{ isError?: boolean; content: { type: string; text: string }[] }>; close: () => Promise<void> };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-e2e-"));
    // init 用 core 直写（E2E 起点：已有 .graph/ 骨架）
    const { writeGraph } = await import("../../src/core/parser.js");
    writeGraph(tmpDir, {
      id: "g-e2e",
      version: "0.2.0",
      label: "E2E 图",
      entry: { description: "", defined_by: "human", level: 0 },
      exit: { description: "", acceptance_criteria: [], defined_by: "human", level: 0 },
      nodes: [],
      edges: [],
    });
    client = (await connectServer(tmpDir)) as never;
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function call(name: string, args: Record<string, unknown>) {
    return client.callTool({ name, arguments: args });
  }

  async function textOf(name: string, args: Record<string, unknown>): Promise<unknown> {
    const r = await call(name, args);
    expect(r.isError, `${name} 失败: ${JSON.stringify(r.content)}`).toBeFalsy();
    return JSON.parse(r.content[0].text);
  }

  it("设计→执行→裁决→验收 全流程纯 MCP 跑通", async () => {
    // ── 1. 设计期：图级字段 + 批量建图（fan_out/fan_in 结构）──
    await textOf("graph_update_graph", {
      entry_description: "构建示例服务",
      exit_description: "服务可用并通过验收",
      add_criteria: ["服务可启动", "核心链路测试通过"],
    });
    await textOf("graph_batch_create", {
      nodes: [
        {
          id: "a",
          label: "基础模块",
          plan_description: "实现基础模块",
          definition_of_done: ["基础模块完成"],
          checkpoints: [
            { id: "cp1", label: "实现" },
            { id: "cp2", label: "自测" },
          ],
        },
        { id: "b", label: "分支B", plan_description: "实现 B", definition_of_done: ["B 完成"] },
        { id: "c", label: "分支C", plan_description: "实现 C", definition_of_done: ["C 完成"] },
        { id: "d", label: "汇聚D", plan_description: "汇合 B/C", definition_of_done: ["D 完成"] },
        { id: "e", label: "收尾E", plan_description: "集成收尾", definition_of_done: ["E 完成"] },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", type: "fan_out" },
        { id: "e2", source: "a", target: "c", type: "fan_out" },
        { id: "e3", source: "b", target: "d", type: "fan_in" },
        { id: "e4", source: "c", target: "d", type: "fan_in" },
        { id: "e5", source: "d", target: "e", type: "depends_on" },
      ],
    });

    // ── 2. 调度：next_actions 应给出 a（ready 候选前驱齐）──
    let next = (await textOf("graph_get_next_actions", {})) as {
      ready: { id: string }[];
      blocked: { id: string }[];
    };
    expect(next.ready).toEqual([]); // 全是 pending，先手动置 a ready
    expect(next.blocked.map((n) => n.id).sort()).toEqual(["b", "c", "d", "e"]);

    // ── 3. 执行 a：ready → claim → checkpoint → report → verdict → passed ──
    await textOf("graph_update_node_status", { id: "a", status: "ready" });
    await textOf("graph_update_node_status", {
      id: "a",
      status: "running",
      claim_by: "agent-a",
    });
    // 幂等重认领（同 agent）
    await textOf("graph_update_node_status", {
      id: "a",
      status: "running",
      claim_by: "agent-a",
    });
    await textOf("graph_update_checkpoint", {
      node_id: "a",
      checkpoint_id: "cp1",
      status: "passed",
    });
    await textOf("graph_update_checkpoint", {
      node_id: "a",
      checkpoint_id: "cp2",
      status: "passed",
    });
    await textOf("graph_update_execution_report", {
      node_id: "a",
      summary: "基础模块完成",
      artifacts: ["dist/a.js"],
    });
    await textOf("graph_update_execution_report", {
      node_id: "a",
      verification: { verdict: "passed", note: "抽查通过" },
      summary: "基础模块完成",
    });
    await textOf("graph_update_node_status", { id: "a", status: "passed" });

    // ── 4. 门禁验证：a passed 后 d 仍需等齐 fan_in（c 未完成）──
    const dBlocked = await call("graph_update_node_status", {
      id: "d",
      status: "ready",
    });
    expect(dBlocked.isError).toBe(true); // b/c 未 passed，fan_in 门禁拦截

    // ── 5. 并行分支 b/c 各自执行 ──
    for (const [id, claimer] of [["b", "agent-b"], ["c", "agent-c"]] as const) {
      await textOf("graph_update_node_status", { id, status: "ready" });
      await textOf("graph_update_node_status", { id, status: "running", claim_by: claimer });
      await textOf("graph_update_execution_report", {
        node_id: id,
        summary: `${id} 完成`,
        artifacts: [`dist/${id}.js`],
      });
      await textOf("graph_update_node_status", { id, status: "passed" });
    }

    // ── 6. 汇聚 d：fan_in 齐后放行；链尾 e ──
    await textOf("graph_update_node_status", { id: "d", status: "ready" });
    await textOf("graph_update_node_status", { id: "d", status: "running", claim_by: "agent-d" });
    await textOf("graph_update_execution_report", {
      node_id: "d",
      summary: "汇聚完成",
      artifacts: ["dist/d.js"],
    });
    await textOf("graph_update_node_status", { id: "d", status: "passed" });
    await textOf("graph_update_node_status", { id: "e", status: "ready" });
    await textOf("graph_update_node_status", { id: "e", status: "running", claim_by: "agent-e" });
    await textOf("graph_update_execution_report", {
      node_id: "e",
      summary: "收尾完成",
      artifacts: ["dist/e.js"],
    });
    await textOf("graph_update_node_status", { id: "e", status: "passed" });

    // ── 7. 三层验收（状态层）──
    const graph = (await textOf("graph_get_graph", {})) as {
      nodes: { id: string; status: string }[];
    };
    const taskStatuses = Object.fromEntries(
      graph.nodes.map((n) => [n.id, n.status]),
    );
    expect(taskStatuses).toEqual({
      a: "passed",
      b: "passed",
      c: "passed",
      d: "passed",
      e: "passed",
    });

    // 调度工具收官：无 ready/blocked/running 残留
    const finalNext = (await textOf("graph_get_next_actions", {})) as {
      ready: unknown[];
      blocked: unknown[];
      running: unknown[];
    };
    expect(finalNext.ready).toEqual([]);
    expect(finalNext.blocked).toEqual([]);
    expect(finalNext.running).toEqual([]);

    // ── 8. 快照作为交付基线 ──
    const snap = (await textOf("graph_snapshot", {
      message: "三层验收通过",
    })) as { id: string };
    expect(snap.id).toBeTruthy();
  }, 60_000);
});
