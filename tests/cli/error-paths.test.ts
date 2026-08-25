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
  const r = run(["init", "t"]);
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
      path.join(tmpDir, ".graph/t/nodes/a.yaml"),
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
      path.join(tmpDir, ".graph/t/nodes/a.yaml"),
      "utf-8",
    );
    expect(content).toContain("passed");
  });

  it("BUG-06 validate 未 init → exit 1", () => {
    const r = run(["validate"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("未初始化");
  });

  it("BUG-06b validate nodes 目录损坏（是文件非目录）→ exit 1 而非假成功", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    // 把 nodes 目录换成同名文件 → listNodes readdirSync 抛错
    fs.rmSync(path.join(tmpDir, ".graph/t/nodes"), { recursive: true, force: true });
    fs.writeFileSync(path.join(tmpDir, ".graph/t/nodes"), "not a directory");
    const r = run(["validate"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("无法读取 nodes/ 目录");
  });

  it("BUG-06c validate edges 目录损坏 → exit 1 而非假成功", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    fs.rmSync(path.join(tmpDir, ".graph/t/edges"), { recursive: true, force: true });
    fs.writeFileSync(path.join(tmpDir, ".graph/t/edges"), "not a directory");
    const r = run(["validate"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("无法读取 edges/ 目录");
  });

  it("BUG-07 rebuild 未 init → exit 1 且不自动创建 index", () => {
    const r = run(["rebuild"]);
    expect(r.status).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/index/graph.json"))).toBe(
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
    fs.mkdirSync(path.join(tmpDir, ".graph/t/edges"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".graph/t/edges/e1.yaml"),
      "id: e1\nsource: a\ntarget: ghost\ntype: depends_on\n",
    );
    const r = run(["status"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✅ 拓扑排序通过");
  });

  it("BUG-10 create-node 未 init → exit 1（不创建孤儿节点）", () => {
    const r = run(["create-node", "--id", "x", "--label", "X"]);
    expect(r.status).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/nodes/x.yaml"))).toBe(false);
  });

  it("BUG-11 重复 init → exit 1 且不覆盖原 label", () => {
    const r1 = run(["init",
        "t", "--label", "First"]);
    expect(r1.status).toBe(0);
    const r2 = run(["init",
        "t", "--label", "Second"]);
    expect(r2.status).toBe(1);
    const content = fs.readFileSync(
      path.join(tmpDir, ".graph/t/graph.yaml"),
      "utf-8",
    );
    expect(content).toContain("First");
    expect(content).not.toContain("Second");
  });

  it("BUG-11b 重复 init --force 允许覆盖", () => {
    run(["init",
        "t", "--label", "First"]);
    const r = run(["init",
        "t", "--label", "Second", "--force"]);
    expect(r.status).toBe(0);
    const content = fs.readFileSync(
      path.join(tmpDir, ".graph/t/graph.yaml"),
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
      blocker.listen(0, "127.0.0.1", () => {  // S0-5：serve 现绑 127.0.0.1，占用方须同族才冲突
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

  it("GATE-01 前驱未完成时 pending→ready → exit 1 且点名前驱", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    run(["create-node", "--id", "b", "--label", "B"]);
    run(["add-edge", "--id", "e1", "--source", "a", "--target", "b"]);
    const r = run(["update-status", "--id", "b", "--status", "ready"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("前置未满足");
    expect(r.stderr).toContain("a(pending");
  });

  it("GATE-02 --force 绕过 ready 门禁", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    run(["create-node", "--id", "b", "--label", "B"]);
    run(["add-edge", "--id", "e1", "--source", "a", "--target", "b"]);
    const r = run(["update-status", "--id", "b", "--status", "ready", "--force"]);
    expect(r.status).toBe(0);
  });

  it("GATE-03 update-status --claim-by 记录认领者", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    run(["update-status", "--id", "a", "--status", "ready"]);
    const r = run([
      "update-status",
      "--id",
      "a",
      "--status",
      "running",
      "--claim-by",
      "agent-1",
    ]);
    expect(r.status).toBe(0);
    const content = fs.readFileSync(
      path.join(tmpDir, ".graph/t/nodes/a.yaml"),
      "utf-8",
    );
    expect(content).toContain("agent-1");
    expect(content).toContain("started_at");
  });

  it("ATT-01 failed→pending 超过 max_attempts → exit 1", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    // 快速走完 3 次失败（attempts 0→3）
    for (let i = 0; i < 3; i++) {
      run(["update-status", "--id", "a", "--status", "ready"]);
      run(["update-status", "--id", "a", "--status", "running"]);
      run(["update-status", "--id", "a", "--status", "failed"]);
      run(["update-status", "--id", "a", "--status", "pending"]);
    }
    const r = run(["update-status", "--id", "a", "--status", "ready"]);
    expect(r.status).toBe(0); // ready 不受限
    run(["update-status", "--id", "a", "--status", "running"]);
    run(["update-status", "--id", "a", "--status", "failed"]);
    const blocked = run(["update-status", "--id", "a", "--status", "pending"]);
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain("最大重试次数");
  });

  it("ATT-02 --force 覆盖 max_attempts 拦截", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    for (let i = 0; i < 3; i++) {
      run(["update-status", "--id", "a", "--status", "ready"]);
      run(["update-status", "--id", "a", "--status", "running"]);
      run(["update-status", "--id", "a", "--status", "failed"]);
      run(["update-status", "--id", "a", "--status", "pending"]);
    }
    run(["update-status", "--id", "a", "--status", "ready"]);
    run(["update-status", "--id", "a", "--status", "running"]);
    run(["update-status", "--id", "a", "--status", "failed"]);
    const r = run(["update-status", "--id", "a", "--status", "pending", "--force"]);
    expect(r.status).toBe(0);
  });

  it("DEL-01 delete-node 有引用边 → exit 1 并列出边", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    run(["create-node", "--id", "b", "--label", "B"]);
    run(["add-edge", "--id", "e1", "--source", "a", "--target", "b"]);
    const r = run(["delete-node", "--id", "a"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("e1");
    // 节点未被删除
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/nodes/a.yaml"))).toBe(true);
  });

  it("DEL-02 delete-node --cascade 连同引用边软删除", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    run(["create-node", "--id", "b", "--label", "B"]);
    run(["add-edge", "--id", "e1", "--source", "a", "--target", "b"]);
    const r = run(["delete-node", "--id", "a", "--cascade"]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/nodes/a.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/nodes/a.deleted.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/edges/e1.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/edges/e1.deleted.yaml"))).toBe(true);
    // validate 不报悬挂引用
    const v = run(["validate"]);
    expect(v.stdout).toContain("0 错误");
  });

  it("DEL-03 delete-edge 正常软删除 + 不存在报错", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    run(["create-node", "--id", "b", "--label", "B"]);
    run(["add-edge", "--id", "e1", "--source", "a", "--target", "b"]);
    const ok = run(["delete-edge", "--id", "e1"]);
    expect(ok.status).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/edges/e1.deleted.yaml"))).toBe(true);
    const missing = run(["delete-edge", "--id", "ghost"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("not found");
  });

  it("SCH-01 手改 YAML 拼错 status → validate exit 1 且报 schema 错误", () => {
    init();
    run(["create-node", "--id", "a", "--label", "A"]);
    fs.writeFileSync(
      path.join(tmpDir, ".graph/t/nodes/a.yaml"),
      "id: a\nlabel: A\nstatus: runnig\nattempts: 0\nmax_attempts: 3\n",
    );
    const r = run(["validate"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nodes/a.yaml");
    expect(r.stderr).toContain("status");
    // 其他命令读取该节点时也应得到可读错误而非崩溃
    const g = run(["update-node", "--id", "a", "--show"]);
    expect(g.status).toBe(1);
    expect(g.stderr).toContain("schema");
  });
});
