// tests/cli/graph-ops-cli.test.ts — v0.5.2 cli_commands E2E：init 带名/switch/list/rename/delete
// + --graph 参数与 SUPER_PLUMBER_GRAPH + 关键输出图名回显
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync, spawnSync } from "node:child_process";

const CLI_PATH = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-cli-v52-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): string {
  const res = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: tmpDir, encoding: "utf-8",
  });
  if (res.status !== 0) {
    throw new Error(`CLI 失败: ${args.join(" ")}\n${res.stdout}${res.stderr}`);
  }
  return `${res.stdout}${res.stderr}`;
}

function runFail(args: string[]): string {
  const res = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: tmpDir, encoding: "utf-8",
  });
  return `${res.stdout}${res.stderr}`;
}

/** 伪造旧布局（.graph/graph.yaml 在根）——旧仓库兼容基线 */
function legacyInit(label = "旧图"): void {
  fs.mkdirSync(path.join(tmpDir, ".graph", "nodes"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, ".graph", "edges"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, ".graph", "graph.yaml"),
    `id: g_legacy\nlabel: ${label}\nentry:\n  description: ""\n  defined_by: human\n  level: 0\nexit:\n  description: ""\n  acceptance_criteria: []\n  defined_by: human\n  level: 0\nnodes: []\nedges: []\n`,
    "utf-8",
  );
}

describe("graph init（v0.5.2 带名）", () => {
  it("新仓库无名单图 init 被拒绝（内容命名强制）", () => {
    const out = runFail(["init", "-l", "x"]);
    expect(out).toContain("必须带图名");
  });

  it("带名 init：创建 .graph/<名>/ + 设 active + workspace 事件", () => {
    const out = run(["init", "refactor-auth", "-l", "认证重构"]);
    expect(out).toContain("已创建图 \"refactor-auth\"");
    expect(fs.existsSync(path.join(tmpDir, ".graph", "refactor-auth", "graph.yaml"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, ".graph", "active"), "utf-8").trim()).toBe("refactor-auth");
    const ws = fs.readFileSync(path.join(tmpDir, ".graph", "workspace-events.jsonl"), "utf-8");
    expect(ws).toContain("\"kind\":\"init\"");
    expect(ws).toContain("\"kind\":\"switch\"");
  });

  it("旧仓库带名 init = 一次性迁移 + 建新图；default 数据无损", () => {
    legacyInit("旧内容");
    fs.writeFileSync(path.join(tmpDir, ".graph", "nodes", "t1.yaml"), "id: t1\nlabel: T\n", "utf-8");
    const out = run(["init", "billing-v2", "-l", "计费"]);
    expect(out).toContain("一次性迁移");
    expect(fs.existsSync(path.join(tmpDir, ".graph", "default", "graph.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".graph", "default", "nodes", "t1.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".graph", "graph.yaml"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, ".graph", "active"), "utf-8").trim()).toBe("billing-v2");
  });

  it("非法图名拒绝", () => {
    const out = runFail(["init", "BadName", "-l", "x"]);
    expect(out).toContain("非法图名");
  });
});

describe("graph switch", () => {
  it("无参显示当前图含来源标注", () => {
    run(["init", "a-b", "-l", "AB"]);
    const out = run(["switch"]);
    expect(out).toContain("当前图: a-b");
    expect(out).toContain(".graph/active 工作区默认");
  });

  it("带名切换：写 active + 摘要；错名 → did-you-mean", () => {
    run(["init", "refactor-auth", "-l", "A"]);
    run(["init", "billing", "-l", "B"]);
    const out = run(["switch", "billing"]);
    expect(out).toContain("工作区默认图 → billing");
    expect(fs.readFileSync(path.join(tmpDir, ".graph", "active"), "utf-8").trim()).toBe("billing");
    const err = runFail(["switch", "refactor-atuh"]);
    expect(err).toContain("不存在");
    expect(err).toContain("refactor-auth");
  });

  it("原图 running 节点在途提示", () => {
    run(["init", "a", "-l", "A"]);
    run(["init", "b", "-l", "B"]);
    run(["switch", "a"]);
    run(["create-node", "-i", "t1", "-l", "T1"]);
    run(["update-node", "-i", "t1", "--add-checkpoint", '{"id":"cp1","label":"s1"}']);
    run(["update-node", "-i", "t1", "--plan-desc", "p"]);
    run(["update-node", "-i", "t1", "--add-dod", "d1"]);
    run(["update-status", "-i", "t1", "-s", "ready"]);
    run(["update-status", "-i", "t1", "-s", "running", "--claim-by", "x"]);
    const out = run(["switch", "b"]);
    expect(out).toContain("running 节点在途");
  });
});

