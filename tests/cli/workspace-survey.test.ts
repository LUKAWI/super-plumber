import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-workspace-survey-cli-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): string {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: tmpDir,
    encoding: "utf-8",
  });
  expect(result.status, `${args.join(" ")}\n${result.stderr}`).toBe(0);
  return result.stdout;
}

describe("多图读面：next --all 与 survey", () => {
  it("next --all 带图名标签聚合各图前沿", () => {
    run(["init", "alpha", "-l", "甲图"]);
    run(["create-node", "-i", "alpha-task", "-l", "甲任务"]);
    run(["init", "beta", "-l", "乙图"]);
    run(["create-node", "-i", "beta-task", "-l", "乙任务"]);

    const body = JSON.parse(run(["next", "--all", "--json"]));
    expect(body.graphs.map((g: { graph: string }) => g.graph)).toEqual(["alpha", "beta"]);
    expect(body.graphs.find((g: { graph: string }) => g.graph === "alpha").label).toBe("甲图");
    expect(
      body.graphs
        .find((g: { graph: string }) => g.graph === "alpha")
        .ready_eligible.map((n: { id: string }) => n.id),
    ).toContain("alpha-task");
  });

  it("survey 输出 blocked/stale/ADR 冲突三项巡检并落临时报告", () => {
    run(["init", "alpha", "-l", "甲图"]);
    run(["create-node", "-i", "upstream", "-l", "前置"]);
    run(["create-node", "-i", "downstream", "-l", "后置"]);
    run(["add-edge", "-i", "e1", "-s", "upstream", "-t", "downstream"]);
    run(["adr", "create", "-t", "决策一", "-d", "方案一"]);
    run(["adr", "create", "-t", "决策二", "-d", "方案二"]);
    run(["add-edge", "-i", "d1", "-s", "adr_0001", "-t", "downstream", "--type", "decides"]);
    run(["add-edge", "-i", "d2", "-s", "adr_0002", "-t", "downstream", "--type", "decides"]);

    const body = JSON.parse(run(["survey", "--json"]));
    expect(body.graphs).toHaveLength(1);
    const graph = body.graphs[0];
    expect(graph.blocked.map((n: { id: string }) => n.id)).toContain("downstream");
    expect(graph.stale).toEqual([]);
    expect(graph.adr_conflicts.map((n: { node_id: string }) => n.node_id)).toContain("downstream");
    expect(fs.existsSync(body.report_path)).toBe(true);
    expect(JSON.parse(fs.readFileSync(body.report_path, "utf-8")).graphs[0].graph).toBe("alpha");
  });
});
