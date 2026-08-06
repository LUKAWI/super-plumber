// tests/cli/error-paths.test.ts
// CLI 错误路径回归测试：每个已知 bug 一个失败测试（TDD RED）
// BUG-01 update-node ENOENT 裸崩溃 → 应友好报错 exit 1
// BUG-04 checkpoint status 静默强制 pending → 应校验枚举
// BUG-06 validate 未 init EXIT=0 → 应 exit 1
// BUG-07 rebuild 未 init 假成功 → 应 exit 1 且不建 index
// BUG-08 status 拓扑失败 EXIT=0 → 应 exit 1
// BUG-10 create-node 未 init 半初始化 → 应报错 exit 1
// BUG-11 重复 init 覆盖 → 应报错 exit 1 且不覆盖
// BUG-09 serve 端口占用裸崩溃 → 应友好报错
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-err-"));
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
  const r = run(["init"]);
  expect(r.status).toBe(0);
}

describe("CLI error paths (regression)", () => {
  it("BUG-01 update-node 不存在节点 → exit 1 友好报错（非 ENOENT 堆栈）", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    const r = run(["update-node", "--id", "ghost", "--plan-desc", "x"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("不存在");
    expect(r.stderr).not.toContain("ENOENT");
    expect(r.stderr).not.toContain("at Module");
  });

  it("BUG-01b update-node --show 不存在节点 → exit 1 友好报错", () => {
    init();
    const r = run(["update-node", "--id", "ghost", "--show"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("不存在");
    expect(r.stderr).not.toContain("ENOENT");
  });

  it("BUG-04 update-node --add-checkpoint 非法 status → exit 1 报错（不静默强制 pending）", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    const r = run([
      "update-node",
      "--id",
      "a",
      "--add-checkpoint",
      '{"id":"cp1","label":"Step","status":"done"}',
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("非法");
    const content = fs.readFileSync(
      path.join(tmpDir, ".graph/nodes/a.yaml"),
      "utf-8",
    );
    expect(content).not.toContain("done");
  });

  it("BUG-04b update-node --add-checkpoint 合法 status 被保留（不强制 pending）", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    const r = run([
      "update-node",
      "--id",
      "a",
      "--add-checkpoint",
      '{"id":"cp1","label":"Step","status":"passed"}',
    ]);
    expect(r.status).toBe(0);
    const content = fs.readFileSync(
      path.join(tmpDir, ".graph/nodes/a.yaml"),
      "utf-8",
    );
    expect(content).toContain("passed");
  });

  it("BUG-06 validate 未 init → exit 1", () => {
    const r = run(["validate"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("未初始化");
  });

  it("BUG-07 rebuild 未 init → exit 1 且不自动创建 index", () => {
    const r = run(["rebuild"]);
    expect(r.status).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, ".graph/index/graph.json"))).toBe(
      false,
    );
  });

  it("BUG-08 status 真环图（拓扑失败）→ exit 1", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    run(["create-node", "--id", "b", "--label", "B"]);
    run([
      "add-edge",
      "--id",
      "e1",
      "--source",
      "a",
      "--target",
      "b",
      "--type",
      "depends_on",
    ]);
    run([
      "add-edge",
      "--id",
      "e2",
      "--source",
      "b",
      "--target",
      "a",
      "--type",
      "depends_on",
    ]);
    const r = run(["status"]);
    expect(r.status).toBe(1);
  });

  it("BUG-08b status 幽灵边（拓扑可忽略）→ exit 0（幽灵边由 validate 报错）", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    // 手工写一条指向不存在节点的边（模拟历史数据/手工编辑）
    fs.mkdirSync(path.join(tmpDir, ".graph/edges"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".graph/edges/e1.yaml"),
      "id: e1\nsource: a\ntarget: ghost\ntype: depends_on\n",
    );
    const r = run(["status"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✅ 拓扑排序通过");
  });

  it("BUG-10 create-node 未 init → exit 1（不创建孤儿节点）", () => {
    const r = run(["create-node", "--id", "x", "--label", "X"]);
    expect(r.status).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, ".graph/nodes/x.yaml"))).toBe(false);
  });

  it("BUG-11 重复 init → exit 1 且不覆盖原 label", () => {
    const r1 = run(["init", "--label", "First"]);
    expect(r1.status).toBe(0);
    const r2 = run(["init", "--label", "Second"]);
    expect(r2.status).toBe(1);
    const content = fs.readFileSync(
      path.join(tmpDir, ".graph/graph.yaml"),
      "utf-8",
    );
    expect(content).toContain("First");
    expect(content).not.toContain("Second");
  });

  it("BUG-11b 重复 init --force 允许覆盖", () => {
    run(["init", "--label", "First"]);
    const r = run(["init", "--label", "Second", "--force"]);
    expect(r.status).toBe(0);
    const content = fs.readFileSync(
      path.join(tmpDir, ".graph/graph.yaml"),
      "utf-8",
    );
    expect(content).toContain("Second");
  });

  it("BUG-09 serve 端口占用 → 友好报错（非 unhandled error 堆栈）", () => {
    init();
    // 先占用一个端口
    const net = require("node:net");
    const blocker = net.createServer();
    return new Promise<void>((resolve) => {
      blocker.listen(0, () => {
        const port = (blocker.address() as { port: number }).port;
        const r = spawnSync(
          process.execPath,
          [CLI, "serve", "-p", String(port)],
          {
            cwd: tmpDir,
            encoding: "utf-8",
            timeout: 15000,
          },
        );
        blocker.close();
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("占用");
        expect(r.stderr).not.toContain("Unhandled 'error' event");
        resolve();
      });
    });
  });
});
