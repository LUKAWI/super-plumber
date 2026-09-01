// tests/cli/amend-cli.test.ts — F21（DEC-7 / adr_0006）CLI 通道：
// create-node 自动快照 + graph_amended 事件 + 已审核图 review 回置 unreviewed；
// update-node 改 passed 节点 plan 的 stdout nudge（与 core planAmendNudge 全等——
// 双通道一致性之 CLI 面；MCP ≡ core 见 tests/mcp/amend-mcp.test.ts）。
// 断言针对 dist 构建（vitest 前置 npm run build），与既有 CLI 测试同构。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { planAmendNudge } from "../../src/core/amend.js";
import {
  createNode,
  updateNodeStatus,
  updateExecutionReport,
} from "../../src/core/node.js";
import { NodeType, NodeStatus } from "../../src/core/types.js";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-amend-cli-"));
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

function graphDir(): string {
  return path.join(tmpDir, ".graph", "t");
}

function readGraphYaml(): string {
  return fs.readFileSync(path.join(graphDir(), "graph.yaml"), "utf-8");
}

function snapMessages(): string[] {
  const dir = path.join(graphDir(), "snapshots");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(dir, e.name, "manifest.json"), "utf-8"),
        ) as { message?: string };
      } catch {
        return null;
      }
    })
    .filter((m): m is { message?: string } => m !== null)
    .map((m) => m.message ?? "");
}

function amendEvents(): any[] {
  const file = path.join(graphDir(), "events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l))
    .filter((e) => e.kind === "graph_amended");
}

/** core API 把节点铺到 passed（状态铺垫不走 CLI；nudge/快照断言走 CLI 通道）。
 * 前提：tmpDir 已 init t。 */
function driveToPassed(id: string) {
  createNode(tmpDir, { id, type: NodeType.Task, label: id }, { skipAmendGuard: true });
  updateNodeStatus(tmpDir, id, NodeStatus.Ready);
  updateNodeStatus(tmpDir, id, NodeStatus.Running, "agent-x");
  updateExecutionReport(tmpDir, id, { summary: "done" });
  updateNodeStatus(tmpDir, id, NodeStatus.Passed);
}

describe("F21 改图三约束（CLI 通道）", () => {
  it("CLI-01 已审核图 create-node：自动快照 + graph_amended 事件 + review 回置 unreviewed", () => {
    expect(run(["init", "t"]).status).toBe(0);
    expect(run(["approve", "--by", "alice"]).status).toBe(0);

    const r = run(["create-node", "--id", "c", "--label", "C"]);
    expect(r.status).toBe(0);

    // review 回置：凭据字段 status=unreviewed / by=cli（触发修订的通道）
    const yaml = readGraphYaml();
    expect(yaml).toContain("status: unreviewed");
    expect(yaml).toContain("by: cli");

    // 自动快照 message 说明性
    expect(snapMessages()).toContain("auto: structural amend (add-node c) by cli");

    // graph_amended 事件在案
    const events = amendEvents();
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe("cli");
    expect(events[0].detail).toContain("action=add-node");
    expect(events[0].detail).toContain("target=c");
  });

  it("CLI-02 未审核图 create-node：review 保持缺省，自动快照与事件照常", () => {
    expect(run(["init", "t"]).status).toBe(0);
    expect(run(["create-node", "--id", "c", "--label", "C"]).status).toBe(0);
    expect(readGraphYaml()).not.toContain("review:");
    expect(snapMessages()).toContain("auto: structural amend (add-node c) by cli");
    expect(amendEvents()).toHaveLength(1);
  });

  it("CLI-03 update-node 改 passed 节点 plan：stdout nudge 与 core 文案全等（CLI ≡ core）", () => {
    expect(run(["init", "t"]).status).toBe(0);
    driveToPassed("p1");
    const expected = planAmendNudge({ id: "p1", status: "passed" }, { planChanged: true });
    expect(expected).toContain("计划已变更，是否重开/重验");

    const r = run(["update-node", "-i", "p1", "--plan-desc", "结构修订后的新计划"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✅ 已更新节点: p1"); // 写操作照常成功（零门禁红线）
    expect(r.stdout).toContain(expected); // CLI ≡ core 文案全等
  });

  it("CLI-04 update-node：pending 节点改 plan / passed 节点未改 plan 均无 nudge", () => {
    expect(run(["init", "t"]).status).toBe(0);
    expect(run(["create-node", "--id", "q1", "--label", "Q1"]).status).toBe(0);
    const r1 = run(["update-node", "-i", "q1", "--plan-desc", "pending 改 plan"]);
    expect(r1.status).toBe(0);
    expect(r1.stdout).not.toContain("计划已变更");

    driveToPassed("p2");
    const r2 = run(["update-node", "-i", "p2", "--label", "P2-改"]);
    expect(r2.status).toBe(0);
    expect(r2.stdout).not.toContain("计划已变更");
  });
});
