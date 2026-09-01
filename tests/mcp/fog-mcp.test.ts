// tests/mcp/fog-mcp.test.ts — F04/F05/F17（adr_0007，0.9.0）MCP 通道：
// graph_update_graph 的 fog/class 参数（zod 校验 + 非法值 isError）、
// graph_graduate_fog 毕业工具、graph_get_next_actions 雾区概要透出、
// graph_validate 雾区提示（ok=true 不阻止）。
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

describe("F04/F05/F17 雾区机器面（MCP 通道）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-fog-mcp-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id r1 --label 研究票`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("F04 graph_update_graph 登记 fog + class；get_next_actions 透出雾区概要", async () => {
    const r = await client.callTool({
      name: "graph_update_graph",
      arguments: {
        fog: { id: "ra", description: "发布链", graduation: "清单成文", ignited: ["r1"] },
        class: "program",
      },
    });
    expect(r.isError).toBeFalsy();
    const body = parseBody(r.content![0].text);
    expect(body.fog).toEqual({ id: "ra", description: "发布链", graduation: "清单成文", ignited: ["r1"] });
    expect(body.class).toBe("program");
    const next = parseBody(
      (await client.callTool({ name: "graph_get_next_actions", arguments: {} })).content![0].text,
    );
    expect(next.fog.id).toBe("ra");
  });

  it("F04 非法 class / 缺 graduation 的 fog → 协议或写前校验拒绝（isError）", async () => {
    const badClass = await client.callTool({
      name: "graph_update_graph",
      arguments: { class: "huge" },
    });
    expect(badClass.isError).toBe(true);
    const badFog = await client.callTool({
      name: "graph_update_graph",
      arguments: { fog: { id: "x", description: "d" } },
    });
    expect(badFog.isError).toBe(true);
  });

  it("F17 graph_validate 雾区提示在 warnings 且 ok=true（只提示不阻止）", async () => {
    const v = parseBody(
      (await client.callTool({ name: "graph_validate", arguments: {} })).content![0].text,
    );
    expect(v.ok).toBe(true);
    expect(v.warnings.some((w: string) => w.includes("未毕业雾区 ra"))).toBe(true);
    expect(v.warnings.some((w: string) => w.includes("清单成文"))).toBe(true);
  });

  it("F05 graph_graduate_fog 毕业：清除 fog + fog_graduated 事件；无雾 isError", async () => {
    const r = await client.callTool({
      name: "graph_graduate_fog",
      arguments: { produced: ["r1"], reason: "清单成文" },
    });
    expect(r.isError).toBeFalsy();
    const body = parseBody(r.content![0].text);
    expect(body.graduated).toBe("ra");
    expect(body.produced).toEqual(["r1"]);
    const ev = parseBody(
      (
        await client.callTool({ name: "graph_events", arguments: { kind: "fog_graduated" } })
      ).content![0].text,
    );
    expect(ev.events).toHaveLength(1);
    expect(ev.events[0].detail).toContain("fog=ra");
    expect(ev.events[0].detail).toContain("produced=r1");
    // 毕业后：next 不再透出 fog；validate 提示消失；再毕业 isError
    const next = parseBody(
      (await client.callTool({ name: "graph_get_next_actions", arguments: {} })).content![0].text,
    );
    expect(next.fog).toBeUndefined();
    const again = await client.callTool({ name: "graph_graduate_fog", arguments: {} });
    expect(again.isError).toBe(true);
  });
});
