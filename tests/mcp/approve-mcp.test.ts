// tests/mcp/approve-mcp.test.ts — DEC-1（g080-approve-core）：graph_approve 工具
// MCP 通道：zod 校验（by 必填、status 枚举 approved|self 缺省 approved）、
// 响应回显 review 与图名、claim 响应的 review_flag 条件注入（有凭据不出现）。
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

describe("DEC-1 graph_approve（MCP 通道）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-approve-mcp-"));
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

  it("AP-01 工具已注册（graph_approve 在列）", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("graph_approve");
  });

  it("AP-02 图未审核时 claim 响应注入 review_flag='unreviewed'（仅提示，认领成功）", async () => {
    const rReady = await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "a", status: "ready" },
    });
    expect(rReady.isError).toBeFalsy();
    const r = await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "a", status: "running", claim_by: "agent-x" },
    });
    expect(r.isError).toBeFalsy(); // 零门禁：未审核不拦截 claim
    const body = parseBody(r.content![0].text);
    expect(body.graph).toBe("t");
    expect(body.review_flag).toBe("unreviewed");
    expect(body.node.status).toBe("running");
  });

  it("AP-03 缺 by → 协议错误（isError）", async () => {
    const r = await client.callTool({
      name: "graph_approve",
      arguments: { status: "approved" },
    });
    expect(r.isError).toBe(true);
  });

  it("AP-04 非法 status → 协议错误（isError）", async () => {
    const r = await client.callTool({
      name: "graph_approve",
      arguments: { by: "alice", status: "maybe" },
    });
    expect(r.isError).toBe(true);
  });

  it("AP-05 status 缺省 approved：响应回显 review 与图名，凭据落盘 + 事件可查", async () => {
    const r = await client.callTool({
      name: "graph_approve",
      arguments: { by: "alice" },
    });
    expect(r.isError).toBeFalsy();
    const body = parseBody(r.content![0].text);
    expect(body.graph).toBe("t");
    expect(body.review.status).toBe("approved");
    expect(body.review.by).toBe("alice");
    expect(body.review.at).toBeTruthy();
    // 真相源核验：graph.yaml 落盘
    const yaml = fs.readFileSync(path.join(tmpDir, ".graph/t/graph.yaml"), "utf-8");
    expect(yaml).toContain("status: approved");
    expect(yaml).toContain("by: alice");
    // 审计事件（经 graph_events MCP 通道）
    const ev = parseBody(
      (
        await client.callTool({
          name: "graph_events",
          arguments: { kind: "design_approved" },
        })
      ).content![0].text,
    );
    expect(ev.events).toHaveLength(1);
    expect(ev.events[0].actor).toBe("alice");
    expect(ev.events[0].detail).toContain("status=approved");
  });

  it("AP-06 审核后 claim 响应不再出现 review_flag", async () => {
    const rReady = await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "b", status: "ready" },
    });
    expect(rReady.isError).toBeFalsy();
    const r = await client.callTool({
      name: "graph_update_node_status",
      arguments: { id: "b", status: "running", claim_by: "agent-y" },
    });
    expect(r.isError).toBeFalsy();
    const text = r.content![0].text;
    expect(text).not.toContain("review_flag");
  });

  it("AP-07 status=self（quick 自签）可区分并覆盖旧凭据", async () => {
    const r = await client.callTool({
      name: "graph_approve",
      arguments: { by: "quick-op", status: "self" },
    });
    expect(r.isError).toBeFalsy();
    const body = parseBody(r.content![0].text);
    expect(body.review.status).toBe("self");
    expect(body.review.by).toBe("quick-op");
    const yaml = fs.readFileSync(path.join(tmpDir, ".graph/t/graph.yaml"), "utf-8");
    expect(yaml).toContain("status: self");
    // 事件追加为第二条（覆盖凭据但事件 append-only）
    const ev = parseBody(
      (
        await client.callTool({
          name: "graph_events",
          arguments: { kind: "design_approved" },
        })
      ).content![0].text,
    );
    expect(ev.events).toHaveLength(2);
    expect(ev.events[1].detail).toContain("status=self");
  });

  it("AP-08 graph_get_next_actions：审核后 ready_eligible 条目无 review_flag", async () => {
    execSync(`node "${path.resolve(process.cwd(), "dist/cli/index.js")}" create-node --id c --label C`, {
      cwd: tmpDir,
    });
    const r = await client.callTool({
      name: "graph_get_next_actions",
      arguments: {},
    });
    const body = parseBody(r.content![0].text);
    expect(body.ready_eligible.map((n: any) => n.id)).toContain("c");
    expect(JSON.stringify(body.ready_eligible)).not.toContain("review_flag");
  });
});
