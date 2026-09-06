import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as yaml from "js-yaml";

const CLI = path.resolve("dist/cli/index.js");
const templates = [
  ["vertical-slice", 3, 2],
  ["expand-contract", 3, 2],
  ["research-decision-build", 4, 3],
  ["hardening", 4, 3],
] as const;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("F19 graph init --template", () => {
  it.each(templates)("生成 %s 模板骨架与示例节点", (template, nodeCount, edgeCount) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "topo-template-"));
    tempDirs.push(cwd);
    execFileSync(process.execPath, [CLI, "init", "demo", "--template", template], {
      cwd,
      encoding: "utf8",
    });

    const graphDir = path.join(cwd, ".graph", "demo");
    const graph = yaml.load(fs.readFileSync(path.join(graphDir, "graph.yaml"), "utf8")) as {
      entry: { description: string };
      exit: { description: string; acceptance_criteria: unknown[] };
    };
    expect(graph.entry.description).toBe("");
    expect(graph.exit.description).toBe("");
    expect(graph.exit.acceptance_criteria).toEqual([]);
    expect(fs.readdirSync(path.join(graphDir, "nodes")).filter((name) => name.endsWith(".yaml"))).toHaveLength(nodeCount);
    expect(fs.readdirSync(path.join(graphDir, "edges")).filter((name) => name.endsWith(".yaml"))).toHaveLength(edgeCount);
  });

  it("拒绝未知模板，避免生成半成品", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "topo-template-invalid-"));
    tempDirs.push(cwd);
    expect(() => execFileSync(process.execPath, [CLI, "init", "demo", "--template", "unknown"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    })).toThrow();
    expect(fs.existsSync(path.join(cwd, ".graph"))).toBe(false);
  });
});
