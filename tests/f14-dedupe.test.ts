// tests/f14-dedupe.test.ts — f14（S3-2/S3-3）纯重构的零行为变化对照测试。
// S3-2：MCP graphBriefOf 与 CLI summarize 合一（cli/graph-ops.ts 唯一实现）后，
//   双通道摘要输出与**合并前**捕获的 golden（下方字面量，取自重构前 dist 的
//   实测输出，2026-08-25 f14 修复前基线）逐字段、含键序完全一致；
//   fixture 覆盖多图布局 + 旧布局 default（graphDirOf 两条分支）与空图边界。
// S3-3：updateExecutionReport 审计事件 kind 由显式 if/else 分支写入——带
//   verification 恒为 verdict、否则恒为 execution_report，且事件键集/键序与
//   重构前（后键覆盖前键）逐字节一致。
// 依赖 dist：先 npm run build（与 tests/mcp/multigraph-mcp.test.ts 同约定）。
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { createNode, updateExecutionReport } from "../src/core/node.js";
import { readEvents } from "../src/core/eventlog.js";
import { NodeType } from "../src/core/types.js";

// ═══════════ S3-3：verdict kind 恒定（in-process，直击 core）═══════════

describe("S3-3 updateExecutionReport kind 显式分支", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f14-evt-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("带 verification：事件 kind 恒为 verdict（键集与键序不变）", () => {
    createNode(tmpDir, { id: "v1", type: NodeType.Task, label: "V" });
    updateExecutionReport(
      tmpDir,
      "v1",
      {
        summary: "完成",
        verification: { verdict: "passed", checked_at: "2026-01-01T00:00:00.000Z", note: "抽查通过" },
      },
      { actor: "f14-tester" },
    );
    const events = readEvents(tmpDir, { node: "v1" });
    const last = events[events.length - 1] as Record<string, unknown>;
    delete last.ts; // 时间戳不定，其余须逐字节一致（含键序：actor,kind,node,detail）
    expect(last.kind).toBe("verdict");
    expect(JSON.stringify(last)).toBe(
      '{"actor":"f14-tester","kind":"verdict","node":"v1","detail":"verdict=passed"}',
    );
  });

  it("不带 verification：kind 恒为 execution_report，无 detail 键", () => {
    createNode(tmpDir, { id: "e1", type: NodeType.Task, label: "E" });
    updateExecutionReport(tmpDir, "e1", { summary: "报告" }, { actor: "f14-tester" });
    const events = readEvents(tmpDir, { node: "e1" });
    const last = events[events.length - 1] as Record<string, unknown>;
    delete last.ts;
    expect(last.kind).toBe("execution_report");
    expect(JSON.stringify(last)).toBe(
      '{"actor":"f14-tester","kind":"execution_report","node":"e1"}',
    );
  });

  it("同节点混合上报：每次事件按当次调用取 kind，互不渗透", () => {
    createNode(tmpDir, { id: "m1", type: NodeType.Task, label: "M" });
    updateExecutionReport(tmpDir, "m1", { summary: "a" }, { actor: "f14-tester" });
    updateExecutionReport(
      tmpDir,
      "m1",
      { summary: "b", verification: { verdict: "failed", checked_at: "2026-01-01T00:00:00.000Z" } },
      { actor: "f14-tester" },
    );
    updateExecutionReport(tmpDir, "m1", { summary: "c" }, { actor: "f14-tester" });
    const kinds = readEvents(tmpDir, { node: "m1" })
      .filter((e) => e.kind === "execution_report" || e.kind === "verdict")
      .map((e) => `${e.kind}:${e.detail ?? "-"}`);
    expect(kinds).toEqual([
      "execution_report:-",
      "verdict:verdict=failed",
      "execution_report:-",
    ]);
  });
});

// ═══════════ S3-2：摘要合并等价（E2E，golden = 合并前实测）═══════════

const CLI_PATH = path.resolve("dist/cli/index.js");
const NL = String.fromCharCode(10);
// 合并前 golden（重构前 dist 捕获；键序即序列化序，不得变动）
const GOLDEN_ALPHA =
  '{"name":"alpha","label":"甲图","nodeCount":3,"edgeCount":1,"running":1,"passed":1,"lastActivity":"2026-01-03T00:00:03.000Z","isCurrent":true}';
