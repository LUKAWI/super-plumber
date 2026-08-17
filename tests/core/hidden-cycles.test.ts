// tests/core/hidden-cycles.test.ts — FIX-B1：隐藏环路检测
// 评审溯源：B 级·运行时边装饰性（fan 门控边闭合的互等环对拓扑排序不可见，
// 但 ready 门禁已实现——环 = 永远无法 ready 的真实死锁）
import { describe, it, expect } from "vitest";
import { detectCycles, detectHiddenCycles } from "../../src/core/graph.js";
import { EdgeType, type EdgeSchema } from "../../src/core/types.js";

function e(id: string, source: string, target: string, type: EdgeType): EdgeSchema {
  return { id, source, target, type };
}

describe("detectHiddenCycles", () => {
  it("纯拓扑环仍是普通环（detectCycles 报，hidden 不重复报）", () => {
    const edges = [
      e("e1", "a", "b", EdgeType.DependsOn),
      e("e2", "b", "a", EdgeType.DependsOn),
    ];
    expect(detectCycles(["a", "b"], edges)).toHaveLength(1);
    expect(detectHiddenCycles(["a", "b"], edges)).toHaveLength(0);
  });

  it("fallback 逆向引用不构成隐藏环（设计意图：失败回退重试）", () => {
    const edges = [
      e("e1", "a", "b", EdgeType.DependsOn),
      e("e2", "b", "a", EdgeType.Fallback),
    ];
    expect(detectCycles(["a", "b"], edges)).toHaveLength(0);
    expect(detectHiddenCycles(["a", "b"], edges)).toHaveLength(0);
  });

  it("iterates 闭合不构成隐藏环（设计意图：声明式迭代环，validate 逐边警告）", () => {
    const edges = [
      e("e1", "a", "b", EdgeType.DependsOn),
      e("e2", "b", "a", EdgeType.Iterates),
    ];
    expect(detectHiddenCycles(["a", "b"], edges)).toHaveLength(0);
  });

  it("fan_out/fan_in 互等环 → 隐藏环被检出（门禁语义下的真实死锁）", () => {
    // a -fan_out-> b（a passed 后 b 可并行）；b -fan_in-> a（a 的门禁要求 b passed）
    // → a 等 b、b 等 a，谁都无法 ready
    const edges = [
      e("e1", "a", "b", EdgeType.FanOut),
      e("e2", "b", "a", EdgeType.FanIn),
    ];
    expect(detectCycles(["a", "b"], edges)).toHaveLength(0);
    const hidden = detectHiddenCycles(["a", "b"], edges);
    expect(hidden).toHaveLength(1);
    expect([...new Set(hidden[0])].sort()).toEqual(["a", "b"]);
  });

  it("拓扑链 + fan 回边闭合 → 隐藏环被检出", () => {
    // a → b → c（depends_on），c -fan_in-> a：a 的门禁要求 c passed，但 c 在 a 之后
    const edges = [
      e("e1", "a", "b", EdgeType.DependsOn),
      e("e2", "b", "c", EdgeType.DependsOn),
      e("e3", "c", "a", EdgeType.FanIn),
    ];
    expect(detectCycles(["a", "b", "c"], edges)).toHaveLength(0);
    const hidden = detectHiddenCycles(["a", "b", "c"], edges);
    expect(hidden).toHaveLength(1);
    expect([...new Set(hidden[0])].sort()).toEqual(["a", "b", "c"]);
  });

  it("shares_context 不参与隐藏环检测（软信息边）", () => {
    const edges = [
      e("e1", "a", "b", EdgeType.DependsOn),
      e("e2", "b", "a", EdgeType.SharesContext),
    ];
    expect(detectHiddenCycles(["a", "b"], edges)).toHaveLength(0);
  });

  it("无环图返回空", () => {
    const edges = [
      e("e1", "a", "b", EdgeType.DependsOn),
      e("e2", "a", "c", EdgeType.FanOut),
    ];
    expect(detectHiddenCycles(["a", "b", "c"], edges)).toHaveLength(0);
  });
});
