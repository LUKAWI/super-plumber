// tests/cli/sp-targeting.test.ts — v0.9.7 脚本目标图公共回归
// seam 只观察 sp.mjs 的 stdout/退出码与 get-node/traverse JSON；夹具通过 core API 建立。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { createGraph, writeWorkspaceDefault } from "../../src/core/graph-dir.js";
import { createNode } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { updateGraph } from "../../src/core/parser.js";
import { EdgeType, NodeType } from "../../src/core/types.js";

const SCRIPT_PATH = path.resolve("integrations", "src", "sp-scripts", "sp.mjs");
const SCRIPT_PATHS = [
  SCRIPT_PATH,
  path.resolve("integrations", "plugin", "scripts", "sp.mjs"),
  path.resolve(".pi", "skills", "plumber-execute", "scripts", "sp.mjs"),
];
const CHECK_DESIGN_PATHS = SCRIPT_PATHS.map((scriptPath) => path.join(path.dirname(scriptPath), "sp-check-design.mjs"));

let tmpDir: string;
let alphaDir: string;
let betaDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo sp-targeting-"));
  alphaDir = createGraph(tmpDir, "alpha", "甲");
  betaDir = createGraph(tmpDir, "beta", "乙");
  addNode(alphaDir, "alpha-node");
  addNode(betaDir, "beta-node");
  writeWorkspaceDefault(tmpDir, "beta");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function addNode(root: string, id: string): void {
  createNode(root, {
    id,
    type: NodeType.Task,
    label: id,
    plan_description: "验证脚本目标图",
    checkpoints: [{ id: "cp1", label: "验证", status: "pending" }],
    definition_of_done: ["公共脚本输出正确"],
  });
}

interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runSp(
  args: string[],
  env: Record<string, string> = {},
  cwd = tmpDir,
): ScriptResult {
  return runSpWithScript(SCRIPT_PATH, args, env, cwd);
}

