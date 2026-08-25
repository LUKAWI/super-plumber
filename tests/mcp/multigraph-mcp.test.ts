// tests/mcp/multigraph-mcp.test.ts — v0.5.2 mcp_tools E2E：graph_switch/graph_list_graphs/
// 全响应 graph 回显/跨图纠错/did-you-mean/进程内 active 不落盘
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

const SDK = "@modelcontextprotocol/sdk";
const CLI = path.resolve("dist/cli/index.js");

async function connectServer(cwd: string) {
  const { Client } = await import(`${SDK}/client/index.js`);
  const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.resolve("dist/mcp/server.js")],
    cwd,
  });
  const client = new Client({ name: "test", version: "0.5.2" });
  await client.connect(transport);
  return client;
}

function text(r: { content: { type: string; text?: string }[] }): any {
  return JSON.parse(r.content[0].text!);
}

describe("MCP v0.5.2 多图", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>> | null = null;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-mcp-v52-"));
    execSync(`node "${CLI}" init alpha -l "甲"`, { cwd: tmpDir });
    execSync(`node "${CLI}" create-node --id n1 -l "甲的节点"`, { cwd: tmpDir });
    execSync(`node "${CLI}" init beta -l "乙"`, { cwd: tmpDir }); // init 后 active=beta
    execSync(`node "${CLI}" switch alpha`, { cwd: tmpDir }); // 工作区默认=alpha
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("listTools ≥22（新增 graph_switch/graph_list_graphs）", async () => {
    const tools = await client!.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("graph_switch");
    expect(names).toContain("graph_list_graphs");
    expect(tools.tools.length).toBeGreaterThanOrEqual(22);
  });

  it("graph_list_graphs 无参：全部图 + is_current；带名详情", async () => {
    const r = await client!.callTool({ name: "graph_list_graphs", arguments: {} });
    const body = text(r);
    expect(body.graphs.map((g: any) => g.name).sort()).toEqual(["alpha", "beta"]);
    expect(body.current).toBe("alpha"); // 工作区默认（进程未切换）
    expect(body.graphs.find((g: any) => g.name === "alpha").isCurrent).toBe(true);

    const d = await client!.callTool({ name: "graph_list_graphs", arguments: { name: "beta" } });
    expect(text(d).label).toBe("乙");
  });

  it("graph_switch 带名：进程内切换 + 摘要；不带名：当前图+来源；错名 did-you-mean", async () => {
    const sw = await client!.callTool({
      name: "graph_switch",
      arguments: { name: "beta" },
    });
    const body = text(sw);
    expect(body.graph).toBe("beta");
    // f11（S2-2）：switched 增 effective 字段（env 压制时为 false——此处无 env，真切换）
    expect(body.switched).toEqual({ from: "alpha", to: "beta", persistent: false, effective: true });
    expect(body.summary.label).toBe("乙");

    // 切换后：当前=beta（进程内）
    const cur = await client!.callTool({ name: "graph_switch", arguments: {} });
    expect(text(cur).current.name).toBe("beta");
    expect(text(cur).current.source).toBe("process");

    // 进程内 active 不落盘：active 文件仍是 alpha
    expect(fs.readFileSync(path.join(tmpDir, ".graph", "active"), "utf-8").trim()).toBe("alpha");

    // 错名：列全部 + did-you-mean
    const bad = await client!.callTool({
      name: "graph_switch",
      arguments: { name: "alpa" },
    });
    expect(bad.isError).toBe(true);
    const errText = (bad.content[0] as { text: string }).text;
    expect(errText).toContain("alpha");
  });

  it("全响应回显 graph 字段：切换后 get_node/create 的响应带 beta", async () => {
    const r = await client!.callTool({
      name: "graph_create_node",
      arguments: { id: "b1", label: "乙的节点" },
    });
    expect(text(r).graph).toBe("beta");
    const g = await client!.callTool({ name: "graph_get_node", arguments: { id: "b1" } });
    expect(text(g).graph).toBe("beta");
  });

  it("跨图智能纠错：beta 里操作 alpha 的 n1 → 报错附『在图 alpha』提示", async () => {
    const r = await client!.callTool({
      name: "graph_get_node",
      arguments: { id: "n1" },
    });
    expect(r.isError).toBe(true);
    const errText = (r.content[0] as { text: string }).text;
    expect(errText).toContain("alpha");
    expect(errText).toContain("graph_switch");
  });

  it("写路径同样纠错：update_checkpoint 打到不存在节点（在另一图）→ 提示", async () => {
    const r = await client!.callTool({
      name: "graph_update_checkpoint",
      arguments: { node_id: "n1", checkpoint_id: "cp1", status: "running" },
    });
    expect(r.isError).toBe(true);
    const errText = (r.content[0] as { text: string }).text;
    expect(errText).toContain("alpha");
  });

  it("新进程回落工作区默认（进程内 active 不跨进程）", async () => {
    const c2 = await connectServer(tmpDir);
    const cur = await c2.callTool({ name: "graph_switch", arguments: {} });
    expect(text(cur).current.name).toBe("alpha"); // active 文件
    expect(text(cur).current.source).toBe("active");
    await c2.close();
  });
});
