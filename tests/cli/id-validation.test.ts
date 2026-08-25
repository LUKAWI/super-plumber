// tests/cli/id-validation.test.ts
// S0-3/S3-13 回归：实体 ID 全链路格式校验。
// S0-3：id 直接拼文件路径（nodes/<id>.yaml），穿越形 ID（../、分隔符、冒号…）
//       在核心层咽喉点（nodeFilePath/readNode/createEdge…）被拒，不落盘。
// S3-13：列表按 .deleted 后缀模式排除软删除文件——合法 id 含 .deleted 子串
//       （如 n1.deleted-check）不再被静默隐藏；以 .deleted 结尾的 id 因与软删除
//       文件名空间二义，创建即拒。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-idv-"));
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

function nodesDir(): string {
  return path.join(tmpDir, ".graph", "t", "nodes");
}

describe("实体 ID 校验（S0-3/S3-13）", () => {
  it("IDV-01 穿越形/非法 id 的 create-node 被拒且零落盘", () => {
    init();
    expect(run(["create-node", "-i", "a", "-l", "A"]).status).toBe(0); // 先有一个合法节点（保证 nodes/ 存在）
    const bad = [
      "../evil",
      "../../evil",
      "n/deep",
      "n\\deep",
      "C:evil",
      "..",
      ".hidden",
      "UPPER",
      "中文",
      "",
      "n*star",
      "a".repeat(65),
      "v9.deleted", // 与软删除文件名二义
      "v8.deleted.123", // 同上（带时间戳形态）
    ];
    for (const id of bad) {
      const r = run(["create-node", "-i", id, "-l", "x"]);
      expect(r.status, `id=${JSON.stringify(id)}`).toBe(1);
      expect(r.stderr, `id=${JSON.stringify(id)}`).toContain("非法节点 ID");
    }
    // 图目录外无任何新文件（穿越未发生）；图内只有最初的 a.yaml
    expect(fs.existsSync(path.join(path.dirname(tmpDir), "evil.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(path.dirname(tmpDir)), "evil.yaml"))).toBe(false);
    expect(fs.readdirSync(nodesDir()).sort()).toEqual(["a.yaml"]);
  });

  it("IDV-02 add-edge 非法 id / 非法端点被拒", () => {
    init();
    expect(run(["create-node", "-i", "a", "-l", "A"]).status).toBe(0);
    expect(run(["create-node", "-i", "b", "-l", "B"]).status).toBe(0);
    const bad = [
      ["e/1", "a", "b"],
      ["../steal", "a", "b"],
      ["e1", "../a", "b"],
      ["e2", "a", "b/x"],
    ];
    for (const [id, s, t] of bad) {
      const r = run(["add-edge", "-i", id, "-s", s, "-t", t, "--type", "depends_on"]);
      expect(r.status, `edge id=${id}`).toBe(1);
      // CLI 的前置存在性检查可能先报"不存在"（add-edge.ts 不在本修复边界）——
      // 关键断言：拒绝且零落盘
      expect(r.stderr, `edge id=${id}`).toMatch(/非法边|不存在/);
    }
    expect(fs.readdirSync(path.join(tmpDir, ".graph", "t", "edges")).length).toBe(0);
  });

  it("IDV-03 合法 id 含 .deleted 子串在列表中可见（S3-13）", () => {
    init();
    expect(run(["create-node", "-i", "n1.deleted-check", "-l", "子串可见"]).status).toBe(0);
    const st = run(["status", "--json"]);
    expect(st.status).toBe(0);
    expect(JSON.parse(st.stdout).nodes).toBe(1);
    expect(fs.readdirSync(nodesDir())).toEqual(["n1.deleted-check.yaml"]);
  });

  it("IDV-04 软删除历史文件不进列表，同名节点可重建", () => {
    init();
    expect(run(["create-node", "-i", "a", "-l", "A"]).status).toBe(0);
    expect(run(["delete-node", "-i", "a"]).status).toBe(0);
    // 软删除后：文件保留（a.deleted.yaml），列表为空
    expect(fs.readdirSync(nodesDir()).sort()).toEqual(["a.deleted.yaml"]);
    expect(JSON.parse(run(["status", "--json"]).stdout).nodes).toBe(0);
    // 同名重建可见（活跃 a.yaml 与历史 a.deleted.yaml 共存）
    expect(run(["create-node", "-i", "a", "-l", "A2"]).status).toBe(0);
    expect(JSON.parse(run(["status", "--json"]).stdout).nodes).toBe(1);
  });

  it("IDV-05 手编非法 id 的 context 文件在 export --docs 全链路被拒（无图外落盘）", () => {
    init();
    const evilYaml = [
      "id: ctx/../evil",
      "type: context",
      "label: 恶意",
      "level: 1",
      "status: pending",
      "attempts: 0",
      "max_attempts: 3",
      "created_at: 2026-08-24T00:00:00.000Z",
      "updated_at: 2026-08-24T00:00:00.000Z",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(nodesDir(), "ctx_evil.yaml"), evilYaml, "utf-8");
    const r = run(["export", "--docs"]);
    expect(r.status).not.toBe(0); // 读时 schema 校验拦截
    expect(r.stdout + r.stderr).not.toContain("导出完成");
    // 未在任何位置生成穿越产物
    expect(fs.existsSync(path.join(tmpDir, "docs", "contexts"))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(tmpDir), "evil.md"))).toBe(false);
  });
});
