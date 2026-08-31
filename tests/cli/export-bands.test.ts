// tests/cli/export-bands.test.ts — IL-004：mermaid 导出按 level 分期带 subgraph 分组
// 与大图分段导出（filterByLevels/--levels/--band-name）。
// 平铺现状的形状/配色/头注释回归在 export-styling.test.ts 与 export-escaping.test.ts；
// 本文件锁定分期带结构、稳定排序（Git diff 友好）与分段过滤语义。
import { describe, it, expect } from "vitest";
import {
  buildMermaid,
  filterByLevels,
  parseLevels,
  parseBandNames,
} from "../../src/cli/export-mermaid.js";
import type { NodeSchema, EdgeSchema } from "../../src/core/types.js";

// ── 测试数据工厂：builders 只消费 id/type/label/status/level 与 source/target/type ──
function node(
  id: string,
  opts: { type?: string; label?: string; status?: string; level?: number } = {},
): NodeSchema {
  return {
    id,
    type: opts.type ?? "task",
    label: opts.label ?? id,
    level: opts.level ?? 1,
    status: opts.status ?? "pending",
    attempts: 0,
    max_attempts: 3,
    created_at: "",
    updated_at: "",
  } as unknown as NodeSchema;
}

function edge(id: string, source: string, target: string, type: string): EdgeSchema {
  return { id, source, target, type } as unknown as EdgeSchema;
}

const idx = (haystack: string, needle: string) => haystack.indexOf(needle);

describe("分期带 subgraph 分组（groupByLevel）", () => {
  const nodes = [
    node("t-l2b", { level: 2, label: "二期乙", status: "pending" }),
    node("ctx-pay", { type: "context", label: "支付域" }),
    node("t-l1a", { level: 1, label: "一期甲", status: "running" }),
    node("adr-7", { type: "adr", label: "决策七", status: "accepted" }),
    node("t-l2a", { level: 2, label: "二期甲", status: "passed" }),
    node("t-l1b", { level: 1, label: "一期乙", status: "pending" }),
  ];
  const edges = [edge("e1", "t-l1a", "t-l2a", "depends_on"), edge("d1", "adr-7", "t-l1a", "decides")];

  it("平铺缺省（不传 options）保持现状：无 subgraph", () => {
    const m = buildMermaid(nodes, edges);
    expect(m).not.toContain("subgraph");
    expect(m).toContain(`  t-l1a["一期甲"]:::running;`);
  });

  it("按 level 生成 subgraph 分组：带升序、带内按 id 排序、知识顶点不入带", () => {
    const m = buildMermaid(nodes, edges, undefined, { groupByLevel: true });
    // 带升序
    expect(idx(m, "subgraph band_L1[")).toBeLessThan(idx(m, "subgraph band_L2["));
    // 带内按 id 排序（输入乱序，输出 t-l2a 在 t-l2b 前）
    expect(idx(m, "t-l2a[")).toBeLessThan(idx(m, "t-l2b["));
    // 知识顶点在 subgraph 之前、不入带（横切领域知识）
    expect(idx(m, `ctx-pay(["支付域"]):::context;`)).toBeLessThan(idx(m, "subgraph band_L1["));
    expect(idx(m, `adr-7{{"决策七"}}:::adr_accepted;`)).toBeLessThan(idx(m, "subgraph band_L1["));
    // 结构完整：每组有 end；边仍只出现一次且在分组之后
    expect(m.match(/  end\n/g)?.length).toBe(2);
    expect(idx(m, `t-l1a -->|"depends on"| t-l2a;`)).toBeGreaterThan(idx(m, "  end\n"));
    // 形状/配色映射不变：带内节点行与平铺同构（仅缩进加深）
    expect(m).toContain(`    t-l1a["一期甲"]:::running;`);
  });

  it("缺省组名 L<n>；--band-name 提供分期域名时显示 L<n> · 域名", () => {
    const m = buildMermaid(nodes, edges, undefined, { groupByLevel: true });
    expect(m).toContain(`  subgraph band_L1["L1"]`);
    expect(m).toContain(`  subgraph band_L2["L2"]`);

    const named = buildMermaid(nodes, edges, undefined, {
      groupByLevel: true,
      bandNames: { 1: "前置修复带", 2: "0.8.x 决策落地期" },
    });
    expect(named).toContain(`  subgraph band_L1["L1 · 前置修复带"]`);
    expect(named).toContain(`  subgraph band_L2["L2 · 0.8.x 决策落地期"]`);
  });

  it("组名经 escapeMermaidLabel 转义（\" → #quot;）", () => {
    const m = buildMermaid(nodes, edges, undefined, {
      groupByLevel: true,
      bandNames: { 1: '带"名' },
    });
    expect(m).toContain(`  subgraph band_L1["L1 · 带#quot;名"]`);
  });

  it("entry/exit 头注释在分组模式下保留（现状承载方式不变）", () => {
    const m = buildMermaid(nodes, edges, {
      entry: { description: "需求一句话" },
      exit: { description: "完成定义", acceptance_criteria: ["标准一"] },
    }, { groupByLevel: true });
    expect(m).toContain("%% entry: 需求一句话");
    expect(m).toContain("%% exit: 完成定义");
    expect(m).toContain("%% - 标准一");
  });

  it("稳定排序：节点输入顺序不同的两次导出逐字节一致（Git diff 噪音可控）", () => {
    const shuffled = [...nodes].reverse();
    const a = buildMermaid(nodes, edges, undefined, { groupByLevel: true });
    const b = buildMermaid(shuffled, edges, undefined, { groupByLevel: true });
    expect(a).toBe(b);
  });

  it("单带小图也成组；全知识顶点图不产生空 subgraph", () => {
    const single = buildMermaid([node("t1")], [], undefined, { groupByLevel: true });
    expect(single).toContain("subgraph band_L1[");
    const pureKnowledge = buildMermaid(
      [node("ctx1", { type: "context" }), node("adr1", { type: "adr", status: "proposed" })],
      [],
      undefined,
      { groupByLevel: true },
    );
    expect(pureKnowledge).not.toContain("subgraph");
  });
});

