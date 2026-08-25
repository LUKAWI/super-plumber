// tests/cli/snapshot-git.test.ts
// S0-1/S0-2 回归：snapshot --git 的命令注入与路径修复。
// S0-1：--message 曾被直接拼入 execSync shell 字符串，元字符可执行任意命令；
//       修复后消息作为单个 argv 传给 git commit，落库为字面量。
// S0-2：v0.5.2 多图布局下 cwd 是图目录，`git add .graph` 找 .graph/.graph 必然
//       pathspec 失败；修复后以工作区根为 cwd、add 图目录自身。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-snapgit-"));
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

function git(args: string[]) {
  return spawnSync("git", args, { cwd: tmpDir, encoding: "utf-8" });
}

function initRepoAndGraph() {
  expect(git(["init"]).status).toBe(0);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "test"]);
  const r = run(["init", "g1", "-l", "测试图"]);
  expect(r.status).toBe(0);
}

describe("snapshot --git（S0-1 注入 / S0-2 路径）", () => {
  it("GIT-01 多图布局下 --git 成功 commit（不再 pathspec 失败）", () => {
    initRepoAndGraph();
    const cn = run(["create-node", "-i", "n1", "-l", "节点", "--graph", "g1"]);
    expect(cn.status).toBe(0);

    const r = run(["snapshot", "-m", "基线", "--git", "--graph", "g1"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("已创建 Git commit");

    const log = git(["log", "-1", "--format=%s"]);
    expect(log.status).toBe(0);
    expect(log.stdout).toContain(`snapshot: `);
    // commit 内容包含图目录（.graph/g1 已被 add）
    const show = git(["show", "--stat", "--name-only", "--format="]);
    expect(show.stdout).toContain(path.join(".graph", "g1", "graph.yaml").replace(/\\/g, "/"));
  });

  it("GIT-02 shell 元字符消息原样落库、不执行（S0-1）", () => {
    initRepoAndGraph();
    const payload = `x"; touch PWNED; echo "y$(touch PWNED2)\`touch PWNED3\`&|`;
    const r = run(["snapshot", "-m", payload, "--git", "--graph", "g1"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("已创建 Git commit");

    // 注入的命令一个都没执行
    expect(fs.existsSync(path.join(tmpDir, "PWNED"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "PWNED2"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "PWNED3"))).toBe(false);
    // 消息作为字面量完整落库（未被 shell 拆解）
    const log = git(["log", "-1", "--format=%B"]);
    expect(log.stdout).toContain(payload);
  });

  it("GIT-03 无 git 仓库时快照仍保存、--git 优雅失败不崩（非 0 退出码不误报成功）", () => {
    initRepoAndGraph();
    fs.rmSync(path.join(tmpDir, ".git"), { recursive: true, force: true });
    const r = run(["snapshot", "-m", "无仓库", "--git", "--graph", "g1"]);
    expect(r.status).toBe(0); // 快照本体成功
    expect(r.stdout).toContain("快照"); // snapshot 已创建
    expect(r.stdout + r.stderr).toContain("Git commit 失败"); // git 部分降级为警告
    // 快照目录真实存在（主操作不受 git 失败影响）
    expect(fs.existsSync(path.join(tmpDir, ".graph", "g1", "snapshots"))).toBe(true);
  });
});
