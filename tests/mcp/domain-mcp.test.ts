// tests/mcp/domain-mcp.test.ts — v0.5 规格 D E2E：graph_create_adr、领域参数、
// claim 响应 governing_adrs、ADR 状态机经 MCP、rel_kind/contract
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
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverJs],
    cwd,
  });
  const client = new Client({ name: "test", version: "0.1.1" });
  await client.connect(transport);
  return client;
}

function text(r: { content: { type: string; text?: string }[] }): any {
  return JSON.parse(r.content[0].text!);
}

describe("MCP v0.5 领域语义", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>> | null = null;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-mcp-v5-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id t1 --label T1`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("graph_create_adr：自动编号 + proposed + 完整字段", async () => {
    const r = await client!.callTool({
      name: "graph_create_adr",
      arguments: {
        title: "纯文件存储",
        decision: "YAML 落盘不用数据库",
        why: "Git 是唯一真相源",
      },
    });
    expect(r.isError).toBeFalsy();
    const adr = text(r);
    expect(adr.id).toBe("adr_0001");
    expect(adr.status).toBe("proposed");
    expect(adr.type).toBe("adr");
    expect(adr.label).toBe("纯文件存储");
  });

  it("graph_update_node 领域参数：set_context/boundary/glossary_add", async () => {
    const create = await client!.callTool({
      name: "graph_create_node",
      arguments: { id: "ctx_1", label: "订单上下文", type: "context" },
    });
    expect(create.isError).toBeFalsy();

    const r = await client!.callTool({
      name: "graph_update_node",
      arguments: {
        id: "ctx_1",
        boundary: "订单生命周期；不含计费",
        glossary_add: [{ term: "订单", definition: "购买单据" }],
      },
    });
    expect(r.isError).toBeFalsy();
    const yaml = fs.readFileSync(path.join(tmpDir, ".graph/t/nodes/ctx_1.yaml"), "utf-8");
    expect(yaml).toContain("boundary: 订单生命周期；不含计费");
    expect(yaml).toContain("term: 订单");

    const r2 = await client!.callTool({
      name: "graph_update_node",
      arguments: { id: "t1", set_context: "ctx_1" },
    });
    expect(r2.isError).toBeFalsy();
    expect(text(r2).context).toBe("ctx_1");
  });

  it("graph_add_edge：decides + relates(rel_kind) + 契约 contract", async () => {
    const d = await client!.callTool({
      name: "graph_add_edge",
      arguments: { id: "d1", source: "adr_0001", target: "t1", type: "decides" },
    });
    expect(d.isError).toBeFalsy();

    const rel = await client!.callTool({
      name: "graph_add_edge",
      arguments: { id: "r1", source: "ctx_1", target: "ctx_1", type: "relates", rel_kind: "self" },
    });
    // relates 两端都是 ctx_1 → schema 层合法
    expect(rel.isError).toBeFalsy();
  });

  it("ADR 状态机经 MCP：accept 生效；superseded 两步法（先设 superseded_by 再置状态）", async () => {
    const acc = await client!.callTool({
      name: "graph_update_node_status",
      arguments: { id: "adr_0001", status: "accepted" },
    });
    expect(acc.isError).toBeFalsy();
    expect(text(acc).status).toBe("accepted");

    // 缺接替者直接置 superseded → 协议错误
    const bad = await client!.callTool({
      name: "graph_update_node_status",
      arguments: { id: "adr_0001", status: "superseded" },
    });
    expect(bad.isError).toBe(true);

    // 两步法：先 graph_update_node 设 superseded_by，再置 superseded
    await client!.callTool({
      name: "graph_create_adr",
      arguments: { title: "新决策", decision: "接替者" },
    });
    await client!.callTool({
      name: "graph_update_node_status",
      arguments: { id: "adr_0002", status: "accepted" },
    });
    const step1 = await client!.callTool({
      name: "graph_update_node",
      arguments: { id: "adr_0001", superseded_by: "adr_0002" },
    });
    expect(step1.isError).toBeFalsy();
    const step2 = await client!.callTool({
      name: "graph_update_node_status",
      arguments: { id: "adr_0001", status: "superseded" },
    });
    expect(step2.isError).toBeFalsy();
    expect(text(step2).superseded_by).toBe("adr_0002");
  });

  it("claim 响应附 governing_adrs（decides 指向该节点的 ADR）", async () => {
    // t1 被 adr_0001（已 superseded）decides；先建一个 accepted ADR decides t1
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" create-node --id t2 --label T2`, { cwd: tmpDir });
    execSync(`node "${cli}" update-status --id t2 --status ready`, { cwd: tmpDir });
    execSync(`node "${cli}" adr create --title "管 t2" --decision "d"`, { cwd: tmpDir });
    execSync(`node "${cli}" adr accept --id adr_0003`, { cwd: tmpDir });
    execSync(`node "${cli}" add-edge --id d2 --source adr_0003 --target t2 --type decides`, { cwd: tmpDir });

    const r = await client!.callTool({
      name: "graph_update_node_status",
      arguments: { id: "t2", status: "running", claim_by: "test-agent" },
    });
    expect(r.isError).toBeFalsy();
    const body = text(r);
    expect(body.governing_adrs).toBeDefined();
    expect(body.governing_adrs.current.map((a: any) => a.id)).toContain("adr_0003");
    // adr_0001 已 superseded 且 decides t1（非 t2）——不在此响应
  });

  it("graph_get_node 响应含 governing_adrs（t1 被 superseded adr_0001 decides）", async () => {
    const r = await client!.callTool({
      name: "graph_get_node",
      arguments: { id: "t1" },
    });
    const body = text(r);
    expect(body.governing_adrs).toBeDefined();
    expect(body.governing_adrs.superseded.map((a: any) => a.id)).toContain("adr_0001");
  });

  it("next-actions：知识顶点不进桶；t1 带 adr_flags", async () => {
    const r = await client!.callTool({
      name: "graph_get_next_actions",
      arguments: {},
    });
    const body = text(r);
    const ids = [
      ...body.ready, ...body.ready_eligible, ...body.blocked, ...body.running,
    ].map((e: any) => e.id);
    expect(ids).not.toContain("ctx_1");
    expect(ids).not.toContain("adr_0001");
    // t1（被 superseded adr_0001 decides）应带 adr_flags
    const t1Entry = [...body.ready_eligible, ...body.blocked].find((e: any) => e.id === "t1");
    expect(t1Entry?.adr_flags?.[0]).toContain("决策依据已过时");
  });
});
