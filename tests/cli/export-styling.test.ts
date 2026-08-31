// tests/cli/export-styling.test.ts — 0.6.2 导出表达升级：顶点形状/配色、边样式、
// entry/exit 头注释映射（Mermaid 与 DOT 语义对齐）。
// 转义回归在 export-escaping.test.ts（保持纯净）；本文件锁定表达层映射。
import { describe, it, expect } from "vitest";
import {
  buildMermaid,
  vertexClass,
  vertexColors,
  classDefStyle,
  mermaidEdgeStyle,
  EDGE_STYLE_LEGEND,
  type GraphExportMeta,
} from "../../src/cli/export-mermaid.js";
import { buildDotTopology, dotEdgeAttrs } from "../../src/cli/rebuild.js";
import type { NodeSchema, EdgeSchema } from "../../src/core/types.js";

// ── 测试数据工厂：builders 只消费 id/type/label/status 与 source/target/type ──
function node(
  id: string,
  opts: { type?: string; label?: string; status?: string } = {},
): NodeSchema {
  return {
    id,
    type: opts.type ?? "task",
    label: opts.label ?? id,
    level: 1,
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

const LEGEND_LINE = EDGE_STYLE_LEGEND;

describe("顶点形状（Mermaid）", () => {
  it("工作流顶点保持矩形 + 状态 class（现状不变）", () => {
    const m = buildMermaid([node("t1", { label: "任务", status: "running" })], []);
    expect(m).toContain(`  t1["任务"]:::running;`);
  });

  it("context 顶点为胶囊形，固定 context class，不接工作流状态 class", () => {
    const m = buildMermaid(
      [node("ctx1", { type: "context", label: "支付域", status: "pending" })],
      [],
    );
    expect(m).toContain(`  ctx1(["支付域"]):::context;`);
    expect(m).not.toMatch(/ctx1\([^\n]*:::pending/);
    expect(m).toContain("  classDef context fill:#4db6ac,stroke:#00897b;");
    expect(m).not.toContain("classDef pending");
  });

  it("ADR 顶点为六边形，class 按 adr_<status>，三态调色板各就各位", () => {
    const m = buildMermaid(
      [
        node("adr1", { type: "adr", label: "ADR 1", status: "proposed" }),
        node("adr2", { type: "adr", label: "ADR 2", status: "accepted" }),
        node("adr3", { type: "adr", label: "ADR 3", status: "superseded" }),
      ],
      [],
    );
    expect(m).toContain(`  adr1{{"ADR 1"}}:::adr_proposed;`);
    expect(m).toContain(`  adr2{{"ADR 2"}}:::adr_accepted;`);
    expect(m).toContain(`  adr3{{"ADR 3"}}:::adr_superseded;`);
    expect(m).toContain("classDef adr_proposed fill:#ffb74d,stroke:#ef6c00;");
    expect(m).toContain("classDef adr_accepted fill:#81c784,stroke:#388e3c;");
    expect(m).toContain("classDef adr_superseded fill:#bdbdbd,stroke:#757575;");
  });

  it("ADR 顶点意外挂工作流状态 → 兜底灰（防御，不报错）", () => {
    const m = buildMermaid([node("adrx", { type: "adr", status: "pending" })], []);
    expect(m).toContain(`  adrx{{"adrx"}}:::adr_pending;`);
    expect(m).toContain("classDef adr_pending fill:#8a8f98,stroke:#5b5f66;");
  });
});

describe("顶点形状与配色（DOT，与 Mermaid 同源调色板）", () => {
  it("工作流顶点 shape=box + style=filled + 七态 fillcolor，label 仍带状态行", () => {
    const statuses: [string, string, string][] = [
      ["pending", "#8a8f98", "#5b5f66"],
      ["ready", "#4a93e8", "#2f6fbc"],
      ["running", "#f0a73a", "#c07f1d"],
      ["passed", "#16a34a", "#0e7a37"],
      ["failed", "#e5504f", "#b93231"],
      ["blocked", "#a574e6", "#7d4fc0"],
      ["cancelled", "#5b5f66", "#3d4147"],
    ];
    const dot = buildDotTopology(
      statuses.map(([s], i) => node(`n${i}`, { status: s })),
      [],
    );
    for (const [i, [s, fill, stroke]] of statuses.entries()) {
      expect(dot).toContain(
        `"n${i}" [label="n${i}\\n${s}", shape=box, style=filled, fillcolor="${fill}", color="${stroke}"];`,
      );
    }
  });

  it("context 顶点 shape=ellipse + teal，label 不带状态行", () => {
    const dot = buildDotTopology(
      [node("ctx1", { type: "context", label: `支付 "域"`, status: "pending" })],
      [],
    );
    expect(dot).toContain(
      `"ctx1" [label="支付 \\"域\\"", shape=ellipse, style=filled, fillcolor="#4db6ac", color="#00897b"];`,
    );
    expect(dot).not.toContain("\\npending");
  });

  it("ADR 顶点 shape=hexagon + 三态配色，label 带 adr 状态行", () => {
    const dot = buildDotTopology(
      [
        node("adr1", { type: "adr", status: "proposed" }),
        node("adr2", { type: "adr", status: "accepted" }),
        node("adr3", { type: "adr", status: "superseded" }),
      ],
      [],
    );
    expect(dot).toContain(
      `"adr1" [label="adr1\\nproposed", shape=hexagon, style=filled, fillcolor="#ffb74d", color="#ef6c00"];`,
    );
    expect(dot).toContain(
      `"adr2" [label="adr2\\naccepted", shape=hexagon, style=filled, fillcolor="#81c784", color="#388e3c"];`,
    );
    expect(dot).toContain(
      `"adr3" [label="adr3\\nsuperseded", shape=hexagon, style=filled, fillcolor="#bdbdbd", color="#757575"];`,
    );
  });

  it("ADR 顶点意外挂工作流状态 → 兜底灰", () => {
    const dot = buildDotTopology([node("adrx", { type: "adr", status: "ready" })], []);
    expect(dot).toContain(
      `"adrx" [label="adrx\\nready", shape=hexagon, style=filled, fillcolor="#8a8f98", color="#5b5f66"];`,
    );
  });
});

describe("边样式（Mermaid）", () => {
  it("硬边（depends_on/validates/fan_out/fan_in）保持实线箭头（现状不变）", () => {
    const m = buildMermaid(
      [],
      [
        edge("e1", "a", "b", "depends_on"),
        edge("e2", "a", "b", "validates"),
        edge("e3", "a", "b", "fan_out"),
        edge("e4", "a", "b", "fan_in"),
      ],
    );
    expect(m).toContain(`  a -->|"depends on"| b;`);
    expect(m).toContain(`  a -->|"validates"| b;`);
    expect(m).toContain(`  a -->|"fan out"| b;`);
    expect(m).toContain(`  a -->|"fan in"| b;`);
  });

  it("decides/fallback/iterates 为虚线箭头", () => {
    const m = buildMermaid(
      [],
      [
        edge("e1", "a", "b", "decides"),
        edge("e2", "a", "b", "fallback"),
        edge("e3", "a", "b", "iterates"),
      ],
    );
    expect(m).toContain(`  a -.->|"decides"| b;`);
    expect(m).toContain(`  a -.->|"fallback"| b;`);
    expect(m).toContain(`  a -.->|"iterates"| b;`);
  });

  it("relates 为点线无箭头；shares_context 为无箭头开线", () => {
    const m = buildMermaid(
      [],
      [edge("e1", "c1", "c2", "relates"), edge("e2", "c1", "c2", "shares_context")],
    );
    expect(m).toContain(`  c1 -.-|"relates"| c2;`);
    expect(m).toContain(`  c1 ---|"shares context"| c2;`);
  });

  it("未知边类型兜底走实线箭头", () => {
    const m = buildMermaid([], [edge("e1", "a", "b", "mystery_type")]);
    expect(m).toContain(`  a -->|"mystery type"| b;`);
  });

  it("mermaidEdgeStyle 分类齐全（9 种已知类型 + 未知兜底）", () => {
    expect(mermaidEdgeStyle("depends_on")).toBe("solid-arrow");
    expect(mermaidEdgeStyle("validates")).toBe("solid-arrow");
    expect(mermaidEdgeStyle("fan_out")).toBe("solid-arrow");
    expect(mermaidEdgeStyle("fan_in")).toBe("solid-arrow");
    expect(mermaidEdgeStyle("decides")).toBe("dashed-arrow");
    expect(mermaidEdgeStyle("fallback")).toBe("dashed-arrow");
    expect(mermaidEdgeStyle("iterates")).toBe("dashed-arrow");
    expect(mermaidEdgeStyle("relates")).toBe("dotted-open");
    expect(mermaidEdgeStyle("shares_context")).toBe("open-link");
    expect(mermaidEdgeStyle("whatever")).toBe("solid-arrow");
  });
});

describe("边样式（DOT，与 Mermaid 语义对齐）", () => {
  it("硬边保持默认实线箭头", () => {
    expect(dotEdgeAttrs("depends_on")).toBe(`label="depends on"`);
    expect(dotEdgeAttrs("validates")).toBe(`label="validates"`);
    expect(dotEdgeAttrs("fan_out")).toBe(`label="fan out"`);
    expect(dotEdgeAttrs("fan_in")).toBe(`label="fan in"`);
  });

  it("decides/fallback/iterates 为 style=dashed", () => {
    expect(dotEdgeAttrs("decides")).toBe(`label="decides", style=dashed`);
    expect(dotEdgeAttrs("fallback")).toBe(`label="fallback", style=dashed`);
    expect(dotEdgeAttrs("iterates")).toBe(`label="iterates", style=dashed`);
  });

  it("relates 为 style=dotted + dir=none；shares_context 为 dir=none", () => {
    expect(dotEdgeAttrs("relates")).toBe(`label="relates", style=dotted, dir=none`);
    expect(dotEdgeAttrs("shares_context")).toBe(`label="shares context", dir=none`);
  });

  it("未知边类型兜底默认实线箭头", () => {
    expect(dotEdgeAttrs("mystery_type")).toBe(`label="mystery type"`);
  });

  it("边行组装完整（source/target 定界 + 属性）", () => {
    const dot = buildDotTopology([], [edge("e1", "adr-7", "t1", "decides")]);
    expect(dot).toContain(`  "adr-7" -> "t1" [label="decides", style=dashed];`);
  });
});

describe("头注释（entry/exit 图例）", () => {
  it("Mermaid：entry/exit/验收标准逐条呈现 + 边样式图例", () => {
    const meta: GraphExportMeta = {
      entry: { description: "导出表达升级" },
      exit: { description: "两格式对齐", acceptance_criteria: ["单测全绿", "构建零错误"] },
    };
    const m = buildMermaid([], [], meta);
    expect(m).toContain("%% entry: 导出表达升级");
    expect(m).toContain("%% exit: 两格式对齐");
    expect(m).toContain("%% 验收标准:");
    expect(m).toContain("%% - 单测全绿");
    expect(m).toContain("%% - 构建零错误");
    expect(m).toContain(`%% 边样式图例:\n%% ${LEGEND_LINE}`);
  });

  it("Mermaid：entry/exit/验收标准缺省时跳过对应行，图例恒在", () => {
    const m = buildMermaid([], [], undefined);
    expect(m).not.toContain("%% entry:");
    expect(m).not.toContain("%% exit:");
    expect(m).not.toContain("%% 验收标准:");
    expect(m).toContain(`%% ${LEGEND_LINE}`);

    const m2 = buildMermaid([], [], { exit: { description: "完成" } });
    expect(m2).not.toContain("%% entry:");
    expect(m2).toContain("%% exit: 完成");
    expect(m2).not.toContain("%% 验收标准:");
  });

  it("Mermaid：注释内换行折叠为空格（注释不可跨行）", () => {
    const m = buildMermaid([], [], {
      entry: { description: "第一行\n第二行\r\n第三行" },
    });
    expect(m).toContain("%% entry: 第一行 第二行 第三行");
    expect(m.split("\n").every((l) => !l.startsWith("%% 第一行"))).toBe(true);
  });

  it("DOT：entry/exit 两行 + 边样式一行图例（精简同款）", () => {
    const dot = buildDotTopology([], [], {
      entry: { description: "导出表达升级" },
      exit: { description: "两格式对齐" },
    });
    expect(dot).toContain("// entry: 导出表达升级");
    expect(dot).toContain("// exit: 两格式对齐");
    expect(dot).toContain(`// 边样式: ${LEGEND_LINE}`);
  });

  it("DOT：entry/exit 缺省时跳过对应行", () => {
    const dot = buildDotTopology([], [], undefined);
    expect(dot).not.toContain("// entry:");
    expect(dot).not.toContain("// exit:");
    expect(dot).toContain(`// 边样式: ${LEGEND_LINE}`);
  });
});

describe("共享映射纯函数", () => {
  it("vertexClass：工作流=状态 / context 固定 / adr=adr_<status>", () => {
    expect(vertexClass({ type: "task", status: "ready" })).toBe("ready");
    expect(vertexClass({ type: "gate", status: "blocked" })).toBe("blocked");
    expect(vertexClass({ type: "context", status: "pending" })).toBe("context");
    expect(vertexClass({ type: "adr", status: "superseded" })).toBe("adr_superseded");
  });

  it("vertexColors：三组调色板 + 兜底灰", () => {
    expect(vertexColors({ type: "task", status: "passed" })).toEqual({
      fill: "#16a34a",
      stroke: "#0e7a37",
    });
    expect(vertexColors({ type: "context", status: "pending" })).toEqual({
      fill: "#4db6ac",
      stroke: "#00897b",
    });
    expect(vertexColors({ type: "adr", status: "proposed" })).toEqual({
      fill: "#ffb74d",
      stroke: "#ef6c00",
    });
    expect(vertexColors({ type: "adr", status: "running" })).toEqual({
      fill: "#8a8f98",
      stroke: "#5b5f66",
    });
    expect(vertexColors({ type: "task", status: "nope" })).toEqual({
      fill: "#8a8f98",
      stroke: "#5b5f66",
    });
  });

  it("classDefStyle 与 vertexColors 同源", () => {
    expect(classDefStyle("ready")).toBe("fill:#4a93e8,stroke:#2f6fbc");
    expect(classDefStyle("context")).toBe("fill:#4db6ac,stroke:#00897b");
    expect(classDefStyle("adr_accepted")).toBe("fill:#81c784,stroke:#388e3c");
    expect(classDefStyle("adr_weird")).toBe("fill:#8a8f98,stroke:#5b5f66");
  });
});

describe("整图文本锁定（小图端到端）", () => {
  it("Mermaid 全量输出逐字符匹配", () => {
    const m = buildMermaid(
      [
        node("t1", { label: "实现导出", status: "running" }),
        node("ctx-pay", { type: "context", label: "支付域", status: "pending" }),
        node("adr-7", { type: "adr", label: "用 YAML 存储", status: "accepted" }),
      ],
      [edge("d1", "adr-7", "t1", "decides")],
      {
        entry: { description: "导出表达升级" },
        exit: { description: "两格式对齐", acceptance_criteria: ["单测全绿"] },
      },
    );
    expect(m).toBe(
      `graph TD;
%% entry: 导出表达升级
%% exit: 两格式对齐
%% 验收标准:
%% - 单测全绿
%% 边样式图例:
%% ${LEGEND_LINE}
  %% 节点定义 (按状态着色)
  t1["实现导出"]:::running;
  ctx-pay(["支付域"]):::context;
  adr-7{{"用 YAML 存储"}}:::adr_accepted;

  %% 边
  adr-7 -.->|"decides"| t1;

  %% 样式定义
  classDef running fill:#f0a73a,stroke:#c07f1d;
  classDef context fill:#4db6ac,stroke:#00897b;
  classDef adr_accepted fill:#81c784,stroke:#388e3c;
`,
    );
  });

  it("DOT 全量输出逐字符匹配", () => {
    const dot = buildDotTopology(
      [
        node("t1", { label: "实现导出", status: "running" }),
        node("ctx-pay", { type: "context", label: "支付域", status: "pending" }),
        node("adr-7", { type: "adr", label: "用 YAML 存储", status: "accepted" }),
      ],
      [
        edge("d1", "adr-7", "t1", "decides"),
        edge("r1", "ctx-pay", "ctx-ord", "relates"),
      ],
      { entry: { description: "导出表达升级" }, exit: { description: "两格式对齐" } },
    );
    expect(dot).toBe(
      `// entry: 导出表达升级
// exit: 两格式对齐
// 边样式: ${LEGEND_LINE}
digraph topology {
  "t1" [label="实现导出\\nrunning", shape=box, style=filled, fillcolor="#f0a73a", color="#c07f1d"];
  "ctx-pay" [label="支付域", shape=ellipse, style=filled, fillcolor="#4db6ac", color="#00897b"];
  "adr-7" [label="用 YAML 存储\\naccepted", shape=hexagon, style=filled, fillcolor="#81c784", color="#388e3c"];
  "adr-7" -> "t1" [label="decides", style=dashed];
  "ctx-pay" -> "ctx-ord" [label="relates", style=dotted, dir=none];
}
`,
    );
  });
});

describe("敌意 label 端到端（转义与表达层协同）", () => {
  it('含 " 与换行的 label 经 buildMermaid 后仍语法安全', () => {
    const m = buildMermaid(
      [node("n1", { label: 'a"b\nc' })],
      [edge("e1", "x", "y", "decides")],
    );
    expect(m).toContain(`  n1["a#quot;b<br/>c"]:::pending;`);
    expect(m).toContain(`  x -.->|"decides"| y;`);
  });

  it('含 " \\ 换行的 label 经 buildDotTopology 后仍语法安全', () => {
    const dot = buildDotTopology([node("n1", { label: 'a"b\\c\nd' })], []);
    expect(dot).toContain(
      `"n1" [label="a\\"b\\\\c\\nd\\npending", shape=box, style=filled, fillcolor="#8a8f98", color="#5b5f66"];`,
    );
  });
});
