// tests/mcp/tools-coverage.test.ts
// f10 回归（S2-1）：MCP 通道补 graph_validate / graph_events。
// 前者让 agent 在批量创建/crash recovery 后有自检手段（环/幽灵边/schema 汇总/领域规则/引用漂移），
// 后者让裁决 agent 能回溯审计日志（claim/force_override/attempts_reset）。
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

describe("f10 MCP 工具补全（S2-1）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f10-"));
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

  it("TC-01 工具注册数与头注释一致（26 个，0.9.0 增 graph_graduate_fog；validate/events/approve 在列）", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(tools.tools.length).toBe(26);
    expect(names).toContain("graph_validate");
    expect(names).toContain("graph_events");
    expect(names).toContain("graph_approve");
    expect(names).toContain("graph_graduate_fog");
  });

  it("TC-02 干净小图 graph_validate → ok=true 无错误", async () => {
    const r = await client.callTool({ name: "graph_validate", arguments: {} });
    expect(r.isError).toBeFalsy();
    const body = parseBody(r.content![0].text);
    expect(body.ok).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.node_count).toBeGreaterThanOrEqual(2);
  });

  it("TC-03 环 + 幽灵边 → ok=false，errors 含循环依赖与幽灵端点", async () => {
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" add-edge --id ab --source a --target b --type depends_on`, { cwd: tmpDir });
    execSync(`node "${cli}" add-edge --id ba --source b --target a --type depends_on`, { cwd: tmpDir });
    // 幽灵边：核心层会拒绝，手写文件模拟手编/崩溃残留
    const ghost = `id: e-ghost\nsource: missing-node\ntarget: a\ntype: depends_on\n`;
    fs.writeFileSync(path.join(tmpDir, ".graph/t/edges/e-ghost.yaml"), ghost, "utf-8");

    const r = await client.callTool({ name: "graph_validate", arguments: {} });
    const body = parseBody(r.content![0].text);
    expect(body.ok).toBe(false);
    expect(body.errors.some((e: string) => e.includes("循环依赖"))).toBe(true);
    expect(body.errors.some((e: string) => e.includes("不存在的源节点") && e.includes("missing-node"))).toBe(true);
  });

  it("TC-04 引用列表漂移（文件在、引用无）→ 中性警告可自愈", async () => {
    // TC-03 的 e-ghost 在目录但不在 graph.yaml 引用列表 → 双向漂移警告
    const r = await client.callTool({ name: "graph_validate", arguments: {} });
    const body = parseBody(r.content![0].text);
    expect(
      body.warnings.some((w: string) => w.includes("e-ghost") && w.includes("漂移")),
    ).toBe(true);
  });

  it("TC-05 graph_events 返回审计事件，node/kind 过滤与 last 生效", async () => {
    // 造几条事件：claim 无边节点 c（a/b 已被 TC-03 的环边互锁 ready 门禁）
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" create-node --id c --label C`, { cwd: tmpDir });
    const r1 = await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "c", status: "ready" },
    });
    expect(r1.isError).toBeFalsy();
    const r2 = await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "c", status: "running", claim_by: "agent-f10" },
    });
    expect(r2.isError).toBeFalsy();

    const all = parseBody(
      (await client.callTool({ name: "graph_events", arguments: {} })).content![0].text,
    );
    expect(all.total).toBeGreaterThan(0);
    expect(all.events.some((e: any) => e.kind === "node_created")).toBe(true);

    const byNode = parseBody(
      (
        await client.callTool({ name: "graph_events", arguments: { node: "c" } })
      ).content![0].text,
    );
    expect(byNode.events.every((e: any) => e.node === "c")).toBe(true);
    expect(byNode.events.some((e: any) => e.kind === "node_status")).toBe(true);

    const byKind = parseBody(
      (
        await client.callTool({ name: "graph_events", arguments: { kind: "node_created" } })
      ).content![0].text,
    );
    expect(byKind.events.every((e: any) => e.kind === "node_created")).toBe(true);

    const last1 = parseBody(
      (
        await client.callTool({ name: "graph_events", arguments: { last: 1 } })
      ).content![0].text,
    );
    expect(last1.events).toHaveLength(1);
  });
});
