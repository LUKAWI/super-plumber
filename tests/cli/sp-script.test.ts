// tests/cli/sp-script.test.ts
// S03 八脚本收敛（adr_0008）：sp.mjs 单入口回归——旧 sp-{claim,update-status,checkpoint,
// report,get-node}.mjs 单文件入口退役后，子命令语义面保持：
//   - claim / update-status / get-node：调 CLI（stdio/退出码透传，语义 ≡ CLI）；
//   - checkpoint / report：单点调用核心公开 API（CLI 无对应子命令，输出形状不变）；
//   - check-design：转发同目录 sp-check-design.mjs（doctor 退出码透传）。
// 测试方式：进程级 spawn 正本 sp.mjs（integrations/src/sp-scripts/，gen 面另有 --check 比对），
// 图夹具经 src/core 程序化构建（与 tests/cli/sp-traverse-script.test.ts 同构）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { createNode } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { createGraph } from "../../src/core/graph-dir.js";
import { updateGraph } from "../../src/core/parser.js";
import { NodeType, EdgeType } from "../../src/core/types.js";

const SCRIPT_PATH = path.resolve("integrations", "src", "sp-scripts", "sp.mjs");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-sp-script-"));
  createGraph(tmpDir, "t", "sp 脚本测试图");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runSp(args: string[]): ScriptResult {
  const res = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: tmpDir,
    encoding: "utf-8",
  });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function addNode(id: string, opts: { maxAttempts?: number } = {}): void {
  createNode(tmpDir, {
    id,
    type: NodeType.Task,
    label: id,
    plan_description: "实现数据层模块",
    checkpoints: [{ id: "cp1", label: "实现", status: "pending" }],
    definition_of_done: ["模块文件在位"],
    ...(opts.maxAttempts !== undefined ? { max_attempts: opts.maxAttempts } : {}),
  });
}

describe("S03 sp.mjs 单入口：CLI 面子命令（claim / update-status / get-node）", () => {
  it("五步协议全链路走通：ready → claim → checkpoint → report → passed", () => {
    addNode("l1_a");
    expect(runSp(["update-status", "l1_a", "ready"]).status).toBe(0);
    const claim = runSp(["claim", "l1_a", "worker-a"]);
    expect(claim.status).toBe(0);
    expect(claim.stdout).toContain("running");
    const cp = runSp(["checkpoint", "l1_a", "cp1", "passed"]);
    expect(cp.status).toBe(0);
    expect(cp.stdout).toContain("✅ l1_a / cp1: passed");
    const report = runSp(["report", "l1_a", "交付完成", "a.md,b.md"]);
    expect(report.status).toBe(0);
    expect(report.stdout).toContain("execution_report saved (2 artifacts)");
    expect(runSp(["update-status", "l1_a", "passed"]).status).toBe(0);
  });

  it("claim 非 ready 节点被状态机拒绝（≡ CLI 门禁，退出码透传）", () => {
    addNode("l1_b");
    const res = runSp(["claim", "l1_b", "worker-b"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Invalid transition");
  });

  it("get-node 输出节点完整内容（≡ CLI get-node 的 JSON 面）", () => {
    addNode("l1_c");
    const res = runSp(["get-node", "l1_c"]);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.node.id).toBe("l1_c");
    expect(parsed.allowed_transitions).toBeDefined();
  });

  it("update-status --force 旗标透传（attempts 耗尽后的 failed→pending 重开必须走 force）", () => {
    addNode("l1_d", { maxAttempts: 1 });
    // 第一轮：failed→pending 重开合法，attempts 计入预算
    for (const s of ["ready", "running", "failed", "pending"] as const) {
      expect(runSp(["update-status", "l1_d", s]).status).toBe(0);
    }
    // 第二轮失败后重开：attempts 1 ≥ max 1 → 无 force 被拦截；--force 透传后重开成功
    for (const s of ["ready", "running", "failed"] as const) {
      expect(runSp(["update-status", "l1_d", s]).status).toBe(0);
    }
    expect(runSp(["update-status", "l1_d", "pending"]).status).toBe(1);
    const res = runSp(["update-status", "l1_d", "pending", "--force"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("pending");
  });
});

describe("S03 sp.mjs 单入口：核心面子命令（checkpoint / report）参数校验", () => {
  it("checkpoint 非法状态友好报错（退出码 1）", () => {
    addNode("l1_e");
    const res = runSp(["checkpoint", "l1_e", "cp1", "done"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("非法 checkpoint 状态");
    expect(res.stderr).toContain("pending, running, passed, failed, skipped");
  });

  it("checkpoint 缺参 / report 缺 summary → Usage 报错（退出码 1）", () => {
    expect(runSp(["checkpoint", "l1_e"]).status).toBe(1);
    const res = runSp(["report", "l1_e"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Usage: node sp.mjs report <node_id> <summary>");
  });
});

describe("S03 sp.mjs 单入口：check-design 转发与入口分派", () => {
  it("体检通过图：check-design --json 退出码 0，errors 为空（E1-E10 判据通道完好）", () => {
    addNode("l1_a");
    addNode("l1_b");
    createEdge(tmpDir, { id: "e1", source: "l1_a", target: "l1_b", type: EdgeType.DependsOn });
    updateGraph(tmpDir, {
      entry_description: "需求已明确",
      exit_description: "数据层交付",
      add_criteria: ["模块文件在位"],
    });
    const res = runSp(["check-design", "--json"]);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.pass).toBe(true);
    expect(parsed.errors).toHaveLength(0);
  });

  it("体检缺陷图：发现结构缺陷退出码 1（doctor 退出码透传）", () => {
    addNode("l1_a");
    const res = runSp(["check-design", "--json"]);
    expect(res.status).toBe(1);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.pass).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("无参 / 未知子命令：Usage 提示退出码 1；help 退出码 0", () => {
    expect(runSp([]).status).toBe(1);
    const unknown = runSp(["nope"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("未知子命令: nope");
    expect(runSp(["help"]).status).toBe(0);
  });
});
