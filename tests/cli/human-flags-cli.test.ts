// tests/cli/human-flags-cli.test.ts — F06/F07（0.9.1）CLI 通道：
// get-node 双态读面（requires_human 仅真值出现：JSON 字段 + 人读渲染行）、
// next --json 桶条目透传（requires_human / waiting_human / IL-025 fog_graduation_nudge）、
// next --stale-ms 显式传值仍被接受（参数防线不变）。
// 断言针对 dist 构建（vitest 前置 npm run build），与既有 CLI 测试同构；
// 涉 verifier:"human" 的检查点经 core 写入原语落盘（CLI create-node 无 checkpoints 参数）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createNode, updateNodeStatus, updateCheckpoint, updateExecutionReport } from "../../src/core/node.js";
import { updateGraph } from "../../src/core/parser.js";
import { NodeType, NodeStatus, type Checkpoint } from "../../src/core/types.js";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-human-cli-"));
  const r = spawnSync("node", [CLI, "init", "t"], { cwd: tmpDir, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`init 失败: ${r.stderr}`);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("node", [CLI, ...args], { cwd: tmpDir, encoding: "utf-8" });
}

const HUMAN_CPS: Checkpoint[] = [
  { id: "cp-human", label: "人工签核", status: "pending", verifier: "human" },
];

describe("F06 get-node 读面（CLI）", () => {
  it("--json：含未完成 human checkpoint → requires_human: true；机器票字段缺省", () => {
    createNode(tmpDir, { id: "h1", type: NodeType.Task, label: "人工票", checkpoints: HUMAN_CPS });
    createNode(tmpDir, { id: "m1", type: NodeType.Task, label: "机器票" });

    const h = JSON.parse(run(["get-node", "--id", "h1", "--json"]).stdout as string);
    expect(h.requires_human).toBe(true);
    const m = JSON.parse(run(["get-node", "--id", "m1", "--json"]).stdout as string);
    expect(m.requires_human).toBeUndefined();
  });

  it("人读渲染：requires_human 提示行出现；人工检查点 passed 后消失（两态）", () => {
    createNode(tmpDir, { id: "h1", type: NodeType.Task, label: "人工票", checkpoints: HUMAN_CPS });
    const before = run(["get-node", "--id", "h1"]);
    expect(before.stdout).toContain("requires_human");

    updateCheckpoint(tmpDir, "h1", "cp-human", "passed");
    const after = run(["get-node", "--id", "h1"]);
    expect(after.stdout).not.toContain("requires_human");
  });
});

describe("F07 next 读面（CLI）", () => {
  it("--json：ready/ready_eligible 条目透传 requires_human + waiting_human（机器票缺省）", () => {
    createNode(tmpDir, { id: "h1", type: NodeType.Task, label: "人工票", checkpoints: HUMAN_CPS });
    createNode(tmpDir, { id: "m1", type: NodeType.Task, label: "机器票" });
    updateNodeStatus(tmpDir, "h1", NodeStatus.Ready);

    const n = JSON.parse(run(["next", "--json"]).stdout as string);
    const h = n.ready.find((x: { id: string }) => x.id === "h1");
    expect(h.requires_human).toBe(true);
    expect(h.waiting_human).toBe(true);
    const e = n.ready_eligible.find((x: { id: string }) => x.id === "m1");
    expect(e.requires_human).toBeUndefined();
    expect(e.waiting_human).toBeUndefined();
  });

  it("非 JSON 渲染：等真人标记出现；--stale-ms 显式传值仍被接受（参数防线不变）", () => {
    createNode(tmpDir, { id: "h1", type: NodeType.Task, label: "人工票", checkpoints: HUMAN_CPS });
    updateNodeStatus(tmpDir, "h1", NodeStatus.Ready);
    const out = run(["next"]).stdout as string;
    expect(out).toContain("等真人");

    const r = run(["next", "--stale-ms", "60000"]);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("--stale-ms");
  });
});

describe("IL-025 next 读面（CLI）", () => {
  it("--json：ignited 全 passed → fog_graduation_nudge 透出；毕业命令建议可见", () => {
    createNode(tmpDir, { id: "r1", type: NodeType.Task, label: "研究票" });
    updateGraph(tmpDir, {
      fog: {
        id: "ra",
        description: "发布链",
        graduation: "清单成文",
        ignited: ["r1"],
      },
    });
    expect(JSON.parse(run(["next", "--json"]).stdout as string).fog_graduation_nudge).toBeUndefined();

    updateNodeStatus(tmpDir, "r1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "r1", NodeStatus.Running);
    updateExecutionReport(tmpDir, "r1", { summary: "研究完成" });
    updateNodeStatus(tmpDir, "r1", NodeStatus.Passed);
    const nudge = JSON.parse(run(["next", "--json"]).stdout as string).fog_graduation_nudge;
    expect(nudge).toBeDefined();
    expect(nudge).toContain("ra");
    expect(nudge).toContain("graduate-fog");
  });
});
