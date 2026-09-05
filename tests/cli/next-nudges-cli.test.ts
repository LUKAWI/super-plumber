// tests/cli/next-nudges-cli.test.ts — v091-verify 交叉验证补口回归：
// class_nudge / fog_graduation_nudge 此前只在 --json 与 MCP 面可见，
// CLI `graph next` 人读面漏渲染；本文件钉住人读面（⚠️ 前缀由渲染器统一加）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { updateGraph } from "../../src/core/parser.js";
import { createNode, updateNodeStatus, updateExecutionReport } from "../../src/core/node.js";
import { NodeType, NodeStatus } from "../../src/core/types.js";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-next-nudges-cli-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): string {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: tmpDir, encoding: "utf-8" });
  expect(r.status, `命令失败: ${args.join(" ")}\n${r.stderr}`).toBe(0);
  return r.stdout;
}

describe("graph next 人读面渲染 nudge（v091-verify 补口）", () => {
  it("雾/档矛盾 nudge 人读可见；用户直发 --by user 后消失", () => {
    run(["init", "t"]);
    run(["update-graph", "--set-fog", '{"id":"ra","description":"d","graduation":"g"}']);
    run(["update-graph", "--class", "standard"]);
    const out = run(["next"]);
    expect(out).toContain("请核对关键未知是否阻止形成可信交付计划");
    expect(out).toContain("⚠️");
    // 同值重设不落事件（凭据链最新仍 by=agent，nudge 持续）——静默须异值直发落凭据事件
    run(["update-graph", "--class", "quick", "--by", "user"]);
    expect(run(["next"])).not.toContain("请核对关键未知是否阻止形成可信交付计划");
  });

  it("请核对实际证据是否满足毕业条件 nudge 人读可见（ignited 全 passed）；毕业后消失", () => {
    run(["init", "t"]);
    createNode(tmpDir, { id: "r1", type: NodeType.Task, label: "研究票" });
    updateGraph(tmpDir, { fog: { id: "ra", description: "d", graduation: "g", ignited: ["r1"] } });
    expect(run(["next"])).not.toContain("请核对实际证据是否满足毕业条件");
    updateNodeStatus(tmpDir, "r1", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "r1", NodeStatus.Running);
    updateExecutionReport(tmpDir, "r1", { summary: "研究完成" });
    updateNodeStatus(tmpDir, "r1", NodeStatus.Passed);
    const out = run(["next"]);
    expect(out).toContain("请核对实际证据是否满足毕业条件");
    expect(out).toContain("graduate-fog");
    run(["graduate-fog", "--reason", "测试毕业"]);
    expect(run(["next"])).not.toContain("请核对实际证据是否满足毕业条件");
  });
});
