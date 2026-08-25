// tests/mcp/id-validation-mcp.test.ts
// S0-3 回归（MCP 通道）：LLM 供给的穿越形 ID 在 zod 协议层即拒；
// 读路径（get-node）由核心层咽喉点兜底——双通道全闭环。
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
  const transport = new StdioClientTransport({ command: "node", args: [serverJs], cwd });
  const client = new Client({ name: "test", version: "0.1.1" });
  await client.connect(transport);
  return client;
}

describe("MCP 通道实体 ID 校验（S0-3）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-idv-mcp-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id a --label A`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function callErr(name: string, args: Record<string, unknown>): Promise<string> {
    const r = await client.callTool({ name, arguments: args });
    expect(r.isError).toBeTruthy();
    return r.content.map((c: { text?: string }) => c.text ?? "").join("\n");
  }

  it("IDM-01 graph_create_node 穿越形 id → zod 协议层拒绝", async () => {
    const text = await callErr("graph_create_node", { id: "../evil", label: "x" });
    expect(text).toContain("规则");
  });

  it("IDM-02 graph_batch_create 穿越形 id → zod 拒绝", async () => {
    const text = await callErr("graph_batch_create", {
      nodes: [{ id: "a/b", label: "x" }],
    });
    expect(text).toContain("规则");
  });

  it("IDM-03 graph_add_edge 穿越形端点 → zod 拒绝", async () => {
    const text = await callErr("graph_add_edge", {
      id: "e-ok",
      source: "../../evil",
      target: "a",
      type: "depends_on",
    });
    expect(text).toContain("规则");
  });

  it("IDM-04 读路径兜底：graph_get_node 穿越形 id 被核心层拒绝", async () => {
    const text = await callErr("graph_get_node", { id: "../../etc/passwd" });
    expect(text).toContain("非法节点 ID");
  });

  it("IDM-05 合法 id 行为无回归（create + get 正常）", async () => {
    const create = await client.callTool({
      name: "graph_create_node",
      arguments: { id: "n1.deleted-check", label: "子串合法" },
    });
    expect(create.isError).toBeFalsy();
    const got = await client.callTool({ name: "graph_get_node", arguments: { id: "n1.deleted-check" } });
    expect(got.isError).toBeFalsy();
    expect((got.content[0] as { text: string }).text).toContain("n1.deleted-check");
  });
});
