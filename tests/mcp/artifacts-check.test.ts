// tests/mcp/artifacts-check.test.ts
// S0-4 回归：graph_update_execution_report 的 artifacts 存在性核验。
// 此前工具描述承诺 "verification 层会实际检查它们存在" 但实现没有检查——
// 协议承诺与实现背离。修复后响应返回 artifacts_check: [{path, exists}]，
// 相对路径按工作区根解析；工具描述与实现一致（可断言）。
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

describe("graph_update_execution_report artifacts 存在性核验（S0-4）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-artcheck-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id n1 --label N1`, { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, "proof.txt"), "真实产物", "utf-8");
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ART-01 存在/不存在路径的 exists 如实返回（相对路径按工作区根解析）", async () => {
    const r = await client.callTool({
      name: "graph_update_execution_report",
      arguments: {
        node_id: "n1",
        summary: "完成",
        artifacts: ["proof.txt", "no-such.bin", "src"],
      },
    });
    expect(r.isError).toBeFalsy();
    const text = (r.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.artifacts_check).toEqual([
      { path: "proof.txt", exists: true },
      { path: "no-such.bin", exists: false },
      { path: "src", exists: false }, // 相对工作区根（非进程 cwd）解析
    ]);
  });

  it("ART-02 绝对路径按原样核验", async () => {
    const abs = path.join(tmpDir, "proof.txt");
    const missingAbs = path.join(tmpDir, "ghost.txt");
    const r = await client.callTool({
      name: "graph_update_execution_report",
      arguments: { node_id: "n1", summary: "绝对路径", artifacts: [abs, missingAbs] },
    });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    expect(parsed.artifacts_check).toEqual([
      { path: abs, exists: true },
      { path: missingAbs, exists: false },
    ]);
  });

  it("ART-03 不带 artifacts 时响应不含 artifacts_check（原行为无回归）", async () => {
    const r = await client.callTool({
      name: "graph_update_execution_report",
      arguments: { node_id: "n1", summary: "无产物" },
    });
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    expect(parsed.artifacts_check).toBeUndefined();
    expect(parsed.id).toBe("n1");
    expect(parsed.execution_report.summary).toBe("无产物");
  });

  it("ART-04 工具描述与实现一致（描述声明 artifacts_check 行为）", async () => {
    const tools = await client.listTools();
    const t = tools.tools.find((x) => x.name === "graph_update_execution_report");
    expect(t).toBeDefined();
    expect(t!.description).toContain("artifacts_check");
    expect(t!.description).not.toContain("verification 层会实际检查它们存在");
  });
});
