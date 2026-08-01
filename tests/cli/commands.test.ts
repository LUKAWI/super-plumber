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
    run("init --label test-graph");
    expect(fs.existsSync(path.join(tmpDir, ".graph/graph.yaml"))).toBe(true);
  });

  it("graph create-node 创建节点文件", () => {
    run("init");
    run('create-node --id t1 --label "Task 1"');
    expect(fs.existsSync(path.join(tmpDir, ".graph/nodes/t1.yaml"))).toBe(true);
  });

  it("graph add-edge 创建边文件", () => {
    run("init");
    run("create-node --id a --label A");
    run("create-node --id b --label B");
    run("add-edge --id e1 --source a --target b");
    expect(fs.existsSync(path.join(tmpDir, ".graph/edges/e1.yaml"))).toBe(true);
  });

  it("graph status 不报错", () => {
    run("init");
    const output = run("status");
    expect(output).toContain("图:");
  });

  it("graph export --mermaid 生成文件", () => {
    run("init");
    run("create-node --id a --label A");
    run("create-node --id b --label B");
    run("add-edge --id e1 --source a --target b");
    run("export --mermaid -o test.mmd");
    const content = fs.readFileSync(path.join(tmpDir, "test.mmd"), "utf-8");
    expect(content).toContain("graph TD");
    expect(content).toContain("a");
  });

  it("graph init 创建完整目录骨架", () => {
    run("init");
    for (const d of ["nodes", "edges", "index", "snapshots"]) {
      expect(fs.existsSync(path.join(tmpDir, ".graph", d)), d).toBe(true);
    }
  });

  it("graph create-node 重复 id 报错且不覆盖原数据", () => {
    run("init");
    run("create-node --id dup --label First");
    expect(() => run("create-node --id dup --label Second")).toThrow();
    const content = fs.readFileSync(
      path.join(tmpDir, ".graph/nodes/dup.yaml"),
      "utf-8",
    );
    expect(content).toContain("First");
  });

  it("graph add-edge 引用不存在的节点时报错", () => {
    run("init");
    run("create-node --id a --label A");
    expect(() => run("add-edge --id e1 --source ghost --target a")).toThrow();
  });

  it("graph add-edge 非法边类型时报错", () => {
    run("init");
    run("create-node --id a --label A");
    run("create-node --id b --label B");
    expect(() =>
      run("add-edge --id e1 --source a --target b --type bogus"),
    ).toThrow();
  });

  it("graph delete-node 后 status 不再统计该节点", () => {
    run("init");
    run("create-node --id a --label A");
    run("create-node --id b --label B");
    run("delete-node --id a");
    const output = run("status");
    expect(output).toContain("节点数: 1");
  });

  it("graph delete-node 不存在的节点时报错", () => {
    run("init");
    expect(() => run("delete-node --id ghost")).toThrow();
  });
});
