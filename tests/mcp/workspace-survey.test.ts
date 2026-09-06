import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");

async function connectServer(cwd: string) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/mcp/server.js")],
    cwd,
  });
  const client = new Client({ name: "workspace-survey-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

function body(result: { content: { type: string; text?: string }[] }): any {
  return JSON.parse(result.content[0].text!);
}

describe("MCP 多图读面", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-workspace-survey-mcp-"));
    execSync(`node "${CLI}" init alpha -l "甲图"`, { cwd: tmpDir });
    execSync(`node "${CLI}" create-node -i alpha-task -l "甲任务"`, { cwd: tmpDir });
    execSync(`node "${CLI}" init beta -l "乙图"`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("graph_get_next_actions all_graphs 返回带图名的聚合", async () => {
    const result = await client.callTool({
      name: "graph_get_next_actions",
      arguments: { all_graphs: true },
    });
    const data = body(result);
    expect(data.graphs.map((g: { graph: string }) => g.graph)).toEqual(["alpha", "beta"]);
    expect(data.graphs.find((g: { graph: string }) => g.graph === "alpha").label).toBe("甲图");
  });

  it("graph_survey 返回三项巡检与临时报告路径", async () => {
    const result = await client.callTool({ name: "graph_survey", arguments: {} });
    const data = body(result);
    expect(data.graphs).toHaveLength(2);
    expect(data.graphs[0]).toHaveProperty("blocked");
    expect(data.graphs[0]).toHaveProperty("stale");
    expect(data.graphs[0]).toHaveProperty("adr_conflicts");
    expect(fs.existsSync(data.report_path)).toBe(true);
  });
});
