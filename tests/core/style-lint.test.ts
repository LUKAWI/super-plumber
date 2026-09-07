// tests/core/style-lint.test.ts — F16 plan/DoD 文案 lint（manual §2.8 四原则，三类规则码 a/b/c）
// 覆盖：反误报样本（好文案含板块级文件落点声明零警告）、三类坏文案各报对应码、
// lint 恒 warning 不改 validate 退出码（CLI 实测）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { lintPlanWording, lintNodeWording } from "../../src/core/style-lint.js";

describe("F16 lintPlanWording：反误报样本（好文案零警告）", () => {
  it("manual §2.8 四条正例零警告", () => {
    // 原则1 正例：板块级路径 + 判据引用，无行号/函数名
    expect(
      lintPlanWording(
        "把 integrations/src/manual.md §2.6 体检表补上 W7 判据（以 sp-check-design.mjs 现行实现为准）",
        [],
      ),
    ).toEqual([]);
    // 原则2 正例：可观察的行为差异（命令 + 输出 + 退出码）
    expect(
      lintPlanWording(
        "执行 node scripts/sync-integrations.mjs --check，输出含「全部一致」且退出码为 0",
        [],
      ),
    ).toEqual([]);
    // 原则3 正例：可独立核对（sha256 相同）
    expect(
      lintPlanWording(
        "",
        ["integrations/plugin/manual.md 与 integrations/shared/manual.md 内容一致（sha256 相同）"],
      ),
    ).toEqual([]);
    // 原则4 正例：显式范围（只动什么、不碰什么——路径密集但全是板块级落点）
    expect(
      lintPlanWording(
        "只改 integrations/src/manual.md 正本并运行 sync；不手改 integrations/shared/** 与 integrations/plugin/**",
        [],
      ),
    ).toEqual([]);
  });

  it("板块级文件落点声明不报 a：『只动 …』『文件边界：…』式多路径声明", () => {
    expect(
      lintPlanWording(
        "只动 src/core/style-lint.ts、src/core/index.ts、src/cli/validate.ts；文件边界：不碰 integrations/shared/manual.md 与 .pi/skills/**",
        ["npm run build 与 npm run typecheck 通过（退出码 0）"],
      ),
    ).toEqual([]);
  });

  it("冒号数字的常见正当用法不报 b：端口/键值对/时间/URL", () => {
    expect(
      lintPlanWording(
        "服务跑在 localhost:8934，读取配置 attempts: 3、level: 1，时间窗 08:30–18:30；参考 https://example.com/docs/guide.md",
        [],
      ),
    ).toEqual([]);
  });

  it("公开 API/命令引用不构成函数名指针（无路径共现时更不报 a）", () => {
    expect(
      lintPlanWording(
        "调用 graph_get_next_actions 拿调度桶，再执行 node scripts/sync-integrations.mjs --check",
        [],
      ),
    ).toEqual([]);
  });

  it("空入参与缺字段的节点零 issue", () => {
    expect(lintPlanWording("", [])).toEqual([]);
    expect(lintNodeWording({ id: "x" })).toEqual([]);
  });
});

