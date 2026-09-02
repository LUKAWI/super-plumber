// tests/mcp/class-command-mcp.test.ts — v091-class-command（adr_0016）MCP 通道：
// graph_update_graph 的 by 凭据参数（缺省 agent / 用户直发 user）、class_changed
// 事件两态（graph_events 可查）、雾/档矛盾 nudge 注入与静默两态
// （graph_validate 警告 + graph_get_next_actions class_nudge）。
// 断言针对 dist 构建（vitest 前置 npm run build），与既有 MCP 测试同构。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

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

// Windows shell 会剥掉内联 JSON 的引号——setup 统一走 spawnSync 参数数组（不经 shell）
function runCli(cwd: string, args: string[]): void {
  const cli = path.resolve(process.cwd(), "dist/cli/index.js");
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`setup 失败: ${r.stderr}`);
}

describe("v091 档位凭据与雾/档矛盾 nudge（MCP 通道）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-class-mcp-"));
    runCli(tmpDir, ["init", "t"]);
    runCli(tmpDir, ["create-node", "--id", "r1", "--label", "研究票"]);
    runCli(tmpDir, [
      "update-graph",
      "--set-fog",
      '{"id":"ra","description":"发布链","graduation":"清单成文"}',
    ]);
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("graph_update_graph：class quick 缺省 by=agent 落 class_changed（from 缺省）", async () => {
    const r = await client.callTool({
      name: "graph_update_graph",
      arguments: { class: "quick" },
    });
    expect(r.isError).toBeFalsy();
    const ev = parseBody(
      (await client.callTool({ name: "graph_events", arguments: { kind: "class_changed" } })).content![0].text,
    );
    expect(ev.events).toHaveLength(1);
    expect(ev.events[0].to).toBe("quick");
    expect(ev.events[0].from).toBeUndefined();
    expect(ev.events[0].by).toBe("agent");
  });

  it("注入两态：nudge 在 graph_validate 警告与 graph_get_next_actions；--by user 升档后均静默", async () => {
    // agent 缺省凭据 → validate 警告 + next class_nudge 双注入
    const v1 = parseBody(
      (await client.callTool({ name: "graph_validate", arguments: {} })).content![0].text,
    );
    expect(v1.ok).toBe(true);
    const nudge = v1.warnings.find((w: string) => w.includes("update-graph --class program"));
    expect(nudge).toBeDefined();
    expect(nudge).toContain("未毕业雾区 ra");
    expect(nudge).toContain("quick");
    const n1 = parseBody(
      (await client.callTool({ name: "graph_get_next_actions", arguments: {} })).content![0].text,
    );
    expect(n1.class_nudge).toBeDefined();
    expect(n1.class_nudge).toContain("ra");
    // 用户直发凭据（--by user）→ validate + next 均静默，事件血统 by=user
    const r2 = await client.callTool({
      name: "graph_update_graph",
      arguments: { class: "standard", by: "user" },
    });
    expect(r2.isError).toBeFalsy();
    const v2 = parseBody(
      (await client.callTool({ name: "graph_validate", arguments: {} })).content![0].text,
    );
    expect(v2.warnings.some((w: string) => w.includes("update-graph --class program"))).toBe(false);
    expect(v2.warnings.some((w: string) => w.includes("未毕业雾区 ra"))).toBe(true);
    const n2 = parseBody(
      (await client.callTool({ name: "graph_get_next_actions", arguments: {} })).content![0].text,
    );
    expect(n2.class_nudge).toBeUndefined();
    const ev = parseBody(
      (await client.callTool({ name: "graph_events", arguments: { kind: "class_changed" } })).content![0].text,
    );
    expect(ev.events).toHaveLength(2);
    expect(ev.events[1]).toMatchObject({ from: "quick", to: "standard", by: "user" });
  });
});