function runSpWithScript(
  scriptPath: string,
  args: string[],
  env: Record<string, string> = {},
  cwd = tmpDir,
): ScriptResult {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("sp.mjs 目标图优先级与非法图名", () => {
  it("三份分发脚本都优先加载当前候选工作区的 core", () => {
    for (const scriptPath of SCRIPT_PATHS) {
      const result = runSpWithScript(scriptPath, ["get-node", "beta-node"]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).node.id).toBe("beta-node");
    }
  });

  it("默认图、环境变量与显式 --graph 的优先级不串图", () => {
    const byDefault = runSp(["get-node", "beta-node"]);
    expect(byDefault.status).toBe(0);
    expect(JSON.parse(byDefault.stdout).node.id).toBe("beta-node");

    const byEnv = runSp(["traverse", "alpha-node"], { SUPER_PLUMBER_GRAPH: "alpha" });
    expect(byEnv.status).toBe(0);
    expect(JSON.parse(byEnv.stdout).nodes).toEqual(["alpha-node"]);

    const explicitWins = runSp(
      ["--graph=alpha", "get-node", "alpha-node"],
      { SUPER_PLUMBER_GRAPH: "beta" },
    );
    expect(explicitWins.status).toBe(0);
    expect(JSON.parse(explicitWins.stdout).node.id).toBe("alpha-node");
  });

  it("checkpoint/report 核心子命令也使用显式目标图", () => {
    expect(runSp(["update-status", "alpha-node", "ready", "--graph", "alpha"]).status).toBe(0);
    expect(runSp(["claim", "alpha-node", "worker-alpha", "--graph", "alpha"]).status).toBe(0);

    const checkpoint = runSp(["checkpoint", "alpha-node", "cp1", "passed", "--graph", "alpha"]);
    expect(checkpoint.status).toBe(0);
    expect(checkpoint.stdout).toContain("alpha-node / cp1: passed");

    const report = runSp(["report", "alpha-node", "目标图交付", "--graph", "alpha"]);
    expect(report.status).toBe(0);
    expect(report.stdout).toContain("alpha-node: execution_report saved");
  });

  it("非法或不存在的显式图名退出 1，且不回退到 active/env 图", () => {
    const invalid = runSp(["traverse", "alpha-node", "--graph", "Alpha"], {
      SUPER_PLUMBER_GRAPH: "beta",
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toContain("非法图名");

    const missing = runSp(["get-node", "alpha-node", "--graph", "ghost"], {
      SUPER_PLUMBER_GRAPH: "beta",
    });
    expect(missing.status).toBe(1);
    const missingJson = JSON.parse(missing.stdout);
    expect(missingJson.error).toContain("ghost");
    expect(missingJson.error).toContain("alpha");
    expect(missingJson.error).toContain("beta");
    expect(missing.stderr).toBe("");
  });

  it("无图工作区中的显式图名也立即失败，不回退到 default", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo sp-empty-"));
    try {
      const missing = runSp(["get-node", "ghost-node", "--graph", "ghost"], {}, emptyDir);
      expect(missing.status).toBe(1);
      expect(JSON.parse(missing.stdout).error).toContain('图 "ghost" 不存在');
      expect(JSON.parse(missing.stdout).error).toContain("可用");
      expect(missing.stderr).toBe("");
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("sp.mjs Windows shell 路径回归", () => {
  it("工作区路径含空格时 shell 启动仍返回目标图 JSON", () => {
    const shellDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo sp shell-"));
    try {
      const shellGraph = createGraph(shellDir, "shell", "Shell");
      addNode(shellGraph, "l1_a");
      addNode(shellGraph, "l1_b");
      createEdge(shellGraph, { id: "e1", source: "l1_a", target: "l1_b", type: EdgeType.DependsOn });
      updateGraph(shellGraph, {
        entry_description: "需求已明确",
        exit_description: "shell 回归完成",
        add_criteria: ["目标图 JSON 正确"],
      });
      writeWorkspaceDefault(shellDir, "shell");
      const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;
      const command = [
        process.execPath,
        SCRIPT_PATH,
        "check-design",
        "--json",
        shellDir,
        "--graph",
        "shell",
      ].map(quote).join(" ");
      const raw = spawnSync(command, {
        cwd: process.cwd(),
        encoding: "utf-8",
        shell: true,
        env: { ...process.env },
      });
      const res = {
        status: raw.status ?? -1,
        stdout: raw.stdout ?? "",
        stderr: raw.stderr ?? "",
      };
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.root).toBe(shellDir);
      expect(parsed.graph).toBe("shell");
      expect(parsed.pass).toBe(true);
    } finally {
      fs.rmSync(shellDir, { recursive: true, force: true });
    }
  });
});

describe("sp-check-design 三渠道加载回归", () => {
  it("三份 check-design 都使用当前候选工作区的 core", () => {
    const shellDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo sp doctor-"));
    try {
      const shellGraph = createGraph(shellDir, "shell", "Shell");
      addNode(shellGraph, "l1_a");
      addNode(shellGraph, "l1_b");
      createEdge(shellGraph, { id: "e1", source: "l1_a", target: "l1_b", type: EdgeType.DependsOn });
      updateGraph(shellGraph, {
        entry_description: "需求已明确",
        exit_description: "doctor 回归完成",
        add_criteria: ["候选 core 正确加载"],
      });
      writeWorkspaceDefault(shellDir, "shell");
      for (const scriptPath of CHECK_DESIGN_PATHS) {
        const raw = spawnSync(process.execPath, [scriptPath, "--json", shellDir, "--graph", "shell"], {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env },
        });
        expect(raw.status).toBe(0);
        const parsed = JSON.parse(raw.stdout ?? "");
        expect(parsed.root).toBe(shellDir);
        expect(parsed.graph).toBe("shell");
        expect(parsed.pass).toBe(true);
      }
    } finally {
      fs.rmSync(shellDir, { recursive: true, force: true });
    }
  });
});