const GOLDEN_BETA_IN_LIST =
  '{"name":"beta","label":"乙图","nodeCount":0,"edgeCount":0,"running":0,"passed":0,"lastActivity":null,"isCurrent":false}';
const GOLDEN_BETA_AS_CURRENT = GOLDEN_BETA_IN_LIST.replace('"isCurrent":false', '"isCurrent":true');
const GOLDEN_LEGACY =
  '{"name":"default","label":"旧布局图","nodeCount":1,"edgeCount":0,"running":0,"passed":1,"lastActivity":"2026-01-04T00:00:04.000Z","isCurrent":true}';

const STAMPS = [
  "2026-01-01T00:00:01.000Z",
  "2026-01-02T00:00:02.000Z",
  "2026-01-03T00:00:03.000Z",
  "2026-01-04T00:00:04.000Z",
  "2026-01-05T00:00:05.000Z",
];

function buildFixtures(): { wsA: string; wsL: string } {
  const wsA = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f14-a-"));
  const wsL = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f14-l-"));
  const run = (cwd: string, args: string[]) =>
    execSync(["node", JSON.stringify(CLI_PATH), ...args].join(" "), { cwd, encoding: "utf-8" });

  // WS-A：多图布局（alpha 3 节点 1 边 / beta 空图）
  run(wsA, ["init", "alpha", "-l", "甲图"]);
  run(wsA, ["create-node", "-i", "n1", "-l", "节点一"]);
  run(wsA, ["create-node", "-i", "n2", "-l", "节点二"]);
  run(wsA, ["create-node", "-i", "n3", "-l", "节点三"]);
  run(wsA, ["update-status", "-i", "n1", "-s", "ready"]);
  run(wsA, ["update-status", "-i", "n1", "-s", "running", "--claim-by", "agent-x"]);
  run(wsA, ["update-status", "-i", "n2", "-s", "ready"]);
  run(wsA, ["update-status", "-i", "n2", "-s", "running", "--claim-by", "agent-x"]);
  const n2p = path.join(wsA, ".graph", "alpha", "nodes", "n2.yaml");
  fs.writeFileSync(
    n2p,
    fs.readFileSync(n2p, "utf-8").replace(/^  summary: ..$/m, "  summary: 完成"),
    "utf-8",
  );
  run(wsA, ["update-status", "-i", "n2", "-s", "passed"]);
  run(wsA, ["add-edge", "-i", "e1", "-s", "n1", "-t", "n2", "--type", "depends_on"]);
  run(wsA, ["init", "beta", "-l", "乙图"]);
  run(wsA, ["switch", "alpha"]);

  // WS-L：纯旧布局（.graph/graph.yaml 原地 + 1 个 passed 节点）
  fs.mkdirSync(path.join(wsL, ".graph", "nodes"), { recursive: true });
  fs.mkdirSync(path.join(wsL, ".graph", "edges"), { recursive: true });
  fs.writeFileSync(
    path.join(wsL, ".graph", "graph.yaml"),
    [
      "id: g_legacy", "label: 旧布局图", "entry:", '  description: ""', "  defined_by: human", "  level: 0",
      "exit:", '  description: ""', "  acceptance_criteria: []", "  defined_by: human", "  level: 0",
      "nodes: []", "edges: []",
    ].join(NL) + NL,
    "utf-8",
  );
  fs.copyFileSync(n2p, path.join(wsL, ".graph", "nodes", "d1.yaml"));
  const d1 = fs
    .readFileSync(path.join(wsL, ".graph", "nodes", "d1.yaml"), "utf-8")
    .replace(/^id: n2$/m, "id: d1")
    .replace(/^label: .*$/m, "label: 旧布局节点");
  fs.writeFileSync(path.join(wsL, ".graph", "nodes", "d1.yaml"), d1, "utf-8");

  // 时间戳固定化（与 golden 捕获时同序：alpha 的 n1/n2/n3，legacy 的 d1）
  let i = 0;
  const fix = (ws: string, dir: string) => {
    const p = path.join(ws, ".graph", dir, "nodes");
    if (!fs.existsSync(p)) return;
    for (const f of fs.readdirSync(p).filter((x) => x.endsWith(".yaml") && !x.includes(".deleted")).sort()) {
      const fp = path.join(p, f);
      fs.writeFileSync(
        fp,
        fs.readFileSync(fp, "utf-8").replace(/^updated_at: .*$/m, `updated_at: "${STAMPS[i++ % STAMPS.length]}"`),
        "utf-8",
      );
    }
  };
  fix(wsA, "alpha");
  fix(wsA, "beta");
  fix(wsL, "");
  return { wsA, wsL };
}

