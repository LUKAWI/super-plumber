// tests/cli/schema-required.test.ts
// S1-6/S1-10/S2-5/S2-6 回归：schema 必填对齐与 validate 完善。
// S1-6：仅 id/label 的手编节点曾被 as T 放行（下游拿到 undefined 产出垃圾分布）。
// S1-10：旧式单图 init --force 只清 graph.yaml 引用不清节点文件——readdir 与
//        refs 永久矛盾；现改为整目录重置（迁移→trash→重建）。
// S2-5：max_attempts=0（不限）误报超限。S2-6：引用完整性只查单方向。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-req-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: tmpDir, encoding: "utf-8" });
}

function init() {
  expect(run(["init", "t"]).status).toBe(0);
}

function fullNodeYaml(id: string): string {
  return [
    `id: ${id}`,
    "type: task",
    `label: ${id}`,
    "level: 1",
    "status: pending",
    "attempts: 0",
    "max_attempts: 3",
    // 时间戳必须带引号：js-yaml 会把裸 ISO 时间戳解析成 Date 对象（工具写盘
    // 时 dumper 自动加引号，手编文件同理——与工具产物完全一致的形态）
    'created_at: "2026-08-24T00:00:00.000Z"',
    'updated_at: "2026-08-24T00:00:00.000Z"',
    "",
  ].join("\n");
}

describe("schema 必填对齐与 validate 完善（S1-6/S1-10/S2-5/S2-6）", () => {
  it("REQ-01 仅 id/label 的手编节点被读时校验拒绝（S1-6）", () => {
    init();
    const nodesDir = path.join(tmpDir, ".graph", "t", "nodes");
    fs.writeFileSync(path.join(nodesDir, "minimal.yaml"), "id: minimal\nlabel: 最小节点\n", "utf-8");
    // get-node 拒绝并列出缺失字段
    const g = run(["get-node", "-i", "minimal"]);
    expect(g.status).toBe(1);
    expect(g.stderr).toContain("schema 校验失败");
    expect(g.stderr).toContain("status");
    // validate --json 同样报出全部缺失字段
    const v = run(["validate", "--json"]);
    expect(v.status).toBe(1);
    const out = JSON.parse(v.stdout);
    const fields = out.errors.join(" ");
    for (const f of ["type", "status", "level", "attempts", "max_attempts", "created_at", "updated_at"]) {
      expect(fields, `缺失字段 ${f}`).toContain(f);
    }
  });

  it("REQ-02 全字段手编节点照常通过（必填收紧无误伤）", () => {
    init();
    fs.writeFileSync(path.join(tmpDir, ".graph", "t", "nodes", "hand.yaml"), fullNodeYaml("hand"), "utf-8");
    const g = run(["get-node", "-i", "hand"]);
    expect(g.status).toBe(0);
  });

  it("REQ-03 init 无名 --force 整目录重置旧式单图（S1-10）", () => {
    // 手工构造旧布局：.graph/graph.yaml 在根 + 一个节点
    const gdir = path.join(tmpDir, ".graph");
    fs.mkdirSync(path.join(gdir, "nodes"), { recursive: true });
    fs.writeFileSync(path.join(gdir, "graph.yaml"), "id: g_legacy\nlabel: 旧图\n", "utf-8");
    fs.writeFileSync(path.join(gdir, "nodes", "old.yaml"), fullNodeYaml("old"), "utf-8");

    const r = run(["init", "--force", "-l", "重置图"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("整目录重置");
    // 旧内容进了 .trash（可救回），新 .graph/default 干净且 refs 一致
    expect(fs.readdirSync(path.join(gdir, ".trash")).length).toBe(1);
    const newNodes = path.join(gdir, "default", "nodes");
    expect(fs.readdirSync(newNodes).length).toBe(0);
    expect(fs.existsSync(path.join(gdir, "graph.yaml"))).toBe(false); // 已迁移走
    // active 指向 default，status/validate 自洽（无"未引用文件"告警）
    expect(fs.readFileSync(path.join(gdir, "active"), "utf-8").trim()).toBe("default");
    const st = run(["status"]);
    expect(st.status).toBe(0);
    const v = run(["validate", "--json"]);
    expect(JSON.parse(v.stdout).warnings.join(" ")).not.toContain("未引用已存在");
  });

  it("REQ-04 max_attempts=0 不再误报超限（S2-5）", () => {
    init();
    expect(run(["create-node", "-i", "n1", "-l", "x"]).status).toBe(0);
    expect(run(["update-node", "-i", "n1", "--max-attempts", "0"]).status).toBe(0);
    // 手工把 attempts 改成 5（绕过状态机模拟历史遗留），validate 不应报超限
    const f = path.join(tmpDir, ".graph", "t", "nodes", "n1.yaml");
    fs.writeFileSync(f, fs.readFileSync(f, "utf-8").replace("attempts: 0", "attempts: 5"), "utf-8");
    const v = run(["validate", "--json"]);
    expect(v.status).toBe(0);
    expect(JSON.parse(v.stdout).warnings.join(" ")).not.toContain("超出最大重试次数");
  });

  it("REQ-05 文件存在但 refs 未引用 → 告警；rebuild 修复（S2-6）", () => {
    init();
    expect(run(["create-node", "-i", "n1", "-l", "x"]).status).toBe(0);
    // 手工清空引用（模拟 S1-4 丢引用竞态 / S1-10 半重置残留）——用 nodes: [] 外科
    // 替换保持 YAML 合法（粗暴删行会让 nodes 变 null、validate 在 graph schema
    // 检查处提前退出，走不到引用检查）
    const gf = path.join(tmpDir, ".graph", "t", "graph.yaml");
    fs.writeFileSync(
      gf,
      fs.readFileSync(gf, "utf-8").replace("nodes:\n  - file: nodes/n1.yaml\n", "nodes: []\n"),
      "utf-8",
    );
    const v1 = run(["validate", "--json"]);
    expect(JSON.parse(v1.stdout).warnings.join(" ")).toContain("未引用已存在的节点文件");
    // 补回引用 → 告警消失（检测的精确性：有 refs 且文件在则静默）
    // 注：CLI 目前没有重建 refs 的命令（graph rebuild 只重建 index 缓存）——
    // 补全修复入口属 f10（MCP 工具补全）范围
    fs.writeFileSync(
      gf,
      fs.readFileSync(gf, "utf-8").replace("nodes: []\n", "nodes:\n  - file: nodes/n1.yaml\n"),
      "utf-8",
    );
    const v2 = run(["validate", "--json"]);
    expect(JSON.parse(v2.stdout).warnings.join(" ")).not.toContain("未引用已存在的节点文件");
  });
});
