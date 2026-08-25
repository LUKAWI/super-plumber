// tests/core/write-validation.test.ts
// f5 回归（A2/S1-8/N2）：写前校验架构。
// 此前"读时校验、写时放行"——毒化对象（NaN/负数 level、缺字段、非法枚举）
// 落盘成功后，后续任何全图读取（status/get-node/list）都会失败（延时炸弹）。
// 写路径统一执法后，毒化在源头被拒、文件不落盘、图保持可读（毒化链闭环）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  ensureGraphDir,
  writeNode,
  readNode,
  writeEdge,
  readEdge,
  writeGraph,
} from "../../src/core/parser.js";
import { createNode } from "../../src/core/node.js";
import { isValidEntityId } from "../../src/core/schema.js";
import {
  NodeType,
  NodeStatus,
  EdgeType,
  type NodeSchema,
  type EdgeSchema,
  type GraphSchema,
} from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-writeguard-"));
  ensureGraphDir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function baseNode(overrides: Partial<NodeSchema> = {}): NodeSchema {
  return {
    id: "n1",
    type: NodeType.Task,
    label: "测试",
    level: 1,
    status: NodeStatus.Pending,
    attempts: 0,
    max_attempts: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("A2 写前校验（writeNode/writeEdge/writeGraph）", () => {
  it("level: NaN 的节点落盘被拒，文件不落盘，后续读取不中毒（毒化链闭环）", () => {
    expect(() => writeNode(tmpDir, baseNode({ level: Number.NaN }))).toThrow(
      /写前校验失败/,
    );
    expect(fs.existsSync(path.join(tmpDir, ".graph/nodes/n1.yaml"))).toBe(false);
    expect(() => readNode(tmpDir, "n1")).toThrow(/not found/);
  });

  it("level 为负数的节点落盘被拒（yaml.dump 会产出 -1，读侧 min 校验的写侧前移）", () => {
    expect(() => writeNode(tmpDir, baseNode({ level: -1 }))).toThrow(/写前校验失败/);
    expect(fs.existsSync(path.join(tmpDir, ".graph/nodes/n1.yaml"))).toBe(false);
  });

  it("attempts: NaN 落盘被拒（S1-1 core 侧：yaml.dump 会产出 .nan 毒化文件）", () => {
    expect(() => writeNode(tmpDir, baseNode({ attempts: Number.NaN }))).toThrow(
      /attempts/,
    );
  });

  it("缺 type 的节点落盘被拒（S1-6 同源缺口在写侧同样拦截）", () => {
    const { type: _omit, ...rest } = baseNode();
    expect(() => writeNode(tmpDir, rest as NodeSchema)).toThrow(/type/);
  });

  it("合法节点照常落盘可读（校验不误伤正常路径）", () => {
    writeNode(tmpDir, baseNode());
    expect(readNode(tmpDir, "n1").id).toBe("n1");
  });

  it("毒化边（缺 source）落盘被拒且不落盘", () => {
    const edge = {
      id: "e1",
      target: "n1",
      type: EdgeType.DependsOn,
    } as unknown as EdgeSchema;
    expect(() => writeEdge(tmpDir, edge)).toThrow(/写前校验失败/);
    expect(fs.existsSync(path.join(tmpDir, ".graph/edges/e1.yaml"))).toBe(false);
  });

  it("缺 label 的 graph 落盘被拒且不落盘", () => {
    const g = { id: "graph_1", nodes: [], edges: [] } as unknown as GraphSchema;
    expect(() => writeGraph(tmpDir, g)).toThrow(/写前校验失败/);
    expect(fs.existsSync(path.join(tmpDir, ".graph/graph.yaml"))).toBe(false);
  });
});

describe("S1-8 contract 校验目标修正", () => {
  const base = { id: "e1", source: "n1", target: "n2", type: EdgeType.DependsOn };

  it("contract.validation.method 非法值被拒（旧代码校验不存在的顶层 contract.method，从未真正拦截）", () => {
    const edge = {
      ...base,
      contract: { validation: { method: "猜谜" } },
    } as unknown as EdgeSchema;
    expect(() => writeEdge(tmpDir, edge)).toThrow(/contract\.validation\.method/);
    expect(fs.existsSync(path.join(tmpDir, ".graph/edges/e1.yaml"))).toBe(false);
  });

  it("contract.consumed_by 元素缺字段被拒（旧代码只查是数组不查元素）", () => {
    const edge = {
      ...base,
      contract: { consumed_by: [{ artifact: "报告" }] },
    } as unknown as EdgeSchema;
    expect(() => writeEdge(tmpDir, edge)).toThrow(/contract\.consumed_by/);
  });

  it("contract.validation.required 非布尔被拒", () => {
    const edge = {
      ...base,
      contract: { validation: { required: "yes" } },
    } as unknown as EdgeSchema;
    expect(() => writeEdge(tmpDir, edge)).toThrow(/contract\.validation\.required/);
  });

  it("合法 contract 照常落盘可读", () => {
    const edge = {
      ...base,
      contract: {
        produces: "审查报告",
        consumed_by: [{ artifact: "审查报告", used_as: "裁决输入" }],
        validation: { required: true, method: "auto" },
      },
    } as EdgeSchema;
    writeEdge(tmpDir, edge);
    expect(readEdge(tmpDir, "e1").contract?.validation?.method).toBe("auto");
  });

  it("读侧同型拦截：手编文件的非法 validation.method 读取被拒", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".graph/edges/e2.yaml"),
      "id: e2\nsource: n1\ntarget: n2\ntype: depends_on\ncontract:\n  validation:\n    method: 非法\n",
      "utf-8",
    );
    expect(() => readEdge(tmpDir, "e2")).toThrow(/contract\.validation\.method/);
  });
});

describe("N2 Windows 保留设备名拒绝", () => {
  it.each(["con", "nul", "aux", "prn", "com1", "com9", "lpt1", "lpt9"])(
    "保留名 %s 被 isValidEntityId 拒绝",
    (id) => {
      expect(isValidEntityId(id)).toBe(false);
    },
  );

  it("保留名加点形态（con.check）同拒；非保留前缀（n1.con）不受影响", () => {
    expect(isValidEntityId("con.check")).toBe(false);
    expect(isValidEntityId("n1.con")).toBe(true);
  });

  it("createNode 在入口即拒保留名 ID（不触碰文件系统）", () => {
    expect(() =>
      createNode(tmpDir, { id: "con", label: "坏", type: NodeType.Task }),
    ).toThrow(/保留名/);
  });
});
