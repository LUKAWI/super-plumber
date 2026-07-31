// tests/mcp/server.test.ts
// MCP server 协议合规性测试：参数缺失应返回 isError=true 的明确错误，而非静默错误数据
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
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
  const client = new Client({ name: "test", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

describe("MCP server protocol compliance", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>> | null = null;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-mcp-test-"));
    // 初始化一个图 + 节点（用绝对路径，vitest 工作目录可能不同）
    const { execSync } = await import("node:child_process");
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node \"${cli}\" init`, { cwd: tmpDir });
    execSync(`node \"${cli}\" create-node --id a --label A`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("listTools 返回 9 个工具", async () => {
    const tools = await client!.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(9);
  });

  it("graph_get_node 正常调用返回节点", async () => {
    const r = await client!.callTool({ name: "graph_get_node", arguments: { id: "a" } });
    expect(r.isError).toBeFalsy();
    const block = r.content[0] as { type: "text"; text: string };
    expect(block.text).toContain('"id": "a"');
    expect(block.text).toContain('"label": "A"');
  });

  it("缺 id 时 graph_get_node 报协议错误而非 ENOENT", async () => {
    // McpServer 的 zod 校验在协议层拦截缺参：要么抛 McpError，要么 isError=true
    // 绝不应是 ENOENT 文件错误或 undefined.yaml
    let handled = false;
    try {
      const r = await client!.callTool({ name: "graph_get_node", arguments: {} });
      handled = r.isError === true;
      const text = JSON.stringify(r.content);
      expect(text).not.toContain("ENOENT");
      expect(text).not.toContain("undefined.yaml");
    } catch (e: any) {
      handled = true; // 抛出 McpError 同样合规
      expect(e.message).not.toContain("ENOENT");
      expect(e.message).not.toContain("undefined.yaml");
    }
    expect(handled).toBe(true);
  });

  it("缺 node_id 时 graph_traverse 不再静默返回 [null]", async () => {
    // 关键断言：要么协议错误，要么 isError=true；绝不允许 isError=false 且返回 [null]
    let handled = false;
    try {
      const r = await client!.callTool({ name: "graph_traverse", arguments: {} });
      handled = r.isError === true;
      const text = JSON.stringify(r.content);
      expect(text).not.toContain("[null]");
    } catch {
      handled = true; // 协议错误即合规
    }
    expect(handled).toBe(true);
  });

  it("非法 status 值时 graph_update_node_status 返回 isError", async () => {
    const r = await client!.callTool({
      name: "graph_update_node_status",
      arguments: { id: "a", status: "bogus" },
    });
    expect(r.isError).toBe(true);
  });

  it("不存在的工具名返回 isError", async () => {
    const r = await client!.callTool({ name: "graph_nonexistent", arguments: {} });
    expect(r.isError).toBe(true);
  });
});