describe("graph list", () => {
  it("全量结构化 + 当前标记 + --json", () => {
    run(["init", "alpha", "-l", "甲"]);
    run(["init", "beta", "-l", "乙"]);
    const out = run(["list"]);
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    expect(out).toContain("👉");
    const j = JSON.parse(run(["list", "--json"]));
    expect(j.graphs.map((g: any) => g.name).sort()).toEqual(["alpha", "beta"]);
    expect(j.current).toBe("beta"); // init beta 后 active=beta
  });

  it("带名查详情；旧布局 default 识别", () => {
    legacyInit("旧图");
    const out = run(["list", "default"]);
    expect(out).toContain("旧图");
  });
});

describe("rename-graph / delete-graph", () => {
  it("rename：目录改名 + active 随迁 + 事件；旧名再操作 → 悬挂提示", () => {
    run(["init", "old-name", "-l", "旧"]);
    const out = run(["rename-graph", "-o", "old-name", "-n", "new-name"]);
    expect(out).toContain("old-name → new-name");
    expect(fs.existsSync(path.join(tmpDir, ".graph", "new-name", "graph.yaml"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, ".graph", "active"), "utf-8").trim()).toBe("new-name");
    const err = runFail(["rename-graph", "-o", "old-name", "-n", "x-y"]);
    expect(err).toContain("已更名为 \"new-name\"");
  });

  it("delete：无 --confirm 拒绝；active 默认拒删；最后一张拒删；确认后进 .trash + 悬挂提示", () => {
    run(["init", "keep-me", "-l", "K"]);
    run(["init", "doomed", "-l", "D"]);
    run(["switch", "keep-me"]);
    // 无 confirm
    expect(runFail(["delete-graph", "-i", "doomed"])).toContain("--confirm");
    // active 默认拒删
    expect(runFail(["delete-graph", "-i", "keep-me", "--confirm"])).toContain("工作区默认图");
    const out = run(["delete-graph", "-i", "doomed", "--confirm"]);
    expect(out).toContain("已软删除");
    expect(fs.readdirSync(path.join(tmpDir, ".graph", ".trash"))[0]).toMatch(/^doomed-\d+$/);
    // 悬挂提示
    const err = runFail(["delete-graph", "-i", "doomed", "--confirm"]);
    expect(err).toContain(".trash");
    // 最后一张拒删
    expect(runFail(["delete-graph", "-i", "keep-me", "--confirm"])).toContain("最后一张图");
  });
});

describe("--graph 参数与 SUPER_PLUMBER_GRAPH", () => {
  it("--graph 定向：create-node 落到指定图而非 active", () => {
    run(["init", "graph-one", "-l", "一"]);
    run(["init", "graph-two", "-l", "二"]);
    run(["create-node", "-i", "n1", "-l", "节点", "--graph", "graph-one"]);
    expect(fs.existsSync(path.join(tmpDir, ".graph", "graph-one", "nodes", "n1.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".graph", "graph-two", "nodes", "n1.yaml"))).toBe(false);
  });

  it("--graph 错名 → 报错列全部图", () => {
    run(["init", "graph-one", "-l", "一"]);
    const res = spawnSync(process.execPath, [CLI_PATH, "status", "--graph", "ghost"], {
      cwd: tmpDir, encoding: "utf-8",
    });
    expect(`${res.stdout}${res.stderr}`).toContain("graph-one");
  });

  it("SUPER_PLUMBER_GRAPH 环境变量定向（优先于 active）", () => {
    run(["init", "aa", "-l", "A"]);
    run(["init", "bb", "-l", "B"]);
    run(["switch", "aa"]);
    const res = spawnSync(process.execPath, [CLI_PATH, "switch"], {
      cwd: tmpDir, encoding: "utf-8",
      env: { ...process.env, SUPER_PLUMBER_GRAPH: "bb" },
    });
    expect(res.stdout).toContain("当前图: bb");
    expect(res.stdout).toContain("SUPER_PLUMBER_GRAPH");
  });

  it("关键输出首行标图名（status/update-status/next）", () => {
    run(["init", "echo-test", "-l", "E"]);
    run(["create-node", "-i", "t1", "-l", "T"]);
    const st = run(["status"]);
    expect(st).toContain("图: echo-test");
    const j = JSON.parse(run(["next", "--json"]));
    expect(j.graph).toBe("echo-test");
  });
});
