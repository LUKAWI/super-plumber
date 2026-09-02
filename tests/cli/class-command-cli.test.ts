// tests/cli/class-command-cli.test.ts — v091-class-command（adr_0016）CLI 通道：
// update-graph --class + --by 凭据血统（缺省 agent / 用户直发 user）、class_changed
// 事件两态（events 可查 from/to/by）、雾/档矛盾 nudge 注入与静默两态
// （validate --json 警告 + next --json class_nudge，同值重设不落事件）。
// 断言针对 dist 构建（vitest 前置 npm run build），与既有 CLI 测试同构。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-class-cli-"));
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

function setup(): void {
  const r = run("init t -l 测试图");
  if (r.status !== 0) throw new Error(`setup 失败: ${r.stderr}`);
  run("create-node --id r1 --label 研究票");
}

function classChangedEvents(): any[] {
  const out = run("events --kind class_changed --json").stdout as string;
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : parsed.events;
}

describe("v091 update-graph --class --by（CLI 凭据血统）", () => {
  it("事件两态：quick 首设（by 缺省 agent）→ standard --by user 实际变更；同值重设不落", () => {
    setup();
    // 首次设置：from 缺省、by 缺省 agent；回显带凭据
    const r1 = run(`update-graph --class quick`);
    expect(r1.status).toBe(0);
    expect(r1.stdout).toContain("class: quick");
    expect(r1.stdout).toContain("by=agent");
    let ev = classChangedEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0].from).toBeUndefined();
    expect(ev[0].to).toBe("quick");
    expect(ev[0].by).toBe("agent");
    // 实际变更：from/to/by 齐备
    const r2 = run(`update-graph --class standard --by user`);
    expect(r2.status).toBe(0);
    expect(r2.stdout).toContain("class: standard");
    expect(r2.stdout).toContain("by=user");
    ev = classChangedEvents();
    expect(ev).toHaveLength(2);
    expect(ev[1].from).toBe("quick");
    expect(ev[1].to).toBe("standard");
    expect(ev[1].by).toBe("user");
    // 同值重设：事件计数不变（audit 不噪音）
    run(`update-graph --class standard --by user`);
    expect(classChangedEvents()).toHaveLength(2);
    // status 读面可查当前档
    const s = JSON.parse(run("status --json").stdout as string);
    expect(s.class).toBe("standard");
  });

  it("档位非法：exit 1 三值提示，不落盘不落事件", () => {
    setup();
    const r = run(`update-graph --class huge`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("quick | standard | program");
    expect(classChangedEvents()).toHaveLength(0);
  });
});

describe("v091 雾/档矛盾 nudge（CLI 注入与静默两态）", () => {
  it("雾 + quick（agent 缺省）→ validate 警告与 next 注入；--by user 升档后均静默", () => {
    setup();
    run(`update-graph --set-fog {"id":"ra","description":"发布链","graduation":"清单成文"}`);
    run(`update-graph --class quick`);
    // validate --json：警告在案且 ok=true（零门禁）
    const v1 = JSON.parse(run("validate --json").stdout as string);
    expect(v1.ok).toBe(true);
    const nudge = v1.warnings.find((w: string) => w.includes("update-graph --class program"));
    expect(nudge).toBeDefined();
    expect(nudge).toContain("未毕业雾区 ra"); // 信息一：雾未毕业
    expect(nudge).toContain("quick"); // 信息二：当前档位
    expect(nudge).toContain("program"); // 信息三：建议方向
    // next --json：class_nudge 透出
    const n1 = JSON.parse(run("next --json").stdout as string);
    expect(n1.class_nudge).toBeDefined();
    expect(n1.class_nudge).toContain("ra");
    // 用户直发凭据升档 → validate + next 均静默（雾区提示不陪葬）
    run(`update-graph --class standard --by user`);
    const v2 = JSON.parse(run("validate --json").stdout as string);
    expect(v2.warnings.some((w: string) => w.includes("update-graph --class program"))).toBe(false);
    expect(v2.warnings.some((w: string) => w.includes("未毕业雾区 ra"))).toBe(true);
    const n2 = JSON.parse(run("next --json").stdout as string);
    expect(n2.class_nudge).toBeUndefined();
  });
});
