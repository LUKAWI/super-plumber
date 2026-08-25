// tests/mcp/checkpoint-zod.test.ts
// S3-12 回归（MCP 通道）：checkpoint 的 id/label 空 zod 收紧（.min(1)）。
// 此前 MCP 允许空 id/label 的 checkpoint 落盘（CLI 却校验）——空 id 无法被
// update_checkpoint 寻址、空 label 在裁决报告中不可读。协议层即拒，双通道对齐。
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

describe("MCP checkpoint zod 收紧（S3-12）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-cpzod-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id n1 --label N1`, { cwd: tmpDir });
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

  it("CPZ-01 graph_create_node 空 id 的 checkpoint 被拒", async () => {
    const text = await callErr("graph_create_node", {
      id: "bad1",
      label: "x",
      checkpoints: [{ id: "", label: "空 id" }],
    });
    expect(text).toMatch(/id|checkpoint/i);
  });

  it("CPZ-02 graph_create_node 空 label 的 checkpoint 被拒", async () => {
    const text = await callErr("graph_create_node", {
      id: "bad2",
      label: "x",
      checkpoints: [{ id: "cp1", label: "" }],
    });
    expect(text).toMatch(/label|checkpoint/i);
  });

  it("CPZ-03 graph_update_node add_checkpoints 空 label 被拒", async () => {
    const text = await callErr("graph_update_node", {
      id: "n1",
      add_checkpoints: [{ id: "cp9", label: "" }],
    });
    expect(text).toMatch(/label|checkpoint/i);
  });

  it("CPZ-04 graph_batch_create 空 id 的 checkpoint 被拒", async () => {
    const text = await callErr("graph_batch_create", {
      nodes: [{ id: "b1", label: "x", checkpoints: [{ id: "", label: "空" }] }],
    });
    expect(text).toMatch(/id|checkpoint/i);
  });

  it("CPZ-05 合法 checkpoint 照常创建（不误伤）", async () => {
    const r = await client.callTool({
      name: "graph_create_node",
      arguments: {
        id: "ok1",
        label: "正常",
        checkpoints: [{ id: "cp1", label: "第一步" }],
      },
    });
    expect(r.isError).toBeFalsy();
  });
});
