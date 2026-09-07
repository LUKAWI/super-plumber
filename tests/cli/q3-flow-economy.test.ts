import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-q3-flow-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: tmpDir,
    encoding: "utf8",
  });
}

function runOk(args: string[]): string {
  const result = run(args);
  expect(result.status, `${args.join(" ")}\n${result.stderr}`).toBe(0);
  return result.stdout;
}

function events(graph: string, kind: string): Array<{ detail?: string }> {
  const output = JSON.parse(runOk(["events", "--graph", graph, "--kind", kind, "--json"]));
  return Array.isArray(output) ? output : output.events;
}

describe("Q3 流程经济机器化样本", () => {
  it("quick 从初始化到 running 主路径恰为 5 步；显式 self 审批另列且不冒充人工审批", () => {
    const mainPath = [
      ["init", "quick-sample", "--class", "quick"],
      ["update-graph", "--entry-desc", "需求", "--exit-desc", "可验收交付"],
      ["create-node", "--id", "deliver", "--label", "交付"],
      ["update-status", "--id", "deliver", "--status", "ready"],
      ["update-status", "--id", "deliver", "--status", "running", "--claim-by", "q3-agent"],
    ] as const;

    for (const step of mainPath) runOk([...step]);
    const node = JSON.parse(runOk(["get-node", "--id", "deliver", "--json"]));
    expect(mainPath).toHaveLength(5);
    expect(node.node.status).toBe("running");

    runOk(["approve", "--by", "q3-agent", "--status", "self"]);
    const approvals = events("quick-sample", "design_approved");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].detail).toContain("status=self");
    expect(approvals[0].detail).not.toContain("status=approved");
    console.info("[Q3] quick_main_steps=5 explicit_self_approval_steps=1 human_approved=0");
  });

  it("standard 自举样本的人工 approve 覆盖率为 100%", () => {
    const samples = ["standard-a", "standard-b"];
    for (const graph of samples) {
      runOk(["init", graph, "--class", "standard"]);
      runOk(["approve", "--graph", graph, "--by", `human-${graph}`, "--status", "approved"]);
    }

    const approved = samples.filter((graph) =>
      events(graph, "design_approved").some((event) => event.detail?.includes("status=approved")),
    );
    expect(approved).toHaveLength(samples.length);
    console.info(`[Q3] standard_approved=${approved.length}/${samples.length} coverage=100%`);
  });

  it("program 雾区毕业率可由 fog_graduated 事件计算并输出真实分子/分母", () => {
    const samples = ["program-graduated", "program-open"];
    for (const graph of samples) {
      runOk(["init", graph, "--class", "program"]);
      runOk([
        "update-graph",
        "--graph",
        graph,
        "--set-fog",
        JSON.stringify({ id: `fog-${graph}`, description: "关键未知", graduation: "证据齐备" }),
      ]);
    }
    runOk([
      "graduate-fog",
      "--graph",
      "program-graduated",
      "--produced",
      "decision",
      "--reason",
      "证据齐备",
    ]);

    const graduated = samples.filter((graph) => events(graph, "fog_graduated").length > 0);
    const rate = graduated.length / samples.length;
    expect(graduated).toEqual(["program-graduated"]);
    expect(rate).toBe(0.5);
    console.info(`[Q3] program_fog_graduated=${graduated.length}/${samples.length} rate=${rate}`);
  });
});
