// tests/mcp/semantics.test.ts
// f11 回归（S2-2/S2-3/S2-11/S2-12）：MCP 语义修复。
// S2-2 graph_switch 在 env 压制下如实上报；S2-3 diff from 缺省一律最新快照（CLI+MCP）；
// S2-11 审计 actor 透传真实身份；S2-12 幂等 re-claim 留审计痕迹。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

const SDK = "@modelcontextprotocol/sdk";

async function connectServer(cwd: string, env?: Record<string, string>) {
  const { Client } = await import(`${SDK}/client/index.js`);
  const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);
  const serverJs = path.resolve(process.cwd(), "dist/mcp/server.js");
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverJs],
    cwd,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  const client = new Client({ name: "test-client-f11", version: "0.1.1" });
  await client.connect(transport);
  return client;
}

function parseBody(r: { content?: { text?: string }[] }): Record<string, any> {
  return JSON.parse(r.content![0].text!);
}

describe("f11 MCP 语义修复", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f11-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    execSync(`node "${cli}" init u`, { cwd: tmpDir });
    execSync(`node "${cli}" switch t`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id c --label C`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("SEM-01 S2-2 env 压制下 graph_switch 如实上报未生效（不再假成功）", async () => {
    const pinned = await connectServer(tmpDir, { SUPER_PLUMBER_GRAPH: "t" });
    try {
      const r = parseBody(
        await pinned.callTool({ name: "graph_switch", arguments: { name: "u" } }),
      );
      expect(r.switched.effective).toBe(false);
      expect(r.switched.to).toBe("u");
      expect(
        (r.notes as string[]).some((n) => n.includes("未生效") && n.includes("SUPER_PLUMBER_GRAPH")),
      ).toBe(true);
      // 实际目标图仍是 t（env 压制）
      const cur = parseBody(
        await pinned.callTool({ name: "graph_switch", arguments: {} }),
      );
      expect(cur.current.name).toBe("t");
      expect(cur.current.source).toBe("env");
    } finally {
      await pinned.close();
    }
  });

  it("SEM-02 S2-3 graph_diff {to: snapX} 的 from 回填为最新快照（非 working）", async () => {
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" snapshot -m s1`, { cwd: tmpDir });
    execSync(`node "${cli}" update-node --id c --label C2`, { cwd: tmpDir });
    execSync(`node "${cli}" snapshot -m s2`, { cwd: tmpDir });
    const snaps = JSON.parse(
      execSync(`node "${cli}" snapshots --json`, { cwd: tmpDir }).toString(),
    ) as { id: string }[];
    expect(snaps.length).toBeGreaterThanOrEqual(2);
    const oldest = snaps[0].id;
    const latest = snaps[snaps.length - 1].id;

    const r = parseBody(
      await client.callTool({ name: "graph_diff", arguments: { to: oldest } }),
    );
    // 修复前：from === "working"；修复后：from = 最新快照
    expect(r.from).toBe(latest);
    expect(r.to).toBe(oldest);
  });

  it("SEM-03 S2-3 CLI 同构：diff --to snapX 的 from 为最新快照", () => {
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    const snaps = JSON.parse(
      execSync(`node "${cli}" snapshots --json`, { cwd: tmpDir }).toString(),
    ) as { id: string }[];
    const out = JSON.parse(
      execSync(`node "${cli}" diff --to ${snaps[0].id} --json`, { cwd: tmpDir }).toString(),
    );
    expect(out.from).toBe(snaps[snaps.length - 1].id);
  });

  it("SEM-04 S2-11 审计 actor 透传：claim_by 落 actor，普通写操作落 client 名", async () => {
    const r1 = parseBody(
      await client.callTool({
        name: "graph_update_node_status",
        arguments: { id: "c", status: "ready" },
      }),
    );
    expect(r1.node?.status ?? r1.status).toBeTruthy();
    await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "c", status: "running", claim_by: "agent-f11" },
    });
    const ev = parseBody(
      await client.callTool({
        name: "graph_events",
        arguments: { node: "c", kind: "node_status" },
      }),
    );
    const claim = ev.events.filter((e: any) => e.to === "running");
    expect(claim.length).toBeGreaterThan(0);
    expect(claim[claim.length - 1].actor).toBe("agent-f11");

    // 普通写操作：actor = MCP client 名（本测试连接名 test-client-f11），非 "mcp"
    await client.callTool({
      name: "graph_create_node",
      arguments: { id: "d", label: "D" },
    });
    const created = parseBody(
      await client.callTool({
        name: "graph_events",
        arguments: { kind: "node_created" },
      }),
    );
    const evC = created.events.find((e: any) => e.node === "d");
    expect(evC.actor).toBe("test-client-f11");
  });

  it("SEM-05 S2-12 幂等 re-claim 留审计痕迹", async () => {
    const again = await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "c", status: "running", claim_by: "agent-f11" },
    });
    expect(again.isError).toBeFalsy(); // 幂等成功
    const ev = parseBody(
      await client.callTool({
        name: "graph_events",
        arguments: { node: "c" },
      }),
    );
    expect(
      ev.events.some(
        (e: any) => e.kind === "node_status" && String(e.detail).includes("幂等 re-claim"),
      ),
    ).toBe(true);
  });
});