async function connectServer(cwd: string) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.resolve("dist/mcp/server.js")],
    cwd,
  });
  const client = new Client({ name: "f14-test", version: "0" });
  await client.connect(transport);
  return client;
}

describe("S3-2 摘要合并等价（MCP graphBriefOf ≡ CLI summarize ≡ 合并前 golden）", () => {
  let wsA: string;
  let wsL: string;
  let cA: Awaited<ReturnType<typeof connectServer>> | null = null;
  let cL: Awaited<ReturnType<typeof connectServer>> | null = null;

  beforeAll(async () => {
    ({ wsA, wsL } = buildFixtures());
    cA = await connectServer(wsA);
    cL = await connectServer(wsL);
  });

  afterAll(async () => {
    await cA?.close();
    await cL?.close();
    fs.rmSync(wsA, { recursive: true, force: true });
    fs.rmSync(wsL, { recursive: true, force: true });
  });

  const call = async (client: NonNullable<typeof cA>, name: string, args: object) =>
    JSON.parse((await client.callTool({ name, arguments: args })).content[0].text! as string);

  it("MCP 多图列举：graphs 逐条与合并前 golden 含键序一致", async () => {
    const body = await call(cA!, "graph_list_graphs", {});
    expect(body.current).toBe("alpha");
    expect(body.graphs.map((g: unknown) => JSON.stringify(g))).toEqual([
      GOLDEN_ALPHA,
      GOLDEN_BETA_IN_LIST,
    ]);
  });

  it("MCP 指定图详情 + 切换摘要：合并前 golden 含键序一致", async () => {
    const detail = await call(cA!, "graph_list_graphs", { name: "beta" });
    expect(JSON.stringify({ ...detail, graph: "" })).toBe(
      `{"graph":"","name":"beta","label":"乙图","nodeCount":0,"edgeCount":0,"running":0,"passed":0,"lastActivity":null,"isCurrent":false}`,
    );
    const sw = await call(cA!, "graph_switch", { name: "beta" });
    expect(sw.switched).toEqual({ from: "alpha", to: "beta", persistent: false, effective: true });
    expect(JSON.stringify(sw.summary)).toBe(GOLDEN_BETA_AS_CURRENT);
    expect(sw.notes).toEqual(["原图 alpha 有 1 个 running 节点在途（切换不影响它们继续执行）"]);
  });

  it("MCP 旧布局 default：graphDirOf 旧布局分支下摘要与 golden 一致", async () => {
    const body = await call(cL!, "graph_list_graphs", {});
    expect(body.graphs.map((g: unknown) => JSON.stringify(g))).toEqual([GOLDEN_LEGACY]);
    const sw = await call(cL!, "graph_switch", { name: "default" });
    expect(JSON.stringify(sw.summary)).toBe(GOLDEN_LEGACY);
  });

  it("CLI list --json 与 MCP 同构：同一共享实现的双通道输出一致", async () => {
    const cliA = JSON.parse(
      execSync(["node", JSON.stringify(CLI_PATH), "list", "--json"].join(" "), {
        cwd: wsA,
        encoding: "utf-8",
      }),
    );
    // 上一用例已把 cA 进程切到 beta——新起进程回落工作区默认（alpha），与 CLI 同源
    const cA2 = await connectServer(wsA);
    try {
      const mcpA = await call(cA2, "graph_list_graphs", {});
      expect(cliA.current).toBe(mcpA.current);
      expect(cliA.graphs.map((g: unknown) => JSON.stringify(g))).toEqual(
        mcpA.graphs.map((g: unknown) => JSON.stringify(g)),
      );
    } finally {
      await cA2.close();
    }
    // 旧布局：CLI named 详情走同一目录判定（dir 指向 .graph 原地）
    const cliL = JSON.parse(
      execSync(["node", JSON.stringify(CLI_PATH), "list", "default", "--json"].join(" "), {
        cwd: wsL,
        encoding: "utf-8",
      }),
    );
    const { dir, ...brief } = cliL;
    expect(JSON.stringify(brief)).toBe(GOLDEN_LEGACY);
    expect(path.resolve(dir)).toBe(path.resolve(path.join(wsL, ".graph")));
  });
});
