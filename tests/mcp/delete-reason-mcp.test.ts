// tests/mcp/delete-reason-mcp.test.ts — F14（0.8.1）：
// graph_delete_node 的 reason 参数（MCP 通道）——理由写入 .deleted.yaml 归档与
// node_deleted 审计事件；缺省 reason 时行为保持现状（DEC-3：理由是凭据不是拒绝条件）。
// 使用真实 MCP client 走 STDIO 协议（与 agent 调用路径一致）。
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
    command: "node",
    args: [serverJs],
    cwd,
  });
  const client = new Client({ name: "test", version: "0.1.1" });
  await client.connect(transport);
  return client;
}

describe("F14: graph_delete_node reason（MCP 通道）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f14-mcp-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id a --label A`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id b --label B`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("带 reason：响应含理由，.deleted.yaml 与 node_deleted 事件均落盘", async () => {
    const r = await client.callTool({
      name: "graph_delete_node",
      arguments: { id: "a", reason: "与 v2 设计冲突" },
    });
    expect(r.isError).toBeFalsy();
    const text = (r.content![0] as { type: string; text: string }).text;
    expect(text).toContain("与 v2 设计冲突");

    const deleted = fs.readFileSync(
      path.join(tmpDir, ".graph/t/nodes/a.deleted.yaml"),
      "utf-8",
    );
    expect(deleted).toContain("deleted_reason:");
    expect(deleted).toContain("与 v2 设计冲突");

    const events = fs.readFileSync(
      path.join(tmpDir, ".graph/t/events.jsonl"),
      "utf-8",
    );
    expect(events).toContain("node_deleted");
    expect(events).toContain("与 v2 设计冲突");
  });

  it("缺省 reason：行为保持现状（响应无 reason，归档无 deleted_reason）", async () => {
    const r = await client.callTool({
      name: "graph_delete_node",
      arguments: { id: "b" },
    });
    expect(r.isError).toBeFalsy();
    const text = (r.content![0] as { type: string; text: string }).text;
    expect(text).not.toContain('"reason"');
    const deleted = fs.readFileSync(
      path.join(tmpDir, ".graph/t/nodes/b.deleted.yaml"),
      "utf-8",
    );
    expect(deleted).not.toContain("deleted_reason");
  });
});
