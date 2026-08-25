// tests/core/graph-dir-escaping.test.ts — f15/S3-5+N4：createGraph 手拼 YAML → yaml.dump 回归
// N4 PoC 基线（2026-08-25 r1 交叉评审实测确认）：label 含 冒号/井号/引号/换行 四形，
// 旧实现手拼 `label: ${label}` 模板——冒号形 graph.yaml 不可解析（init 退出码 0 但
// status 误报"无 graph.yaml"）；换行形静默注入额外字段（tampered: true）且
// graph validate 零错误。修复后必须：yaml.load 通过 + validateGraph 零 issue + 无注入。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "js-yaml";
import { createGraph } from "../../src/core/graph-dir.js";
import { validateGraph } from "../../src/core/schema.js";
import { readGraph } from "../../src/core/parser.js";

let tmpDir: string; // 工作区根

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f15-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function loadGraphYaml(graphName: string): Record<string, unknown> {
  const file = path.join(tmpDir, ".graph", graphName, "graph.yaml");
  return yaml.load(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
}

/** N4 PoC 四形 */
const N4_LABELS: Array<[string, string]> = [
  ["colon", "auth: phase 1"],
  ["hash", "task #1 注释"],
  ["quote", 'he said "hi"'],
  ["newline", "line1\n  tampered: true"],
];

describe("createGraph label 转义（N4 PoC 四形回归，f15）", () => {
  for (const [name, label] of N4_LABELS) {
    it(`label 含 ${name}：yaml.load 通过 + validateGraph 零 issue + 无字段注入`, () => {
      createGraph(tmpDir, `esc-${name}`, label);

      // 1. yaml.load 通过（旧实现：冒号形直接不可解析）
      const doc = loadGraphYaml(`esc-${name}`);

      // 2. validateGraph 零 issue（from src/core/schema.js）
      expect(validateGraph(doc)).toEqual([]);

      // 3. label 原样 round-trip
      expect(doc.label).toBe(label);

      // 4. 骨架键集之外零多余——换行形不得静默注入任何字段（如 tampered）
      expect(Object.keys(doc).sort()).toEqual([
        "edges",
        "entry",
        "exit",
        "id",
        "label",
        "nodes",
      ]);
      expect(doc).not.toHaveProperty("tampered");

      // 5. 正规读路径同样通过（status 误报"无 graph.yaml"的根因消除）
      expect(readGraph(path.join(tmpDir, ".graph", `esc-${name}`)).label).toBe(label);
    });
  }

  it("同毫秒建两图 id 不撞（随机后缀）；version 仍原样落盘", () => {
    createGraph(tmpDir, "graph-a", "A", { version: "1.2.3" });
    createGraph(tmpDir, "graph-b", "B", { version: "1.2.3" });
    const a = loadGraphYaml("graph-a");
    const b = loadGraphYaml("graph-b");
    expect(a.id).not.toBe(b.id); // 旧实现 graph_${Date.now()} 毫秒粒度会撞
    expect(a.id).toMatch(/^graph_\d+_[0-9a-z]{1,8}$/);
    expect(b.id).toMatch(/^graph_\d+_[0-9a-z]{1,8}$/);
    expect(a.version).toBe("1.2.3");
    expect(b.version).toBe("1.2.3");
  });
});
