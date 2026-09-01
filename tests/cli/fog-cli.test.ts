// tests/cli/fog-cli.test.ts — F04/F05/F17（adr_0007，0.9.0）CLI 通道：
// init --class 预设、update-graph --set-fog/--class、status/next 读面透出、
// validate --json 雾区提示（ok=true 不阻止）、graduate-fog 毕业与无雾拒绝。
// 断言针对 dist 构建（vitest 前置 npm run build），与既有 CLI 测试同构。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-fog-cli-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string): ReturnType<typeof spawnSync> {
  return spawnSync("node", [CLI, ...args.split(" ")], {
    cwd: tmpDir,
    encoding: "utf-8",
  });
}

function setupGraph(args = "init t -l 测试图"): void {
  const r = run(args);
  if (r.status !== 0) throw new Error(`setup 失败: ${r.stderr}`);
}

describe("F04 graph init --class / update-graph --set-fog --class（CLI）", () => {
  it("init --class program 预设工作类；非法值被拒", () => {
    setupGraph("init t --class program");
    const s = JSON.parse(run("status --json").stdout as string);
    expect(s.class).toBe("program");
    // 非法值：创建前拒绝（exit 1，图未落盘）
    const bad = run("init bad --class huge");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("quick | standard | program");
    expect(fs.existsSync(path.join(tmpDir, ".graph", "bad"))).toBe(false);
  });

  it("update-graph --set-fog 登记雾区（整体 upsert）+ --class 标注，status/next 读面透出", () => {
    setupGraph();
    run("create-node --id r1 --label 研究票");
    const r = run(
      `update-graph --set-fog {"id":"ra","description":"发布链","graduation":"清单成文","ignited":["r1"]} --class program`,
    );
    expect(r.status).toBe(0);
    const s = JSON.parse(run("status --json").stdout as string);
    expect(s.fog.id).toBe("ra");
    expect(s.fog.ignited).toEqual(["r1"]);
    expect(s.class).toBe("program");
    const n = JSON.parse(run("next --json").stdout as string);
    expect(n.fog.id).toBe("ra");
  });

  it("--set-fog 缺 graduation → 写前校验拒绝落盘（A2 咽喉点）", () => {
    setupGraph();
    const r = run(`update-graph --set-fog {"id":"x","description":"d"}`);
    expect(r.status).toBe(1);
    expect(run("status --json").stdout).not.toContain('"fog"');
  });
});

describe("F17 graph validate 雾区提示（CLI，只提示不阻止）", () => {
  it("有雾 → 警告在案且 ok=true（退出码 0）；毕业后提示消失", () => {
    setupGraph();
    run("create-node --id r1 --label 研究票");
    run(`update-graph --set-fog {"id":"ra","description":"d","graduation":"g"}`);
    const v = JSON.parse(run("validate --json").stdout as string);
    expect(v.ok).toBe(true);
    expect(v.warnings.some((w: string) => w.includes("未毕业雾区 ra"))).toBe(true);
    // 毕业 → 提示消失
    run("graduate-fog --reason done");
    const v2 = JSON.parse(run("validate --json").stdout as string);
    expect(v2.warnings.some((w: string) => w.includes("雾区"))).toBe(false);
  });
});

describe("F05 graduate-fog（CLI 毕业通道）", () => {
  it("毕业清除 fog + fog_graduated 事件可查；无雾毕业 exit 1", () => {
    setupGraph();
    run(`update-graph --set-fog {"id":"ra","description":"d","graduation":"g"}`);
    const r = run("graduate-fog --produced r1,r2 --reason 清单成文");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("雾区已毕业: ra");
    const s = JSON.parse(run("status --json").stdout as string);
    expect(s.fog).toBeUndefined();
    const ev = JSON.parse(run("events --kind fog_graduated --json").stdout as string);
    const list = Array.isArray(ev) ? ev : ev.events;
    expect(list).toHaveLength(1);
    expect(list[0].detail).toContain("fog=ra");
    expect(list[0].detail).toContain("produced=r1,r2");
    // 无雾再毕业：事实陈述拒绝
    const again = run("graduate-fog");
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("没有雾区");
  });
});
