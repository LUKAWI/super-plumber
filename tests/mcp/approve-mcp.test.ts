// tests/mcp/approve-mcp.test.ts — DEC-1（g080-approve-core）：graph_approve 工具
// MCP 通道：zod 校验（by 必填、status 枚举 approved|self 缺省 approved）、
// 响应回显 review 与图名、claim 响应的 review_flag 条件注入（仅 approved 不出现）。
// 断言针对 dist 构建（vitest 前置 npm run build），与既有 MCP 测试同构。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { REVIEW_FLAG_UNREVIEWED } from "../../src/core/scheduler.js";

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

  it("AP-02 图未审核时 claim 响应注入定稿文案 review_flag（仅提示，认领成功）", async () => {
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
    expect(body.review_flag).toBe(REVIEW_FLAG_UNREVIEWED);
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

  it("AP-08 graph_get_next_actions：审核后结构修订（create-node）→ review_flag 重新亮起（F21 回置）", async () => {
    execSync(`node "${path.resolve(process.cwd(), "dist/cli/index.js")}" create-node --id c --label C`, {
      cwd: tmpDir,
    });
    const r = await client.callTool({
      name: "graph_get_next_actions",
      arguments: {},
    });
    const body = parseBody(r.content![0].text);
    expect(body.ready_eligible.map((n: any) => n.id)).toContain("c");
    // F21（DEC-7）：审核后发生结构修订（create-node）→ review 回置 unreviewed，
    // ready_eligible 的 review_flag nudge 重新亮起走增量人审（仅提示，零门禁）
    const c = body.ready_eligible.find((n: any) => n.id === "c");
    expect(c?.review_flag).toBe(REVIEW_FLAG_UNREVIEWED);
  });

  // ── F08（0.9.2 渐进审批）：level 分层批准（MCP 通道）──
  it("AP-09 level=L1：响应回显 review.layers + yaml 落盘 + 事件 detail 含 level=L1（零拒绝：本图无 class 标注）", async () => {
    const r = await client.callTool({
      name: "graph_approve",
      arguments: { by: "alice", level: "L1" },
    });
    expect(r.isError).toBeFalsy();
    const body = parseBody(r.content![0].text);
    expect(body.review.status).toBe("approved");
    expect(body.review.layers).toHaveLength(1);
    expect(body.review.layers[0].level).toBe("L1");
    expect(body.review.layers[0].by).toBe("alice");
    expect(body.review.layers[0].at).toBeTruthy();
    // 真相源核验：graph.yaml 落盘
    const yaml = fs.readFileSync(path.join(tmpDir, ".graph/t/graph.yaml"), "utf-8");
    expect(yaml).toContain("layers:");
    expect(yaml).toContain("level: L1");
    // 审计事件（经 graph_events MCP 通道）
    const ev = parseBody(
      (
        await client.callTool({
          name: "graph_events",
          arguments: { kind: "design_approved" },
        })
      ).content![0].text,
    );
    const last = ev.events[ev.events.length - 1];
    expect(last.detail).toContain("level=L1");
    expect(last.actor).toBe("alice");
  });

  it("AP-10 多层追加 + 同层覆盖：L2 追加保持顺序，L1 重批原位更新（仍 2 条）", async () => {
    await client.callTool({ name: "graph_approve", arguments: { by: "bob", level: "L2" } });
    const r = await client.callTool({ name: "graph_approve", arguments: { by: "carol", level: "L1" } });
    expect(r.isError).toBeFalsy();
    const body = parseBody(r.content![0].text);
    expect(body.review.layers.map((l: any) => l.level)).toEqual(["L1", "L2"]);
    expect(body.review.layers[0].by).toBe("carol");
    // 真相源核验
    const yaml = fs.readFileSync(path.join(tmpDir, ".graph/t/graph.yaml"), "utf-8");
    expect(yaml).toContain("level: L2");
    expect(yaml).toContain("by: carol");
  });

  it("AP-11 不带 level 的整图 approve 行为回归不变：覆盖清掉 layers（最新一次审核生效）", async () => {
    const r = await client.callTool({ name: "graph_approve", arguments: { by: "boss" } });
    expect(r.isError).toBeFalsy();
    const body = parseBody(r.content![0].text);
    expect(body.review.status).toBe("approved");
    expect(body.review.layers).toBeUndefined();
    const yaml = fs.readFileSync(path.join(tmpDir, ".graph/t/graph.yaml"), "utf-8");
    expect(yaml).not.toContain("layers:");
  });

  it("AP-12 空 level → 协议错误（isError，zod min(1)）", async () => {
    const r = await client.callTool({
      name: "graph_approve",
      arguments: { by: "alice", level: "" },
    });
    expect(r.isError).toBe(true);
  });

  it("AP-13 status=self：MCP next 仍保留 review_flag，明确 approved 才消除", async () => {
    const created = await client.callTool({
      name: "graph_create_node",
      arguments: { id: "self-check", label: "Self check" },
    });
    expect(created.isError).toBeFalsy();

    const approved = await client.callTool({
      name: "graph_approve",
      arguments: { by: "quick-op", status: "self" },
    });
    expect(approved.isError).toBeFalsy();

    const next = await client.callTool({ name: "graph_get_next_actions", arguments: {} });
    const body = parseBody(next.content![0].text);
    const selfCheck = body.ready_eligible.find((n: any) => n.id === "self-check");
    expect(selfCheck?.review_flag).toBe(REVIEW_FLAG_UNREVIEWED);
  });
});
