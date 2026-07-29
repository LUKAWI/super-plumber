// tests/core/graph.test.ts
import { describe, it, expect } from "vitest";
import { topologicalSort, detectCycles } from "../../src/core/graph.js";
import { EdgeType } from "../../src/core/types.js";

describe("Graph operations", () => {
  describe("topologicalSort", () => {
    it("空图返回空", () => {
      expect(topologicalSort([], [])).toEqual([]);
    });

    it("单节点无依赖", () => {
      expect(topologicalSort(["a"], [])).toEqual(["a"]);
    });

    it("线性依赖 a → b → c", () => {
      const result = topologicalSort(["a", "b", "c"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
        { source: "b", target: "c", type: EdgeType.DependsOn },
      ]);
      expect(result.indexOf("a")).toBeLessThan(result.indexOf("b"));
      expect(result.indexOf("b")).toBeLessThan(result.indexOf("c"));
    });

    it("并行 fan-out", () => {
      const result = topologicalSort(["a", "b", "c"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
        { source: "a", target: "c", type: EdgeType.DependsOn },
      ]);
      expect(result[0]).toBe("a");
      expect(result).toContain("b");
      expect(result).toContain("c");
    });

    it("忽略 fallback 边", () => {
      const result = topologicalSort(["a", "b", "c"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
        { source: "c", target: "a", type: EdgeType.Fallback },
      ]);
      expect(result.indexOf("a")).toBeLessThan(result.indexOf("b"));
      expect(result).toContain("c");
    });

    it("有环时抛出错误", () => {
      expect(() => {
        topologicalSort(["a", "b", "c"], [
          { source: "a", target: "b", type: EdgeType.DependsOn },
          { source: "b", target: "c", type: EdgeType.DependsOn },
          { source: "c", target: "a", type: EdgeType.DependsOn },
        ]);
      }).toThrow("Cycle detected");
    });
  });

  describe("detectCycles", () => {
    it("无环返回空数组", () => {
      const cycles = detectCycles(["a", "b"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
      ]);
      expect(cycles).toHaveLength(0);
    });

    it("检测简单环 a → b → a", () => {
      const cycles = detectCycles(["a", "b"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
        { source: "b", target: "a", type: EdgeType.DependsOn },
      ]);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
    });

    it("fallback 边不产生环", () => {
      const cycles = detectCycles(["a", "b"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
        { source: "b", target: "a", type: EdgeType.Fallback },
      ]);
      expect(cycles).toHaveLength(0);
    });
  });
});
