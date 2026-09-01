// tests/mcp/amend-mcp.test.ts — F21（DEC-7 / adr_0006）MCP 通道：
// 结构修订（graph_create_node / graph_batch_create）自动快照 + graph_amended 事件 +
// 已审核图 review 回置 unreviewed；graph_update_node 改 passed 节点 plan 的响应 nudge
// （与 core planAmendNudge 文案全等——双通道一致性之 MCP 面）。
// 断言针对 dist 构建（vitest 前置 npm run build），与既有 MCP 测试同构。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { planAmendNudge } from "../../src/core/amend.js";

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

async function call(client: any, name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  return { raw: r, body: parseBody(r.content![0].text) };
}

/** 图目录下全部快照 manifest（读盘，不经通道） */
function snapMessages(graphDir: string): string[] {
  const dir = path.join(graphDir, "snapshots");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(dir, e.name, "manifest.json"), "utf-8"),
        ) as { message?: string };
      } catch {
        return null;
      }
    })
    .filter((m): m is { message?: string } => m !== null)
    .map((m) => m.message ?? "");
}

function amendEventsFromDisk(graphDir: string): any[] {
  const file = path.join(graphDir, "events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l))
    .filter((e) => e.kind === "graph_amended");
}

describe("F21 改图三约束（MCP 通道）", () => {
  let tmpDir: string;
  let graphDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-amend-mcp-"));
    graphDir = path.join(tmpDir, ".graph", "t");
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id a --label A`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id b --label B`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
    // 预置：图已审核（review 凭据在案）
    const r = await call(client, "graph_approve", { by: "alice" });
    expect(r.raw.isError).toBeFalsy();
  }, 60_000);

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("AM-01 graph_create_node：自动快照（说明性 message）+ graph_amended 事件 + review 回置 unreviewed", async () => {
    const r = await call(client, "graph_create_node", { id: "c", label: "C" });
    expect(r.raw.isError).toBeFalsy();

    // review 回置：只写凭据字段，review_flag nudge 重新亮起
    const yaml = fs.readFileSync(path.join(graphDir, "graph.yaml"), "utf-8");
    expect(yaml).toContain("status: unreviewed");
    expect(yaml).toContain("by: test"); // actor = MCP 客户端名（mcpActor）

    // 自动快照：message 说明性（action target by channel）
    const msgs = snapMessages(graphDir).filter((m) => m.startsWith("auto: structural amend"));
    expect(msgs).toContain("auto: structural amend (add-node c) by test");

    // 审计事件（经 graph_events 通道）：detail 带 action/target/auto_snapshot
    const ev = await call(client, "graph_events", { kind: "graph_amended" });
    expect(ev.body.events.length).toBeGreaterThanOrEqual(1);
    const evt = ev.body.events[ev.body.events.length - 1];
    expect(evt.actor).toBe("test");
    expect(evt.detail).toContain("action=add-node");
    expect(evt.detail).toContain("target=c");
    expect(evt.detail).toContain("auto_snapshot=");
  });

  it("AM-02 graph_batch_create：整批一次快照、一条 graph_amended 事件（非逐项风暴）", async () => {
    const snapsBefore = snapMessages(graphDir).filter((m) => m.startsWith("auto:")).length;
    const eventsBefore = amendEventsFromDisk(graphDir).length;

    const r = await call(client, "graph_batch_create", {
      nodes: [
        { id: "x1", label: "X1" },
        { id: "x2", label: "X2" },
      ],
      edges: [{ id: "e_x", source: "x1", target: "x2" }],
    });
    expect(r.raw.isError).toBeFalsy();

    const msgs = snapMessages(graphDir).filter((m) => m.startsWith("auto:"));
    expect(msgs).toHaveLength(snapsBefore + 1); // 整批恰一份
    expect(msgs[msgs.length - 1]).toBe(
      "auto: structural amend (batch-create; nodes=2, edges=1) by test",
    );
    const events = amendEventsFromDisk(graphDir);
    expect(events).toHaveLength(eventsBefore + 1);
    expect(events[events.length - 1].detail).toContain("action=batch-create");
  });

  it("AM-03 graph_update_node 改 passed 节点 plan：响应附 plan_amend_nudge，与 core 文案全等", async () => {
    // 预置：a 走完 passed（零门禁红线复核：nudge 不拦状态机）
    for (const args of [
      { id: "a", status: "ready" },
      { id: "a", status: "running", claim_by: "agent-x" },
    ]) {
      const r = await call(client, "graph_update_node_status", args);
      expect(r.raw.isError).toBeFalsy();
    }
    const rep = await call(client, "graph_update_execution_report", {
      node_id: "a",
      summary: "done",
    });
    expect(rep.raw.isError).toBeFalsy();
    const done = await call(client, "graph_update_node_status", { id: "a", status: "passed" });
    expect(done.raw.isError).toBeFalsy();

    const r = await call(client, "graph_update_node", {
      id: "a",
      plan_description: "结构修订后的新计划",
    });
    expect(r.raw.isError).toBeFalsy();
    expect(r.body.status).toBe("passed"); // 纯提示：状态未被改动
    const expected = planAmendNudge({ id: "a", status: "passed" }, { planChanged: true });
    expect(expected).toContain("计划已变更，是否重开/重验");
    expect(r.body.plan_amend_nudge).toBe(expected); // 双通道一致性：MCP ≡ core
  });

  it("AM-04 非 passed/blocked 节点或不涉及 plan 的更新：无 plan_amend_nudge", async () => {
    const r1 = await call(client, "graph_update_node", {
      id: "b",
      plan_description: "pending 节点改 plan",
    });
    expect(r1.body.plan_amend_nudge).toBeUndefined();
    const r2 = await call(client, "graph_update_node", { id: "a", label: "A2" });
    expect(r2.body.plan_amend_nudge).toBeUndefined(); // passed 但未改 plan
  });
});
