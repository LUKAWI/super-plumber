// tests/mcp/description-contracts.test.ts
// A5 / f17：承诺-实现断言（防描述漂移）。四处清单与落点：
//   ① 工具计数注释 → 已在 tests/mcp/tools-coverage.test.ts TC-01 覆盖（25 个，graph_validate/graph_events/graph_approve 在列）
//   ② artifacts 校验承诺（S0-4）→ 已在 tests/mcp/artifacts-check.test.ts ART-01..ART-04 覆盖
//   ③ diff 默认值（S2-3）→ 已在 tests/mcp/semantics.test.ts SEM-02/SEM-03 覆盖
//   ④ fallback/iterates 文档性标注（S2-10）→ 本文件 DC-01（graph_add_edge 描述披露）
//      附加：DC-02 graph_list_graphs 描述披露"刻意不设 MCP 通道"（工作区级破坏性操作走 CLI）
// 断言针对 dist 构建（vitest 前置 npm run build），与既有 MCP 测试同构。
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

describe("A5 承诺-实现描述断言（f17）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f17-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("DC-01 S2-10 graph_add_edge 描述披露 fallback/iterates 为文档性标注（不实现运行时语义）", async () => {
    const tools = await client.listTools();
    const t = tools.tools.find((x) => x.name === "graph_add_edge");
    expect(t).toBeDefined();
    expect(t!.description).toContain("文档性标注");
    expect(t!.description).toContain("fallback/iterates");
    expect(t!.description).toContain("graph validate");
  });

  it("DC-02 graph_list_graphs 描述披露建图/删图/导出刻意不设 MCP 通道（人类走 CLI）", async () => {
    const tools = await client.listTools();
    const t = tools.tools.find((x) => x.name === "graph_list_graphs");
    expect(t).toBeDefined();
    expect(t!.description).toContain("刻意不设 MCP 通道");
  });
});
