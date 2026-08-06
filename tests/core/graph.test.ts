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
      const result = topologicalSort(
        ["a", "b", "c"],
        [
          { source: "a", target: "b", type: EdgeType.DependsOn },
          { source: "b", target: "c", type: EdgeType.DependsOn },
        ],
      );
      expect(result.indexOf("a")).toBeLessThan(result.indexOf("b"));
      expect(result.indexOf("b")).toBeLessThan(result.indexOf("c"));
    });

    it("并行 fan-out", () => {
      const result = topologicalSort(
        ["a", "b", "c"],
        [
          { source: "a", target: "b", type: EdgeType.DependsOn },
          { source: "a", target: "c", type: EdgeType.DependsOn },
        ],
      );
      expect(result[0]).toBe("a");
      expect(result).toContain("b");
      expect(result).toContain("c");
    });

    it("忽略 fallback 边", () => {
      const result = topologicalSort(
        ["a", "b", "c"],
        [
          { source: "a", target: "b", type: EdgeType.DependsOn },
          { source: "c", target: "a", type: EdgeType.Fallback },
        ],
      );
      expect(result.indexOf("a")).toBeLessThan(result.indexOf("b"));
      expect(result).toContain("c");
    });

    it("有环时抛出错误", () => {
      expect(() => {
        topologicalSort(
          ["a", "b", "c"],
          [
            { source: "a", target: "b", type: EdgeType.DependsOn },
            { source: "b", target: "c", type: EdgeType.DependsOn },
            { source: "c", target: "a", type: EdgeType.DependsOn },
          ],
        );
      }).toThrow("Cycle detected");
    });

    it("忽略 source 不存在的悬挂边（不误报环）", () => {
      // ghost 不在 nodeIds 中：其出边不应使 node_b 的入度无法归零
      const result = topologicalSort(
        ["a", "b"],
        [
          { source: "ghost", target: "b", type: EdgeType.DependsOn },
          { source: "a", target: "b", type: EdgeType.DependsOn },
        ],
      );
      expect(result).toHaveLength(2);
      expect(result.indexOf("a")).toBeLessThan(result.indexOf("b"));
    });

    it("BUG-02 忽略 target 不存在的悬挂边（不误报环）", () => {
      // 回归：target 指向图中不存在的节点时，Kahn 算法曾把幽灵节点入队，
      // result 长度超过 nodeIds 导致误报 "Cycle detected among nodes: []"
      const result = topologicalSort(
        ["a", "b"],
        [
          { source: "a", target: "ghost", type: EdgeType.DependsOn },
          { source: "b", target: "a", type: EdgeType.DependsOn },
        ],
      );
      expect(result).toHaveLength(2);
      expect(result.indexOf("b")).toBeLessThan(result.indexOf("a"));
    });
  });

  describe("detectCycles", () => {
    it("无环返回空数组", () => {
      const cycles = detectCycles(
        ["a", "b"],
        [{ source: "a", target: "b", type: EdgeType.DependsOn }],
      );
      expect(cycles).toHaveLength(0);
    });

    it("检测简单环 a → b → a", () => {
      const cycles = detectCycles(
        ["a", "b"],
        [
          { source: "a", target: "b", type: EdgeType.DependsOn },
          { source: "b", target: "a", type: EdgeType.DependsOn },
        ],
      );
      expect(cycles.length).toBeGreaterThanOrEqual(1);
    });

    it("fallback 边不产生环", () => {
      const cycles = detectCycles(
        ["a", "b"],
        [
          { source: "a", target: "b", type: EdgeType.DependsOn },
          { source: "b", target: "a", type: EdgeType.Fallback },
        ],
      );
      expect(cycles).toHaveLength(0);
    });

    it("深链（6000 节点）不栈溢出", () => {
      // 回归：递归 DFS 在 5000 深度即 RangeError，必须迭代实现
      const ids = Array.from({ length: 6000 }, (_, i) => `n${i}`);
      const edges = ids.slice(0, -1).map((id, i) => ({
        source: id,
        target: `n${i + 1}`,
        type: EdgeType.DependsOn as const,
      }));
      expect(() => detectCycles(ids, edges)).not.toThrow();
      expect(detectCycles(ids, edges)).toHaveLength(0);
    });
  });
});
