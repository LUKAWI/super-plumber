// tests/core/graph-class.test.ts — arch-c4a：工作类 class 枚举单源证明（GRAPH_CLASSES）。
// 断言四件事：
//   1. 类型层：types.GraphClass 联合与 schema.ts 的 GRAPH_CLASSES 完全一致（编译期钳）；
//   2. 运行时：GRAPH_CLASSES 恰为 quick|standard|program 三值；
//   3. 执法一致：validateGraph 对枚举内值放行、外值拒绝（schema 执法 == 单源枚举）；
//   4. 消费一致：CLI（dist）拒绝行为与错误文案、SCHEMA_DOC 文档行、MCP（dist）
//      graph_update_graph 的 inputSchema 枚举均随 GRAPH_CLASSES 走，无第二定义。
// CLI/MCP 段断言针对 dist 构建（vitest 前置 npm run build），与既有 CLI/MCP 测试同构。
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { GRAPH_CLASSES, validateGraph } from "../../src/core/schema.js";
import type { GraphClass } from "../../src/core/types.js";

const CLI = path.resolve("dist/cli/index.js");

// 类型层双向钳（编译期即证：枚举与联合互为镜像，缺值/多值 → 编译失败）
type _EnumCoversUnion = [Exclude<GraphClass, (typeof GRAPH_CLASSES)[number]>] extends [never] ? true : never;
const _ENUM_COVERS_UNION: _EnumCoversUnion = true;

function skeletonGraph() {
  return {
    id: "g1",
    version: "0.9.0",
    label: "class-test",
    entry: { description: "e", defined_by: "human" as const, level: 0 },
    exit: { description: "x", acceptance_criteria: [], defined_by: "human" as const, level: 0 },
    nodes: [],
    edges: [],
  };
}

function runIn(dir: string, args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf-8" });
}

function freshDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "topo-class-"));
}

describe("GRAPH_CLASSES 单源（arch-c4a：core/schema.ts）", () => {
  it("枚举值恰为 quick|standard|program（types.GraphClass 为其类型镜像，编译钳双向生效）", () => {
    expect([...GRAPH_CLASSES]).toEqual(["quick", "standard", "program"]);
  });

  it("schema 执法与单源一致：枚举内放行、外值拒绝", () => {
    for (const c of GRAPH_CLASSES) {
      expect(validateGraph({ ...skeletonGraph(), class: c }), `class=${c}`).toEqual([]);
    }
    for (const bad of ["huge", "Quick", ""]) {
      const issues = validateGraph({ ...skeletonGraph(), class: bad });
      expect(issues.some((i) => i.field === "class"), `class=${bad}`).toBe(true);
    }
  });
});

describe("class 单源消费（CLI，断言 dist 构建）", () => {
  it("枚举内三值 init --class 全部放行并透出；schema.yaml 文档行随枚举生成", () => {
    for (const c of GRAPH_CLASSES) {
      const dir = freshDir();
      try {
        const r = runIn(dir, ["init", "t", "--class", c]);
        expect(r.status, `init --class ${c}`).toBe(0);
        const s = JSON.parse(runIn(dir, ["status", "--json"]).stdout as string);
        expect(s.class).toBe(c);
        const doc = fs.readFileSync(path.join(dir, ".graph", "schema.yaml"), "utf-8");
        expect(doc).toContain(`# class: ${GRAPH_CLASSES.join("|")}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("非法值拒绝（init 与 update-graph 同源）：exit 1，文案来自 GRAPH_CLASSES，不落盘", () => {
    const dir = freshDir();
    try {
      const r = runIn(dir, ["init", "bad", "--class", "huge"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`--class 仅允许 ${GRAPH_CLASSES.join(" | ")}（收到: huge）`);
      expect(fs.existsSync(path.join(dir, ".graph", "bad"))).toBe(false);
      runIn(dir, ["init", "t"]);
      const r2 = runIn(dir, ["update-graph", "--class", "huge"]);
      expect(r2.status).toBe(1);
      expect(r2.stderr).toContain(`--class 仅允许 ${GRAPH_CLASSES.join(" | ")}（收到: huge）`);
      const s = JSON.parse(runIn(dir, ["status", "--json"]).stdout as string);
      expect(s.class).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("class 单源消费（MCP，断言 dist 构建）", () => {
  it("graph_update_graph 的 inputSchema class 枚举 == GRAPH_CLASSES", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const dir = freshDir();
    let client: InstanceType<typeof Client> | undefined;
    try {
      spawnSync(process.execPath, [CLI, "init", "t"], { cwd: dir, encoding: "utf-8" });
      const transport = new StdioClientTransport({
        command: "node",
        args: [path.resolve("dist/mcp/server.js")],
        cwd: dir,
      });
      client = new Client({ name: "test", version: "0.1.1" });
      await client.connect(transport);
      const tools = await client.listTools();
      const tool = tools.tools.find((t) => t.name === "graph_update_graph")!;
      expect(tool).toBeDefined();
      const classSchema = (tool.inputSchema as any).properties?.class;
      expect(classSchema).toBeDefined();
      expect(classSchema.enum).toEqual([...GRAPH_CLASSES]);
    } finally {
      await client?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
