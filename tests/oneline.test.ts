// tests/oneline.test.ts — F18（0.9.4）单行状态（graph status --oneline）双通道
//
// 覆盖面：
//   1. CLI 文本通道：--oneline 恰出一行（图名/进度计数/前沿 ready/健康度计数，
//      cancelled 仅非零出现；空图 0/0 也成立）；
//   2. CLI JSON 通道：--json --oneline 附加 oneline + workflow 同款字段，
//      与文本行逐字一致（同源 formatOneline）；
//   3. MCP 承载：不新增工具——graph_list_graphs 增 oneline 旗标（每份图摘要
//      附加 oneline + workflow 字段），缺省旗标时两字段不出现（读面零污染）；
//   4. 双通道等价金测：同一图上 CLI stdout 行 === MCP oneline 字段——锁定
//      src/cli/status.ts formatOneline 与 src/mcp/server.ts 呈现层副本不漂移
//      （文件边界受限不能下沉 core，等价性必须由本测试兜住）。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

const SDK = "@modelcontextprotocol/sdk";
const CLI = path.resolve("dist/cli/index.js");

async function connectServer(cwd: string) {
  const { Client } = await import(`${SDK}/client/index.js`);
  const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.resolve("dist/mcp/server.js")],
    cwd,
  });
  const client = new Client({ name: "test", version: "0.9.4" });
  await client.connect(transport);
  return client;
}

function text(r: { content: { type: string; text?: string }[] }): any {
  return JSON.parse(r.content[0].text!);
}

// 夹具六节点：1 passed / 1 ready / 1 running / 1 failed / 1 pending / 1 cancelled
// → 1/6 passed（百分比四舍五入 17%）、cancelled 非零触发行尾附加段
const ONELINE_X = "oneline-x 1/6 passed (17%)｜ready 1｜running 1｜failed 1｜blocked 0｜cancelled 1";
const ONELINE_EMPTY = "oneline-empty 0/0 passed (0%)｜ready 0｜running 0｜failed 0｜blocked 0";

describe("F18 graph status --oneline 双通道", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>> | null = null;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-oneline-"));
    const run = (args: string) => execSync(`node "${CLI}" ${args}`, { cwd: tmpDir, encoding: "utf-8" });
    run("init oneline-x -l 单行夹具");
    for (const id of ["a", "b", "c", "d", "e", "f"]) run(`create-node --id ${id} -l "节点${id}"`);
    // a: pending→ready→running→passed（passed 硬门禁要求执行报告——用 MCP 通道补交接单）
    run("update-status -i a -s ready");
    run("update-status -i a -s running");
    // b: 留在 ready（前沿）
    run("update-status -i b -s ready");
    // c: 推进到 running（在途）
    run("update-status -i c -s ready");
    run("update-status -i c -s running");
    // d: 走到 failed（健康度负项）
    run("update-status -i d -s ready");
    run("update-status -i d -s running");
    run("update-status -i d -s failed");
    // e: 留在 pending；f: pending→cancelled（行尾附加段触发）
    run("update-status -i f -s cancelled");
    client = await connectServer(tmpDir);
    await client.callTool({
      name: "graph_update_execution_report",
      arguments: { node_id: "a", summary: "oneline 夹具交接单" },
    });
    run("update-status -i a -s passed");
    // 第二张空图（0/0 边界 + MCP 多图列举）
    run("init oneline-empty -l 空图");
  });

  afterAll(async () => {
    await client?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("CLI 文本通道：--oneline 恰出一行且关键计数在场", () => {
    const out = execSync(`node "${CLI}" status --oneline --graph oneline-x`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    const lines = out.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(ONELINE_X);
    // 关键健康度字段逐项在场（进度/前沿/负项）
    expect(lines[0]).toContain("oneline-x ");
    expect(lines[0]).toContain("1/6 passed");
    expect(lines[0]).toContain("ready 1");
    expect(lines[0]).toContain("failed 1");
  });

  it("CLI 文本通道：空图 0/0 不除零、整行仍成立", () => {
    const out = execSync(`node "${CLI}" status --oneline --graph oneline-empty`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(out.trimEnd().split("\n")).toHaveLength(1);
    expect(out.trimEnd()).toBe(ONELINE_EMPTY);
  });

  it("CLI JSON 通道：--json --oneline 附加 oneline + workflow（与文本行逐字一致）", () => {
    const raw = execSync(`node "${CLI}" status --json --oneline --graph oneline-x`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    const body = JSON.parse(raw);
    expect(body.oneline).toBe(ONELINE_X);
    expect(body.workflow).toEqual({
      total: 6,
      pending: 1,
      ready: 1,
      running: 1,
      passed: 1,
      failed: 1,
      blocked: 0,
      cancelled: 1,
    });
    // 既有读面不受影响（by_status 仍是调度口径、知识顶点豁免口径不变）
    expect(body.by_status.passed).toBe(1);
    expect(body.nodes).toBe(6);
  });

  it("MCP 承载：graph_list_graphs {oneline:true} 每份摘要附加 oneline + workflow", async () => {
    const r = await client!.callTool({ name: "graph_list_graphs", arguments: { oneline: true } });
    const body = text(r);
    const x = body.graphs.find((g: any) => g.name === "oneline-x");
    const empty = body.graphs.find((g: any) => g.name === "oneline-empty");
    expect(x.oneline).toBe(ONELINE_X);
    expect(x.workflow.total).toBe(6);
    expect(x.workflow.cancelled).toBe(1);
    expect(empty.oneline).toBe(ONELINE_EMPTY);
    expect(empty.workflow.total).toBe(0);
  });

  it("MCP 承载：带 name 定点查询同样附加；缺省旗标时 oneline/workflow 不出现", async () => {
    const named = await client!.callTool({
      name: "graph_list_graphs",
      arguments: { name: "oneline-x", oneline: true },
    });
    expect(text(named).oneline).toBe(ONELINE_X);

    const plain = await client!.callTool({ name: "graph_list_graphs", arguments: {} });
    for (const g of text(plain).graphs) {
      expect(g.oneline).toBeUndefined();
      expect(g.workflow).toBeUndefined();
    }
  });

  it("双通道等价金测：同一图上 CLI stdout 行 === MCP oneline 字段（副本防漂移）", async () => {
    const cliOut = execSync(`node "${CLI}" status --oneline --graph oneline-x`, {
      cwd: tmpDir,
      encoding: "utf-8",
    }).trimEnd();
    const r = await client!.callTool({
      name: "graph_list_graphs",
      arguments: { name: "oneline-x", oneline: true },
    });
    expect(text(r).oneline).toBe(cliOut);
  });
});