describe("filterByLevels（大图分段导出）", () => {
  // L1 工作流 ×2、L2 工作流 ×1；ctx 挂 L1 边、adr 挂 L2 边；另有一条纯知识 relates 边
  const nodes = [
    node("adr-7", { type: "adr", status: "accepted" }),
    node("ctx-a", { type: "context" }),
    node("ctx-b", { type: "context" }),
    node("a1", { level: 1 }),
    node("a2", { level: 1 }),
    node("b1", { level: 2 }),
  ];
  const edges = [
    edge("e-cross", "a1", "b1", "depends_on"), // 跨带边
    edge("e-ctx", "ctx-a", "a1", "depends_on"), // 知识顶点→保留工作流
    edge("e-adr", "adr-7", "b1", "decides"), // 指向被过滤带的知识边
    edge("e-rel", "ctx-a", "ctx-b", "relates"), // 纯知识边
    edge("e-in", "a1", "a2", "depends_on"), // 带内边
  ];

  it("单带分段：跨带工作流边丢弃，知识顶点仅随保留边带走", () => {
    const { nodes: ns, edges: es } = filterByLevels(nodes, edges, [1]);
    expect(ns.map((n) => n.id).sort()).toEqual(["a1", "a2", "ctx-a"]);
    expect(es.map((e) => e.id).sort()).toEqual(["e-ctx", "e-in"]);
  });

  it("多带分段：带间边保留，未引用的知识顶点被裁掉", () => {
    const { nodes: ns, edges: es } = filterByLevels(nodes, edges, [1, 2]);
    expect(ns.map((n) => n.id).sort()).toEqual(["a1", "a2", "adr-7", "b1", "ctx-a"]);
    expect(es.map((e) => e.id).sort()).toEqual(["e-adr", "e-cross", "e-ctx", "e-in"]);
  });

  it("空 level 集：工作流全滤掉，知识顶点随之清空", () => {
    const { nodes: ns, edges: es } = filterByLevels(nodes, edges, []);
    expect(ns).toEqual([]);
    expect(es).toEqual([]);
  });

  it("分段结果可直接进 buildMermaid 分组导出（组合行为）", () => {
    const { nodes: ns, edges: es } = filterByLevels(nodes, edges, [1]);
    const m = buildMermaid(ns, es, undefined, { groupByLevel: true, bandNames: { 1: "一期" } });
    expect(m).toContain(`  subgraph band_L1["L1 · 一期"]`);
    expect(m).not.toContain("band_L2");
    expect(m).toContain(`  ctx-a(["ctx-a"]):::context;`);
  });
});

describe("参数解析（parseLevels / parseBandNames）", () => {
  it("parseLevels：逗号分隔整数；容忍空格", () => {
    expect(parseLevels("1,2,3")).toEqual([1, 2, 3]);
    expect(parseLevels(" 1 , 4 ")).toEqual([1, 4]);
    expect(parseLevels("0")).toEqual([0]);
  });

  it("parseLevels：非法输入响亮抛错（负例全覆盖）", () => {
    for (const bad of ["", "a,b", "1,", "1.5", "一,二"]) {
      expect(() => parseLevels(bad)).toThrow(/--levels 参数无效/);
    }
  });

  it("parseBandNames：<level>=<名称> 可重复解析，后者覆盖前者", () => {
    expect(parseBandNames(["1=前置修复带", "2=0.8.x 决策落地期"])).toEqual({
      1: "前置修复带",
      2: "0.8.x 决策落地期",
    });
    expect(parseBandNames(["1=a", "1=b"])).toEqual({ 1: "b" });
    // 名称本身可含 =（按第一个 = 切分）
    expect(parseBandNames(["3=k=v"])).toEqual({ 3: "k=v" });
  });

  it("parseBandNames：缺 level、缺名称、非整数 level 响亮抛错", () => {
    for (const bad of ["前置修复带", "1=", "=名", "x=名", ""]) {
      expect(() => parseBandNames([bad])).toThrow(/--band-name 参数无效/);
    }
  });
});
