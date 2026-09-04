// tests/cli/sp-traverse-script.test.ts
// IL-017 + S03 八脚本收敛：sp.mjs traverse 子命令（原 sp-traverse.mjs 单文件退役）语义收编
// ——输出 ≡ MCP graph_traverse（IL-003 形状）：
// { nodes, truncated, truncated_by_depth, truncated_by_nodes } JSON 一行；
// max_depth 缺省 3、上限 50（传 60 也只到 50）；两类截断如实上报，不静默缺失。
// 测试方式：进程级 spawn 脚本（与 tests/cli 既有组织方式一致），
// 图夹具经 src/core createNode/createEdge 程序化构建（与 tests/core 一致）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { createNode } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { NodeType, EdgeType } from "../../src/core/types.js";

const SCRIPT_PATH = path.resolve("integrations", "src", "sp-scripts", "sp.mjs");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-sp-traverse-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(args: string[]): ScriptResult {
  const res = spawnSync(process.execPath, [SCRIPT_PATH, "traverse", ...args], {
    cwd: tmpDir,
    encoding: "utf-8",
  });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function parseJson(res: ScriptResult): any {
  return JSON.parse(res.stdout);
}

function addNode(id: string): void {
  createNode(tmpDir, { id, type: NodeType.Task, label: id });
}

function addEdge(id: string, source: string, target: string): void {
  createEdge(tmpDir, { id, source, target, type: EdgeType.DependsOn });
}

/** 链 c00→c01→…→c(n-1)，另加旁支 br→c(挂点)，与 tests/mcp/traverse-depth.test.ts 夹具同构 */
function buildChain(n: number, branchTo?: number): string[] {
  const ids = Array.from({ length: n }, (_, i) => `c${String(i).padStart(2, "0")}`);
  for (const id of ids) addNode(id);
  for (let i = 0; i < ids.length - 1; i++) addEdge(`e${String(i).padStart(2, "0")}`, ids[i], ids[i + 1]);
  if (branchTo !== undefined) {
    addNode("br");
    addEdge("ebr", "br", `c${String(branchTo).padStart(2, "0")}`);
  }
  return ids;
}

describe("IL-017 sp.mjs traverse 子命令语义 ≡ MCP graph_traverse（S03 八脚本收敛后）", () => {
  it("缺省用法：max_depth=3，nodes 为 DFS 有序列表，深度截断如实上报", () => {
    buildChain(33, 15);
    const res = runScript(["c00"]);
    expect(res.status).toBe(0);
    const out = parseJson(res);
    expect(out.nodes).toEqual(["c00", "c01", "c02", "c03"]); // 有序列表，恰 4 节点
    expect(out.truncated).toBe(true);
    expect(out.truncated_by_depth).toBe(true);
    expect(out.truncated_by_nodes).toBe(false);
  });

  it("深链 max_depth=20 截断于 c20 且如实上报（≡ MCP IL-003 用例）", () => {
    buildChain(33, 15);
    const out = parseJson(runScript(["c00", "downstream", "20"]));
    expect(out.nodes[out.nodes.length - 1]).toBe("c20");
    expect(out.nodes).not.toContain("c32");
    expect(out.truncated).toBe(true);
    expect(out.truncated_by_depth).toBe(true);
    expect(out.truncated_by_nodes).toBe(false);
  });

  it("max_depth=50 一次到末端：33 节点全收，无任何截断", () => {
    buildChain(33, 15);
    const out = parseJson(runScript(["c00", "downstream", "50"]));
    expect(out.nodes).toHaveLength(33);
    expect(out.nodes).toContain("c32");
    expect(out.truncated).toBe(false);
    expect(out.truncated_by_depth).toBe(false);
    expect(out.truncated_by_nodes).toBe(false);
  });

  it("DoD：max_depth 上限 50——传 60 也只到 50（59 跳链截断于 c50）", () => {
    const ids = buildChain(60); // c00..c59，59 跳
    const out = parseJson(runScript([ids[0], "downstream", "60"]));
    expect(out.nodes).toHaveLength(51); // 深度 0..50
    expect(out.nodes[out.nodes.length - 1]).toBe("c50");
    expect(out.nodes).not.toContain("c51");
    expect(out.truncated).toBe(true);
    expect(out.truncated_by_depth).toBe(true);
    expect(out.truncated_by_nodes).toBe(false);
    // 对照：传 59 同样被收敛到 50（上限语义，而非恰好放行到入参值）
    const out59 = parseJson(runScript([ids[0], "downstream", "59"]));
    expect(out59.nodes).toHaveLength(51);
    expect(out59.truncated_by_depth).toBe(true);
  });

  it("DoD：max_nodes 截断如实上报 truncated_by_nodes（211 节点星形，200 截断）", () => {
    addNode("root");
    for (let i = 0; i < 210; i++) {
      const id = `leaf${String(i).padStart(3, "0")}`;
      addNode(id);
      addEdge(`el${String(i).padStart(3, "0")}`, "root", id);
    }
    const out = parseJson(runScript(["root", "downstream", "50"]));
    expect(out.nodes).toHaveLength(200); // ≡ MCP max_nodes 缺省 200
    expect(out.nodes[0]).toBe("root");
    expect(out.truncated).toBe(true);
    expect(out.truncated_by_nodes).toBe(true);
    expect(out.truncated_by_depth).toBe(false);
  });

  it("upstream 方向：从链尾反向 max_depth=3 截断如实上报", () => {
    buildChain(11);
    const out = parseJson(runScript(["c10", "upstream", "3"]));
    expect(out.nodes).toEqual(["c10", "c09", "c08", "c07"]);
    expect(out.truncated_by_depth).toBe(true);
  });

  it("both 方向：菱形 a→b/a→c/b→d/c→d 四节点全收且无截断虚报", () => {
    for (const id of ["a", "b", "c", "d"]) addNode(id);
    addEdge("e1", "a", "b");
    addEdge("e2", "a", "c");
    addEdge("e3", "b", "d");
    addEdge("e4", "c", "d");
    const out = parseJson(runScript(["a", "both", "10"]));
    expect(out.nodes).toHaveLength(4);
    expect(out.nodes[0]).toBe("a");
    expect(out.nodes).toEqual(expect.arrayContaining(["a", "b", "c", "d"]));
    expect(out.truncated).toBe(false);
  });

  it("起点不存在：exit 1，明确报错（≡ MCP），stdout 无 JSON", () => {
    buildChain(3);
    const res = runScript(["nope"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Node nope not found");
    expect(() => parseJson(res)).toThrow();
  });

  it("参数校验：非法方向 / 非正整数 max_depth 被拒绝（≡ MCP zod 面）", () => {
    buildChain(3);
    expect(runScript(["c00", "sideways"]).status).toBe(1);
    expect(runScript(["c00", "downstream", "0"]).status).toBe(1);
    expect(runScript(["c00", "downstream", "abc"]).status).toBe(1);
    expect(runScript([]).status).toBe(1);
    expect(runScript([]).stderr).toContain("Usage: node sp.mjs traverse <node_id>");
  });
});
