// tests/cli/phase2.test.ts — Phase 2 新命令的 CLI 集成测试
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-p2-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: tmpDir,
    encoding: "utf-8",
  });
}

function runOk(args: string[]): string {
  const r = run(args);
  expect(r.status, `命令失败: ${args.join(" ")}\n${r.stderr}`).toBe(0);
  return r.stdout;
}

function init() {
  runOk(["init",
        "t", "-l", "P2 测试图"]);
}

describe("graph update-graph", () => {
  it("设置 entry/exit/验收标准并回读", () => {
    init();
    runOk(["update-graph", "--entry-desc", "入口需求"]);
    runOk(["update-graph", "--exit-desc", "交付标准"]);
    runOk(["update-graph", "--add-criteria", "c1", "--add-criteria", "c2"]);
    const content = fs.readFileSync(path.join(tmpDir, ".graph/t/graph.yaml"), "utf-8");
    expect(content).toContain("入口需求");
    expect(content).toContain("交付标准");
    expect(content).toContain("c1");
    expect(content).toContain("c2");
    // validate 不再警告 entry/exit 为空
    const v = run(["validate"]);
    expect(v.stdout).not.toContain("描述为空");
  });

  it("--clear-criteria 清空验收标准", () => {
    init();
    runOk(["update-graph", "--add-criteria", "c1"]);
    runOk(["update-graph", "--clear-criteria"]);
    const content = fs.readFileSync(path.join(tmpDir, ".graph/t/graph.yaml"), "utf-8");
    expect(content).not.toContain("c1");
  });

  it("--set-context 非法 JSON → exit 1", () => {
    init();
    const r = run(["update-graph", "--set-context", "{bad"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("JSON");
  });

  it("未 init → exit 1 友好报错", () => {
    const r = run(["update-graph", "--label", "x"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("init", "t");
  });
});

describe("graph get-node", () => {
  it("--json 输出含 allowed_transitions 与门禁状态", () => {
    init();
    runOk(["create-node", "-i", "a", "-l", "A"]);
    const out = runOk(["get-node", "-i", "a", "--json"]);
    const data = JSON.parse(out) as {
      node: { id: string };
      allowed_transitions: string[];
      ready_gate: { ok: boolean };
    };
    expect(data.node.id).toBe("a");
    expect(data.allowed_transitions).toContain("ready");
    expect(data.ready_gate.ok).toBe(true);
  });

  it("不存在节点 → exit 1", () => {
    init();
    const r = run(["get-node", "-i", "ghost"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("不存在");
  });
});

describe("graph verdict", () => {
  it("写入 verification 并拒绝非法 verdict", () => {
    init();
    runOk(["create-node", "-i", "a", "-l", "A"]);
    runOk(["verdict", "-i", "a", "--verdict", "failed", "--note", "产物缺失"]);
    const content = fs.readFileSync(path.join(tmpDir, ".graph/t/nodes/a.yaml"), "utf-8");
    expect(content).toContain("verdict: failed");
    expect(content).toContain("产物缺失");
    const bad = run(["verdict", "-i", "a", "--verdict", "maybe"]);
    expect(bad.status).toBe(1);
  });
});

describe("graph next", () => {
  it("--json 输出 ready/blocked/running 结构", () => {
    init();
    runOk(["create-node", "-i", "a", "-l", "A"]);
    runOk(["create-node", "-i", "b", "-l", "B"]);
    runOk(["add-edge", "-i", "e1", "-s", "a", "-t", "b"]);
    runOk(["update-status", "-i", "a", "-s", "ready"]);
    const out = runOk(["next", "--json"]);
    const data = JSON.parse(out) as {
      ready: { id: string }[];
      blocked: { id: string; unmet: { id: string }[] }[];
      summary: { total: number };
    };
    expect(data.ready.map((n) => n.id)).toEqual(["a"]);
    expect(data.blocked.map((n) => n.id)).toEqual(["b"]);
    expect(data.blocked[0].unmet[0].id).toBe("a");
    expect(data.summary.total).toBe(2);
  });
});

describe("graph status --json / validate --json", () => {
  it("status --json 输出结构化状态且拓扑失败退出非 0", () => {
    init();
    runOk(["create-node", "-i", "a", "-l", "A"]);
    const out = runOk(["status", "--json"]);
    const data = JSON.parse(out) as { label: string; nodes: number; topo: { ok: boolean } };
    expect(data.label).toBe("P2 测试图");
    expect(data.nodes).toBe(1);
    expect(data.topo.ok).toBe(true);
  });

  it("validate --json 输出结构化错误列表", () => {
    init();
    runOk(["create-node", "-i", "a", "-l", "A"]);
    runOk(["create-node", "-i", "b", "-l", "B"]);
    runOk(["add-edge", "-i", "e1", "-s", "a", "-t", "b"]);
    runOk(["add-edge", "-i", "e2", "-s", "b", "-t", "a"]);
    const r = run(["validate", "--json"]);
    expect(r.status).toBe(1);
    const data = JSON.parse(r.stdout) as { ok: boolean; errors: string[] };
    expect(data.ok).toBe(false);
    expect(data.errors.some((e) => e.includes("循环依赖"))).toBe(true);
  });
});

describe("graph snapshot / snapshots / diff / rollback", () => {
  it("快照→修改→diff→回滚 全流程", () => {
    init();
    runOk(["update-graph", "--entry-desc", "e", "--exit-desc", "x", "--add-criteria", "c1"]);
    runOk(["create-node", "-i", "a", "-l", "A"]);
    const snapOut = runOk(["snapshot", "-m", "v1"]);
    const snapId = snapOut.trim().split("\n")[0].split(":")[1].trim();

    // 修改：改状态 + 增节点（F21 起 create-node 前会自动快照——该自动快照即
    // "最新快照"、成为 diff 的 from 基线；先增节点后改状态，保证基线里 a 仍是
    // pending，下方 modified/status_changes 断言与 F21 前语义一致）
    runOk(["create-node", "-i", "b", "-l", "B"]);
    runOk(["update-status", "-i", "a", "-s", "ready"]);

    // diff：最新快照 vs working
    const diffOut = runOk(["diff", "--json"]);
    const diff = JSON.parse(diffOut) as {
      added: string[];
      modified: string[];
      status_changes: { node: string }[];
    };
    expect(diff.added).toContain("nodes/b.yaml");
    expect(diff.modified).toContain("nodes/a.yaml");
    expect(diff.status_changes.some((c) => c.node === "a")).toBe(true);

    // rollback 无 confirm 拒绝
    const noConfirm = run(["rollback", snapId]);
    expect(noConfirm.status).toBe(1);
    expect(noConfirm.stderr).toContain("confirm");

    // rollback 确认
    const rb = run(["rollback", snapId, "--confirm"]);
    expect(rb.status).toBe(0);
    expect(rb.stdout).toContain("已回滚");
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/nodes/b.yaml"))).toBe(false);
    const aContent = fs.readFileSync(path.join(tmpDir, ".graph/t/nodes/a.yaml"), "utf-8");
    expect(aContent).toContain("status: pending");

    // 快照列表含 pre-rollback 备份
    const listOut = runOk(["snapshots", "--json"]);
    const list = JSON.parse(listOut) as { id: string; message?: string }[];
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.some((s) => s.message?.includes("pre-rollback"))).toBe(true);
  });
});
