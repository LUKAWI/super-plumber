// tests/cli/approve-cli.test.ts — DEC-1（g080-approve-core）：graph approve 命令
// 双通道之 CLI 面：--by 必填、--status 默认 approved、--graph 全局参数、
// review 字段落盘 + design_approved 事件 + next --json 的 review_flag 免费受益。
// 断言针对 dist 构建（vitest 前置 npm run build），与既有 CLI 测试同构。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { REVIEW_FLAG_UNREVIEWED } from "../../src/core/index-service.js";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-approve-cli-"));
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
  const r = run(["init", "t"]);
  expect(r.status).toBe(0);
}

function readGraphYaml(): string {
  return fs.readFileSync(path.join(tmpDir, ".graph/t/graph.yaml"), "utf-8");
}

function designApprovedEvents(): any[] {
  const file = path.join(tmpDir, ".graph/t/events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l))
    .filter((e) => e.kind === "design_approved");
}

describe("graph approve（CLI 通道）", () => {
  it("approve --by test --status self：review 落盘（self 自签）+ design_approved 事件", () => {
    init();
    const r = run(["approve", "--by", "test", "--status", "self"]);
    expect(r.status).toBe(0);
    const yaml = readGraphYaml();
    expect(yaml).toContain("review:");
    expect(yaml).toContain("status: self");
    expect(yaml).toContain("by: test");
    expect(yaml).toMatch(/at: ['"]?\d{4}-\d{2}-\d{2}T/); // js-yaml 可能给 ISO 串加引号
    const events = designApprovedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe("test");
    expect(events[0].detail).toContain("by=test");
    expect(events[0].detail).toContain("status=self");
  });

  it("--status 缺省 approved（人工审核）", () => {
    init();
    const r = run(["approve", "--by", "alice"]);
    expect(r.status).toBe(0);
    expect(readGraphYaml()).toContain("status: approved");
    const events = designApprovedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].detail).toContain("status=approved");
  });

  it("--by 必填：缺失时 exit 非 0（commander requiredOption）", () => {
    init();
    const r = run(["approve"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--by");
  });

  it("--status 非法值 → exit 1 且不落盘", () => {
    init();
    const r = run(["approve", "--by", "alice", "--status", "maybe"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("approved | self");
    expect(readGraphYaml()).not.toContain("review:");
    expect(designApprovedEvents()).toHaveLength(0);
  });

  it("支持全局 --graph 参数", () => {
    init();
    const r = run(["approve", "--graph", "t", "--by", "alice"]);
    expect(r.status).toBe(0);
    expect(readGraphYaml()).toContain("status: approved");
  });

  it("未 init → exit 1 友好报错（非裸堆栈）", () => {
    const r = run(["approve", "--by", "alice"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("graph init");
    expect(r.stderr).not.toContain("at Module");
  });

  it("next --json 免费受益：approve 前 ready_eligible 带 review_flag，approve 后消失", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    const before = JSON.parse(
      run(["next", "--json"]).stdout,
    );
    const aBefore = before.ready_eligible.find((n: any) => n.id === "a");
    expect(aBefore?.review_flag).toBe(REVIEW_FLAG_UNREVIEWED);

    run(["approve", "--by", "alice", "--status", "self"]);
    const after = JSON.parse(run(["next", "--json"]).stdout);
    const aAfter = after.ready_eligible.find((n: any) => n.id === "a");
    expect(aAfter?.review_flag).toBeUndefined();
    // ready 桶始终不注入
    expect(JSON.stringify(after.ready)).not.toContain("review_flag");
  });
});
