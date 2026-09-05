// v0.9.6 Snapshot 路径隔离与多图 MCP 回归。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");
const SDK = "@modelcontextprotocol/sdk";

function runCli(cwd: string, args: string[]): void {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`CLI setup failed (${result.status}): ${result.stderr}`);
  }
}

async function connectServer(cwd: string) {
  const { Client } = await import(`${SDK}/client/index.js`);
  const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);
  const serverJs = path.resolve(process.cwd(), "dist/mcp/server.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverJs, "--root", cwd],
    cwd,
  });
  const client = new Client({ name: "snapshot-integrity-test", version: "0.9.6" });
  await client.connect(transport);
  return client;
}

function body(result: { content: { type: string; text?: string }[] }): Record<string, any> {
  return JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}");
}

describe("v0.9.6 snapshot integrity（MCP 通道）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-snapshot-mcp-"));
    runCli(tmpDir, ["init", "g1", "-l", "图一"]);
    runCli(tmpDir, ["create-node", "-i", "a", "-l", "A", "--graph", "g1"]);
    runCli(tmpDir, ["init", "g2", "-l", "图二"]);
    runCli(tmpDir, ["create-node", "-i", "b", "-l", "B", "--graph", "g2"]);
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("graph_rollback / graph_diff 拒绝 traversal snapshot id，不触碰图外文件", async () => {
    const switched = await client.callTool({ name: "graph_switch", arguments: { name: "g1" } });
    expect(switched.isError).toBeFalsy();
    const snap = await client.callTool({ name: "graph_snapshot", arguments: { message: "MCP 基线" } });
    expect(snap.isError).toBeFalsy();
    const snapshotId = body(snap).id as string;

    const outside = path.join(tmpDir, "..", `${path.basename(tmpDir)}-mcp-outside.txt`);
    fs.writeFileSync(outside, "sentinel", "utf-8");
    try {
      const diff = await client.callTool({
        name: "graph_diff",
        arguments: { from: "../../mcp-outside", to: "working" },
      });
      expect(diff.isError).toBe(true);
      expect(diff.content.map((item) => item.type === "text" ? item.text : "").join("\n")).toMatch(/快照 ID/);

      const rollback = await client.callTool({
        name: "graph_rollback",
        arguments: { snapshot_id: "../../mcp-outside", confirm: true },
      });
      expect(rollback.isError).toBe(true);
      expect(rollback.content.map((item) => item.type === "text" ? item.text : "").join("\n")).toMatch(/快照 ID/);
      expect(fs.readFileSync(outside, "utf-8")).toBe("sentinel");
    } finally {
      fs.rmSync(outside, { force: true });
    }

    // 显式 confirm 仍是 MCP 的必要语义。
    const noConfirm = await client.callTool({
      name: "graph_rollback",
      arguments: { snapshot_id: snapshotId },
    });
    expect(noConfirm.isError).toBe(true);
  });

  it("graph_switch 后不能跨图回滚，目标图保持不变", async () => {
    await client.callTool({ name: "graph_switch", arguments: { name: "g1" } });
    const snap = await client.callTool({ name: "graph_snapshot", arguments: { message: "g1-only" } });
    expect(snap.isError).toBeFalsy();
    const snapshotId = body(snap).id as string;

    const switched = await client.callTool({ name: "graph_switch", arguments: { name: "g2" } });
    expect(switched.isError).toBeFalsy();
    const cross = await client.callTool({
      name: "graph_rollback",
      arguments: { snapshot_id: snapshotId, confirm: true },
    });
    expect(cross.isError).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, ".graph", "g2", "nodes", "b.yaml"), "utf-8")).toContain("id: b");
  });
});
