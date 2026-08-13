// tests/mcp/phase3.test.ts — 新 MCP 工具（设计期补全 + 版本控制 + 批量 + 调度）
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

const SDK = "@modelcontextprotocol/sdk";

async function connectServer(cwd: string) {
  const { Client } = await import(`${SDK}/client/index.js`);
  const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);
  const serverJs = path.resolve(process.cwd(), "dist/mcp/server.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverJs, "--root", cwd],
    cwd,
  });
  const client = new Client({ name: "test", version: "0.2.0" });
  await client.connect(transport);
  return client;
}

async function call(client: Awaited<ReturnType<typeof connectServer>>, name: string, args: Record<string, unknown>) {
  return client.callTool({ name, arguments: args });
}

function textOf(r: Awaited<ReturnType<typeof call>>): unknown {
  return JSON.parse((r.content[0] as { text: string }).text);
}

describe("MCP phase 3 — agent-native toolset", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-mcp3-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init -l "MCP3"`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("listTools ≥ 17", async () => {
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(17);
  });

  it("graph_create_node 一次建完整压缩包（plan+dod+checkpoints）", async () => {
    const r = await call(client, "graph_create_node", {
      id: "n1",
      label: "节点1",
      plan_description: "实现 X",
      definition_of_done: ["d1", "d2"],
      checkpoints: [
        { id: "cp1", label: "步骤1" },
        { id: "cp2", label: "步骤2" },
      ],
    });
    expect(r.isError).toBeFalsy();
    const g = await call(client, "graph_get_node", { id: "n1" });
    expect(g.isError).toBeFalsy();
    const data = textOf(g) as {
      node: {
        plan?: { description: string };
        expected_outcome?: { definition_of_done: string[] };
        checkpoints?: unknown[];
      };
      allowed_transitions: string[];
      ready_gate: { ok: boolean };
    };
    expect(data.node.plan?.description).toBe("实现 X");
    expect(data.node.expected_outcome?.definition_of_done).toEqual(["d1", "d2"]);
    expect(data.node.checkpoints).toHaveLength(2);
    expect(data.allowed_transitions).toContain("ready");
    expect(data.ready_gate.ok).toBe(true);
  });

  it("graph_add_edge / graph_delete_edge", async () => {
    await call(client, "graph_create_node", { id: "n2", label: "节点2" });
    const add = await call(client, "graph_add_edge", {
      id: "e1",
      source: "n1",
      target: "n2",
      type: "depends_on",
    });
    expect(add.isError).toBeFalsy();

    // 幽灵源节点 → isError
    const ghost = await call(client, "graph_add_edge", {
      id: "e2",
      source: "ghost",
      target: "n2",
      type: "depends_on",
    });
    expect(ghost.isError).toBe(true);

    const del = await call(client, "graph_delete_edge", { id: "e1" });
    expect(del.isError).toBeFalsy();
    const missing = await call(client, "graph_delete_edge", { id: "e1" });
    expect(missing.isError).toBe(true);
  });

  it("graph_update_node 更新 plan/dod/checkpoints", async () => {
    const r = await call(client, "graph_update_node", {
      id: "n1",
      plan_description: "更新后的计划",
      add_dod: ["d3"],
      add_checkpoints: [{ id: "cp3", label: "步骤3" }],
    });
    expect(r.isError).toBeFalsy();
    const g = await call(client, "graph_get_node", { id: "n1" });
    const data = textOf(g) as {
      node: {
        plan?: { description: string };
        expected_outcome?: { definition_of_done: string[] };
        checkpoints?: unknown[];
      };
    };
    expect(data.node.plan?.description).toBe("更新后的计划");
    expect(data.node.expected_outcome?.definition_of_done).toContain("d3");
    expect(data.node.checkpoints).toHaveLength(3);
  });

  it("graph_update_graph 设置 entry/exit", async () => {
    const r = await call(client, "graph_update_graph", {
      entry_description: "构建一个示例系统",
      exit_description: "系统可用且验收通过",
      add_criteria: ["验收标准1"],
    });
    expect(r.isError).toBeFalsy();
    const content = fs.readFileSync(path.join(tmpDir, ".graph/graph.yaml"), "utf-8");
    expect(content).toContain("构建一个示例系统");
    expect(content).toContain("验收标准1");
  });

  it("graph_get_next_actions 输出调度结构", async () => {
    // 造链：a → b（a ready 后可认领，b 等依赖）
    await call(client, "graph_create_node", { id: "a", label: "A" });
    await call(client, "graph_create_node", { id: "b", label: "B" });
    await call(client, "graph_add_edge", {
      id: "e_ab",
      source: "a",
      target: "b",
      type: "depends_on",
    });
    await call(client, "graph_update_node_status", { id: "a", status: "ready" });
    const r = await call(client, "graph_get_next_actions", {});
    expect(r.isError).toBeFalsy();
    const data = textOf(r) as {
      ready: { id: string }[];
      blocked: { id: string; unmet: { id: string }[] }[];
    };
    expect(data.ready.map((n) => n.id)).toContain("a");
    expect(data.blocked.map((n) => n.id)).toContain("b");
  });

  it("graph_batch_create 成功 + 冲突清单 + 幽灵引用", async () => {
    // 成功批量
    const ok = await call(client, "graph_batch_create", {
      nodes: [
        { id: "x1", label: "X1", plan_description: "做 X1", definition_of_done: ["ok"] },
        { id: "x2", label: "X2" },
      ],
      edges: [{ id: "ex", source: "x1", target: "x2", type: "depends_on" }],
    });
    expect(ok.isError).toBeFalsy();
    expect(textOf(ok)).toEqual({ ok: true, nodes: 2, edges: 1 });

    // 冲突：重复 id + 幽灵引用，全部报出
    const conflicts = await call(client, "graph_batch_create", {
      nodes: [{ id: "x1", label: "X1-dup" }],
      edges: [{ id: "ex2", source: "x1", target: "ghost2", type: "depends_on" }],
    });
    expect(conflicts.isError).toBe(true);
    const conflictData = JSON.parse(
      (conflicts.content[0] as { text: string }).text,
    ) as { ok: boolean; conflicts: string[] };
    expect(conflictData.ok).toBe(false);
    expect(conflictData.conflicts.some((c) => c.includes("x1"))).toBe(true);
    expect(conflictData.conflicts.some((c) => c.includes("ghost2"))).toBe(true);
  });

  it("graph_snapshot → diff → rollback 闭环", async () => {
    const snap = await call(client, "graph_snapshot", { message: "mcp-v1" });
    expect(snap.isError).toBeFalsy();
    const snapId = (textOf(snap) as { id: string }).id;

    // 变更
    await call(client, "graph_create_node", { id: "y1", label: "Y1" });

    const diff = await call(client, "graph_diff", {});
    expect(diff.isError).toBeFalsy();
    const diffData = textOf(diff) as { added: string[] };
    expect(diffData.added).toContain("nodes/y1.yaml");

    // 无 confirm 拒绝
    const refuse = await call(client, "graph_rollback", { snapshot_id: snapId });
    expect(refuse.isError).toBe(true);

    // 确认回滚
    const rb = await call(client, "graph_rollback", {
      snapshot_id: snapId,
      confirm: true,
    });
    expect(rb.isError).toBeFalsy();
    expect(fs.existsSync(path.join(tmpDir, ".graph/nodes/y1.yaml"))).toBe(false);
  });

  it("graph_update_execution_report 支持 verification 裁决", async () => {
    const r = await call(client, "graph_update_execution_report", {
      node_id: "a",
      summary: "A 完成",
      artifacts: ["dist/a.js"],
      verification: { verdict: "passed", note: "产物已抽查" },
    });
    expect(r.isError).toBeFalsy();
    const data = textOf(r) as {
      execution_report?: { verification?: { verdict: string; note?: string } };
    };
    expect(data.execution_report?.verification?.verdict).toBe("passed");
    expect(data.execution_report?.verification?.note).toBe("产物已抽查");
  });
});
