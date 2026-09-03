// tests/cli/commands.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

const CLI = `node "${path.resolve("dist/cli/index.js")}"`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-cli-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string): string {
  return execSync(`${CLI} ${args}`, { cwd: tmpDir, encoding: "utf-8" });
}

describe("CLI commands", () => {
  it("graph init 创建 .graph 目录", () => {
    run("init t --label test-graph");
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/graph.yaml"))).toBe(true);
  });

  it("graph create-node 创建节点文件", () => {
    run("init t");
    run('create-node --id t1 --label "Task 1"');
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/nodes/t1.yaml"))).toBe(true);
  });

  it("graph add-edge 创建边文件", () => {
    run("init t");
    run("create-node --id a --label A");
    run("create-node --id b --label B");
    run("add-edge --id e1 --source a --target b");
    expect(fs.existsSync(path.join(tmpDir, ".graph/t/edges/e1.yaml"))).toBe(true);
  });

  it("graph status 不报错", () => {
    run("init t");
    const output = run("status");
    expect(output).toContain("图:");
  });

  it("FIX-B1/F09 validate：隐藏环与 iterates 警告、fallback 不再警告（退出码仍 0）", () => {
    run("init t");
    run("create-node --id a --label A");
    run("create-node --id b --label B");
    // a -fan_out-> b + b -fan_in-> a：门禁互等隐藏环
    run("add-edge --id e1 --source a --target b --type fan_out");
    run("add-edge --id e2 --source b --target a --type fan_in");
    // fallback 边自 F09（adr_0017）起有最小读语义，不再触发任何警告
    run("add-edge --id e3 --source b --target a --type fallback");
    // iterates 仍为文档性标注（validate 逐条警告）
    run("add-edge --id e5 --source b --target a --type iterates");
    run("add-edge --id e4 --source b --target a --type shares_context");
    // 警告走 stderr（console.warn），合并捕获
    const out = execSync(`${CLI} validate 2>&1`, { cwd: tmpDir, encoding: "utf-8" });
    expect(out).toContain("隐藏环路");
    expect(out).toContain("边 e5 (iterates)");
    expect(out).toContain("文档性标注");
    expect(out).toContain("shares_context");
    expect(out).not.toContain("边 e3"); // fallback 不再产生警告
    // 警告不改变退出码（与既有 warning 语义一致）
    expect(() => run("validate")).not.toThrow();
  });

  it("F09 graph next 人读面渲染死节点标注（重试预算耗尽 + fallback 路线）", () => {
    run("init t");
    run("create-node --id a --label A");
    run("update-node --id a --max-attempts 1");
    run("create-node --id r --label R");
    run("add-edge --id f1 --source a --target r --type fallback");
    // a 完整失败两轮 → failed→pending 重试后 attempts=1 ≥ max_attempts=1（死节点）
    for (const s of ["ready", "running", "failed", "pending", "ready", "running", "failed"]) {
      run(`update-status -i a -s ${s}`);
    }
    const out = run("next");
    expect(out).toContain("重试预算耗尽");
    expect(out).toContain("fallback 路线: r(R)");
  });

  it("graph export --mermaid 生成文件", () => {
    run("init t");
    run("create-node --id a --label A");
    run("create-node --id b --label B");
    run("add-edge --id e1 --source a --target b");
    run("export --mermaid -o test.mmd");
    const content = fs.readFileSync(path.join(tmpDir, "test.mmd"), "utf-8");
    expect(content).toContain("graph TD");
    expect(content).toContain("a");
  });

  it("graph init 创建完整目录骨架", () => {
    run("init t");
    for (const d of ["nodes", "edges", "index", "snapshots", ".locks"]) {
      expect(fs.existsSync(path.join(tmpDir, ".graph", "t", d)), d).toBe(true);
    }
  });

  it("graph create-node 重复 id 报错且不覆盖原数据", () => {
    run("init t");
    run("create-node --id dup --label First");
    expect(() => run("create-node --id dup --label Second")).toThrow();
    const content = fs.readFileSync(
      path.join(tmpDir, ".graph/t/nodes/dup.yaml"),
      "utf-8",
    );
    expect(content).toContain("First");
  });

  it("graph add-edge 引用不存在的节点时报错", () => {
    run("init t");
    run("create-node --id a --label A");
    expect(() => run("add-edge --id e1 --source ghost --target a")).toThrow();
  });

  it("graph add-edge 非法边类型时报错", () => {
    run("init t");
    run("create-node --id a --label A");
    run("create-node --id b --label B");
    expect(() =>
      run("add-edge --id e1 --source a --target b --type bogus"),
    ).toThrow();
  });

  it("graph delete-node 后 status 不再统计该节点", () => {
    run("init t");
    run("create-node --id a --label A");
    run("create-node --id b --label B");
    run("delete-node --id a");
    const output = run("status");
    expect(output).toContain("节点数: 1");
  });

  it("graph delete-node 不存在的节点时报错", () => {
    run("init t");
    expect(() => run("delete-node --id ghost")).toThrow();
  });

  it("F14: graph delete-node --reason 理由写入 .deleted.yaml 与事件", () => {
    run("init t");
    run("create-node --id a --label A");
    // spawnSync 参数数组避免 Windows cmd 的引号剥除（同 update-node 用例）
    const { spawnSync } = require("node:child_process");
    const res = spawnSync(
      process.execPath,
      [
        path.resolve("dist/cli/index.js"),
        "delete-node",
        "--id",
        "a",
        "--reason",
        "superseded-by-v2-design",
      ],
      { cwd: tmpDir, encoding: "utf-8" },
    );
    expect(res.status).toBe(0);
    const deleted = fs.readFileSync(
      path.join(tmpDir, ".graph/t/nodes/a.deleted.yaml"),
      "utf-8",
    );
    expect(deleted).toContain("deleted_reason:");
    expect(deleted).toContain("superseded-by-v2-design");
    const events = fs.readFileSync(
      path.join(tmpDir, ".graph/t/events.jsonl"),
      "utf-8",
    );
    expect(events).toContain("superseded-by-v2-design");
    // DEC-3：理由是凭据不是拒绝条件——缺省仍可删除（前一个用例已覆盖无 reason 删除）
  });

  it("graph update-node --add-checkpoint 多次传参全部保留", () => {
    run("init t");
    run("create-node --id a --label A");
    // 用 spawnSync 参数数组避免 Windows cmd 的引号剥除
    const { spawnSync } = require("node:child_process");
    const res = spawnSync(
      process.execPath,
      [
        path.resolve("dist/cli/index.js"),
        "update-node",
        "--id",
        "a",
        "--add-checkpoint",
        '{"id":"cp1","label":"Step 1"}',
        "--add-checkpoint",
        '{"id":"cp2","label":"Step 2"}',
      ],
      { cwd: tmpDir, encoding: "utf-8" },
    );
    expect(res.status).toBe(0);
    const content = fs.readFileSync(
      path.join(tmpDir, ".graph/t/nodes/a.yaml"),
      "utf-8",
    );
    expect(content).toContain("cp1");
    expect(content).toContain("cp2");
  });

  it("短别名与完整命令等价（cn/ae/s/v）", () => {
    run("i t -l alias-test");
    run("cn -i a1 -l \"任务A\" -t task --level 1");
    run("cn -i a2 -l \"任务B\" -t task --level 1");
    run("ae -i e1 -s a1 -t a2 --type depends_on");
    // 状态概览（别名 s ≡ status）能看到两个节点
    const out = run("s");
    expect(out).toContain("节点数: 2");
    expect(out).toContain("边数: 1");
    // 校验（别名 v ≡ validate）0 错误
    expect(run("v")).toContain("0 错误");
  });
});
