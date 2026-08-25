// tests/cli/cli-param-guards.test.ts
// S1-1/S1-2/S1-9/S3-17 + N1 回归：CLI 数值参数统一防线（coerce.ts）与语义对齐。
// 此前 CLI 数值参数直接 parseInt 不查 NaN/负数：--level abc 写出 level: .nan
// 的 YAML 毒化全图读取；--set-priority -5 经 MCP 被拒、经 CLI 落盘自毒；
// --reset-attempts 单独使用静默无效且退出码 0。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-param-"));
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

function init() {
  expect(run(["init", "t"]).status).toBe(0);
}

describe("CLI 数值参数防线（S1-1/S1-2/S3-17）", () => {
  it("PNG-01 create-node --level abc / 2.5 / -1 → 拒绝且不落盘", () => {
    init();
    for (const bad of ["abc", "2.5", "-1", "1e3"]) {
      const r = run(["create-node", "-i", "n1", "-l", "x", "--level", bad]);
      expect(r.status, `--level ${bad}`).toBe(1);
      expect(r.stderr, `--level ${bad}`).toContain("--level");
    }
    expect(fs.readdirSync(path.join(tmpDir, ".graph", "t", "nodes")).length).toBe(0);
  });

  it("PNG-02 create-node --priority -5 → 拒绝（S1-2：CLI 对齐 MCP min(0)）", () => {
    init();
    const r = run(["create-node", "-i", "n1", "-l", "x", "--priority", "-5"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("不能小于 0");
  });

  it("PNG-03 update-node --max-attempts xyz / --set-priority -5 → 拒绝", () => {
    init();
    expect(run(["create-node", "-i", "n1", "-l", "x"]).status).toBe(0);
    const r1 = run(["update-node", "-i", "n1", "--max-attempts", "xyz"]);
    expect(r1.status).toBe(1);
    expect(r1.stderr).toContain("--max-attempts");
    const r2 = run(["update-node", "-i", "n1", "--set-priority", "-5"]);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain("不能小于 0");
  });

  it("PNG-04 update-node --reset-attempts 单独使用生效（S1-9）", () => {
    init();
    expect(run(["create-node", "-i", "n1", "-l", "x"]).status).toBe(0);
    // 制造 attempts=1：ready→running→failed→pending（重试计数 +1）
    expect(run(["update-status", "-i", "n1", "-s", "ready"]).status).toBe(0);
    expect(run(["update-status", "-i", "n1", "-s", "running", "--claim-by", "t"]).status).toBe(0);
    expect(run(["update-status", "-i", "n1", "-s", "failed"]).status).toBe(0);
    expect(run(["update-status", "-i", "n1", "-s", "pending"]).status).toBe(0);
    const mid = run(["get-node", "-i", "n1", "--json"]);
    expect(JSON.parse(mid.stdout).node.attempts).toBe(1);

    const r = run(["update-node", "-i", "n1", "--reset-attempts"]);
    expect(r.status).toBe(0); // 不再被"没有指定任何更新项"早退吞掉
    expect(r.stdout).toContain("已更新节点");
    const after = run(["get-node", "-i", "n1", "--json"]);
    expect(JSON.parse(after.stdout).node.attempts).toBe(0);
    // attempts_reset 审计事件已留痕
    const ev = run(["events", "-n", "n1", "--json"]);
    expect(JSON.parse(ev.stdout).some((e: { kind: string }) => e.kind === "attempts_reset")).toBe(true);
  });

  it("PNG-05 next --stale-ms abc → 拒绝；serve --port abc → 拒绝且不启动监听", () => {
    init();
    const r1 = run(["next", "--stale-ms", "abc"]);
    expect(r1.status).toBe(1);
    expect(r1.stderr).toContain("--stale-ms");
    const r2 = run(["serve", "--no-open", "-p", "abc"]);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain("--port");
    expect(r2.stderr).not.toContain("拓扑图可视化服务"); // 未进入 startServer
  });

  it("PNG-06 events --last abc → 拒绝（行为统一：旧版静默兜底显示全部，属 S3-17 无防线宽容，改为一致报错）", () => {
    init();
    const r = run(["events", "--last", "abc"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--last");
    // 合法值正常工作
    const ok = run(["events", "--last", "10"]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("无匹配事件");
  });

  it("PNG-07（N1）add-edge 穿越形端点报「非法 ID」而非「不存在」", () => {
    init();
    expect(run(["create-node", "-i", "a", "-l", "A"]).status).toBe(0);
    expect(run(["create-node", "-i", "b", "-l", "B"]).status).toBe(0);
    const r = run(["add-edge", "-i", "e1", "-s", "../a", "-t", "b"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("非法边");
    expect(r.stderr).not.toContain("不存在");
  });
});