describe("F16 三类坏文案各报对应规则码", () => {
  it("a 脆弱定位：路径+函数名指认内部实现位置", () => {
    const issues = lintPlanWording("修改 src/core/graph.ts 的 topologicalSort 函数", []);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("a");
    expect(issues[0].field).toBe("plan.description");
    expect(issues[0].level).toBe("warning");
    expect(issues[0].message).toContain("脆弱定位");
    expect(issues[0].message).toContain("topologicalSort");
  });

  it("a+b 同时报：路径+行号（manual §2.8 原则1 反例原文）", () => {
    const issues = lintPlanWording("修改 integrations/shared/manual.md 第 152–169 行的表格", []);
    const codes = issues.map((i) => i.code).sort();
    expect(codes).toEqual(["a", "b"]);
    expect(issues.find((i) => i.code === "b")!.message).toContain("第 152–169 行");
  });

  it("a+b 英文形态：file.ext:N（扩展名锚定的冒号行号）", () => {
    const issues = lintPlanWording("", ["在 src/core/domain.ts:198 补一条规则"]);
    const codes = issues.map((i) => i.code).sort();
    expect(codes).toEqual(["a", "b"]);
    expect(issues.every((i) => i.field === "DoD[0]")).toBe(true);
  });

  it("b 单独报：行号无路径共现（不牵连 a）", () => {
    const zh = lintPlanWording("把表格补上（见第 152 行）", []);
    expect(zh.map((i) => i.code)).toEqual(["b"]);

    const en = lintPlanWording("update the table at line 42", []);
    expect(en.map((i) => i.code)).toEqual(["b"]);
    expect(en[0].message).toContain("line 42");
  });

  it("c 不可验证措辞：词表逐词报（含 manual §2.8 反例词）", () => {
    const issues = lintPlanWording("正确地同步插件包拷贝", []);
    expect(issues.map((i) => i.code)).toEqual(["c"]);
    expect(issues[0].message).toContain("正确地");

    const dodIssues = lintPlanWording("", [
      "把结果与上游节点产出合理地对齐",
      "顺带完善相关文档",
      "确保质量后发布",
    ]);
    expect(dodIssues.map((i) => i.code)).toEqual(["c", "c", "c"]);
    expect(dodIssues.map((i) => i.field)).toEqual(["DoD[0]", "DoD[1]", "DoD[2]"]);
    expect(dodIssues[0].message).toContain("合理地");
    expect(dodIssues[1].message).toContain("完善");
    expect(dodIssues[2].message).toContain("确保质量");
  });

  it("c 英文词表：properly/correctly 词边界命中", () => {
    const issues = lintPlanWording("Properly sync the plugin copies and validate correctly", []);
    expect(issues.map((i) => i.code)).toEqual(["c", "c"]);
    expect(issues[0].message).toContain("properly");
  });

  it("c 裸词干命中（g080 二轮回归：计划种子文案）", () => {
    // 种子原文：「合理」不带「地」、「确保质量」不连续——旧词表三通道一致漏报
    const issues = lintPlanWording("确保合理优化整体质量", []);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("c");
    expect(issues[0].message).toContain("合理");
  });

  it("c 裸词干守卫：前邻「不/非」、后邻「性/化/界/地」不命中", () => {
    // 不合理 = 描述不是承诺；合理性/合理化 = 名词讨论；合理地 = 带地形态单报（见下）
    expect(lintPlanWording("不合理的需求拆分", [])).toEqual([]);
    expect(lintPlanWording("讨论节点的合理性", [])).toEqual([]);
    expect(lintPlanWording("合理化拆分", [])).toEqual([]);
    // 带地形态不因裸词干重复报：仍只一条 c，报整词「合理地」
    const di = lintPlanWording("", ["把结果与上游节点产出合理地对齐"]);
    expect(di.map((i) => i.code)).toEqual(["c"]);
    expect(di[0].message).toContain("合理地");
  });

  it("去重：同字段同类命中收敛（c 同词一次、a 每字段一条）", () => {
    expect(lintPlanWording("正确地、正确地再查一遍", [])).toHaveLength(1);
    expect(
      lintPlanWording("改 src/a.ts 的 foo 函数。再改 src/b.ts 的 bar 函数", []),
    ).toHaveLength(1);
  });
});

describe("F16 lintNodeWording：节点级包装", () => {
  it("消息带节点 id 与字段，恒为 warning", () => {
    const issues = lintNodeWording({
      id: "l2_demo",
      plan: { description: "修改 src/core/graph.ts 的 topologicalSort 函数" },
      expected_outcome: { definition_of_done: ["正确地同步"] },
    });
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.level === "warning")).toBe(true);
    expect(issues[0].message).toContain("节点 l2_demo");
    expect(issues[0].field).toBe("plan.description");
    expect(issues[1].field).toBe("DoD[0]");
  });
});

// ── lint 警告不改变 validate 退出码（CLI 实测，走构建产物与 tests/cli 同款 spawn 模式）──
const CLI_PATH = path.resolve("dist/cli/index.js");
describe("F16 CLI validate 接线：lint 走 warning、退出码不动", () => {
  let tmpDir: string;

  beforeEach(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error("F16 CLI validate release gate requires dist/cli/index.js; run npm run build first");
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-stylelint-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runArr(args: string[]) {
    return spawnSync(process.execPath, [CLI_PATH, ...args], {
      cwd: tmpDir,
      encoding: "utf-8",
    });
  }

  it("含三类坏文案的节点 → validate 输出 lint warning 且退出码 0", () => {
    expect(runArr(["init", "lintdemo"]).status).toBe(0);
    const created = runArr([
      "create-node",
      "--id", "t1",
      "--label", "坏文案样本",
      "--plan-desc", "修改 src/core/graph.ts 的 topologicalSort 函数",
      "--dod", "正确地同步插件包拷贝",
      "--dod", "把 manual.md:152 的表格补上",
    ]);
    expect(created.status).toBe(0);

    const res = runArr(["validate", "--json"]);
    expect(res.status).toBe(0); // lint 全是 warning，退出码不受影响
    const out = JSON.parse(res.stdout) as { ok: boolean; errors: string[]; warnings: string[] };
    expect(out.ok).toBe(true);
    expect(out.errors).toHaveLength(0);
    const lintWarnings = out.warnings.filter((w) => w.includes("节点 t1") && w.includes("规则 "));
    expect(lintWarnings.some((w) => w.includes("规则 a·脆弱定位"))).toBe(true);
    expect(lintWarnings.some((w) => w.includes("规则 b·行号式"))).toBe(true);
    expect(lintWarnings.some((w) => w.includes("规则 c·不可验证措辞"))).toBe(true);
  });
});
