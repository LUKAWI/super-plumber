// tests/mcp/human-flags-mcp.test.ts — F06/F07/IL-025（0.9.1）MCP 通道：
// graph_get_node 读面 requires_human（DoD #1 双通道之 MCP 侧）、
// graph_get_next_actions 桶条目透传（requires_human / waiting_human / fog_graduation_nudge）、
// claim（graph_update_node_status ready→running）响应 requires_human 槽位透出。
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

function parseBody(text: string): Record<string, any> {
  return JSON.parse(text);
}

describe("F06/F07/IL-025 人机分工机器面（MCP 通道）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-human-mcp-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("F06 graph_get_node：含未完成 human checkpoint → requires_human: true；机器票缺省", async () => {
    const mk = await client.callTool({
      name: "graph_create_node",
      arguments: {
        id: "h1",
        label: "人工票",
        checkpoints: [{ id: "cp-human", label: "人工签核", verifier: "human" }],
      },
    });
    expect(mk.isError).toBeFalsy();
    await client.callTool({
      name: "graph_create_node",
      arguments: { id: "m1", label: "机器票" },
    });

    const h = parseBody(
      (await client.callTool({ name: "graph_get_node", arguments: { id: "h1" } })).content![0].text,
    );
    expect(h.requires_human).toBe(true);
    const m = parseBody(
      (await client.callTool({ name: "graph_get_node", arguments: { id: "m1" } })).content![0].text,
    );
    expect(m.requires_human).toBeUndefined();
  });

  it("F06/F07 graph_get_next_actions：ready_eligible 条目带 requires_human + waiting_human", async () => {
    const next = parseBody(
      (await client.callTool({ name: "graph_get_next_actions", arguments: {} })).content![0].text,
    );
    const h = next.ready_eligible.find((x: { id: string }) => x.id === "h1");
    expect(h.requires_human).toBe(true);
    expect(h.waiting_human).toBe(true);
    const m = next.ready_eligible.find((x: { id: string }) => x.id === "m1");
    expect(m.requires_human).toBeUndefined();
    expect(m.waiting_human).toBeUndefined();
  });

  it("F06 claim 响应：ready→running 附 requires_human 槽位（认领者知情）", async () => {
    await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "h1", status: "ready" },
    });
    const claimed = parseBody(
      (
        await client.callTool({
          name: "graph_update_node_status",
          arguments: { id: "h1", status: "running", claim_by: "agent-1" },
        })
      ).content![0].text,
    );
    expect(claimed.requires_human).toBe(true);
  });

  it("IL-025 graph_get_next_actions：ignited 全 passed → fog_graduation_nudge 透出", async () => {
    await client.callTool({
      name: "graph_update_graph",
      arguments: {
        fog: {
          id: "ra",
          description: "发布链",
          graduation: "清单成文",
          ignited: ["m1"],
        },
      },
    });
    const before = parseBody(
      (await client.callTool({ name: "graph_get_next_actions", arguments: {} })).content![0].text,
    );
    expect(before.fog_graduation_nudge).toBeUndefined();

    // m1 票已 passed（上一用例被 h1 认领前 m1 未动；此处直接裁决 m1 passed）
    await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "m1", status: "ready" },
    });
    await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "m1", status: "running", claim_by: "agent-2" },
    });
    // 无报告标 passed 是撒谎——先交交接单再 passed
    await client.callTool({
      name: "graph_update_execution_report",
      arguments: { node_id: "m1", summary: "研究完成" },
    });
    await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "m1", status: "passed" },
    });

    const after = parseBody(
      (await client.callTool({ name: "graph_get_next_actions", arguments: {} })).content![0].text,
    );
    expect(after.fog_graduation_nudge).toBeDefined();
    expect(after.fog_graduation_nudge).toContain("ra");
    expect(after.fog_graduation_nudge).toContain("graduate-fog");
  });
});
