// tests/mcp/traverse-depth.test.ts
// IL-003：graph_traverse 深度截断静默丢节点（truncated 虚报）修复验证。
// 场景复现用户实测：33+ 跳深链图，max_depth=20 只回前段，末端整段丢失
// 且修复前 truncated:false 虚报"没有截断"。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// 使用真实 MCP client 走 STDIO 协议（与 agent 调用路径一致）
const SDK = "@modelcontextprotocol/sdk";

async function connectServer(cwd: string) {
  const { Client } = await import(`${SDK}/client/index.js`);
  const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);
  const serverJs = path.resolve(process.cwd(), "dist/mcp/server.js");
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverJs],
    cwd,
  });
  const client = new Client({ name: "test", version: "0.1.1" });
  await client.connect(transport);
  return client;
}

function parseJson(client_result: any): any {
  const block = client_result.content[0] as { type: "text"; text: string };
  return JSON.parse(block.text);
}

describe("IL-003 graph_traverse 深链截断语义", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>> | null = null;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-traverse-depth-"));
    const { execSync } = await import("node:child_process");
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    client = await connectServer(tmpDir);

    // 33 节点链 c00→c01→…→c32（32 跳）+ 旁支 br→c15，一次批量建图
    const ids = Array.from({ length: 33 }, (_, i) => `c${String(i).padStart(2, "0")}`);
    const nodes = ids.map((id) => ({ id, label: id }));
    nodes.push({ id: "br", label: "branch" });
    const edges = [];
    for (let i = 0; i < ids.length - 1; i++) {
      edges.push({ id: `e${String(i).padStart(2, "0")}`, source: ids[i], target: ids[i + 1] });
    }
    edges.push({ id: "ebr", source: "br", target: "c15" });
    const r = await client.callTool({
      name: "graph_batch_create",
      arguments: { nodes, edges },
    });
    expect(r.isError).toBeFalsy();
  });

  afterAll(async () => {
    await client?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("缺陷复现：深链 max_depth=20 时末端丢失且如实上报 truncated_by_depth（修复前虚报 truncated:false）", async () => {
    const r = await client!.callTool({
      name: "graph_traverse",
      arguments: { node_id: "c00", direction: "downstream", max_depth: 20 },
    });
    expect(r.isError).toBeFalsy();
    const out = parseJson(r);
    const last = out.nodes[out.nodes.length - 1];
    expect(last).toBe("c20"); // 深度 20 处截断
    expect(out.nodes).not.toContain("c32");
    // 核心修复：深度截断必须如实上报，绝不虚报 false
    expect(out.truncated).toBe(true);
    expect(out.truncated_by_depth).toBe(true);
    expect(out.truncated_by_nodes).toBe(false);
  });

  it("DoD：深链图一次调用可达末端（max_depth=50 覆盖 32 跳，无任何截断）", async () => {
    const r = await client!.callTool({
      name: "graph_traverse",
      arguments: { node_id: "c00", direction: "downstream", max_depth: 50 },
    });
    expect(r.isError).toBeFalsy();
    const out = parseJson(r);
    expect(out.nodes).toContain("c32");
    expect(out.nodes).toHaveLength(33); // 纯链 c00..c32；br 是独立根不在 c00 下游
    expect(out.truncated).toBe(false);
    expect(out.truncated_by_depth).toBe(false);
    expect(out.truncated_by_nodes).toBe(false);
  });

  it("max_nodes 截断如实上报 truncated_by_nodes", async () => {
    const r = await client!.callTool({
      name: "graph_traverse",
      arguments: { node_id: "c00", direction: "downstream", max_depth: 50, max_nodes: 10 },
    });
    expect(r.isError).toBeFalsy();
    const out = parseJson(r);
    expect(out.nodes).toHaveLength(10);
    expect(out.truncated).toBe(true);
    expect(out.truncated_by_nodes).toBe(true);
    expect(out.truncated_by_depth).toBe(false);
  });

  it("schema 上限已上调：max_depth=51 被 zod 拦截（isError），50 合法", async () => {
    const over = await client!.callTool({
      name: "graph_traverse",
      arguments: { node_id: "c00", max_depth: 51 },
    });
    expect(over.isError).toBe(true);
    // 50 恰好合法（不再被旧上限 20 拒绝）
    const ok = await client!.callTool({
      name: "graph_traverse",
      arguments: { node_id: "c00", max_depth: 50 },
    });
    expect(ok.isError).toBeFalsy();
  });

  it("upstream 方向深链同样如实上报（从 c32 反向 max_depth=5 截断于 c27）", async () => {
    const r = await client!.callTool({
      name: "graph_traverse",
      arguments: { node_id: "c32", direction: "upstream", max_depth: 5 },
    });
    expect(r.isError).toBeFalsy();
    const out = parseJson(r);
    const last = out.nodes[out.nodes.length - 1];
    expect(last).toBe("c27");
    expect(out.nodes).not.toContain("c00");
    expect(out.truncated).toBe(true);
    expect(out.truncated_by_depth).toBe(true);
  });

  it("分叉节点计入且深度足够时无截断虚报（br→c15 分支与主干同收）", async () => {
    const r = await client!.callTool({
      name: "graph_traverse",
      arguments: { node_id: "br", direction: "downstream", max_depth: 50 },
    });
    expect(r.isError).toBeFalsy();
    const out = parseJson(r);
    expect(out.nodes[0]).toBe("br");
    expect(out.nodes).toContain("c15");
    expect(out.nodes).toContain("c32");
    expect(out.truncated).toBe(false);
  });
});
