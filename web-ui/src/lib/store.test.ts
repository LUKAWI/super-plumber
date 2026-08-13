import { describe, it, expect, beforeEach } from "vitest";
import { graphState } from "./store.svelte";
import type { GraphIndex, NodeSchema } from "./types";

function makeGraph(): GraphIndex {
  return {
    nodes: [
      {
        id: "a",
        type: "task",
        label: "A",
        level: 1,
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        created_at: "",
        updated_at: "",
      },
      {
        id: "b",
        type: "task",
        label: "B",
        level: 2,
        status: "ready",
        attempts: 0,
        max_attempts: 3,
        created_at: "",
        updated_at: "",
      },
    ],
    edges: [],
  };
}

describe("graphState store", () => {
  beforeEach(() => {
    graphState.setGraph(null);
    graphState.selectNode(null);
    graphState.selectEdge(null);
    graphState.setLevelFilter(null);
    graphState.setQuery("");
    graphState.clearDiff();
  });

  it("patchNode 就地替换节点对象（保持数组引用）", () => {
    graphState.setGraph(makeGraph());
    const nodes = graphState.graph!.nodes;
    const before = nodes[0];
    const updated = { ...before, status: "running" as const };
    graphState.patchNode("a", updated);
    expect(graphState.graph!.nodes).toBe(nodes); // 数组引用不变
    expect(graphState.graph!.nodes[0].status).toBe("running");
    expect(graphState.lastPatched?.id).toBe("a");
  });

  it("patchNode 删除节点（node=null）", () => {
    graphState.setGraph(makeGraph());
    graphState.patchNode("a", null);
    expect(graphState.graph!.nodes.map((n) => n.id)).toEqual(["b"]);
  });

  it("patchNode 选中节点同步更新", () => {
    graphState.setGraph(makeGraph());
    const a = graphState.graph!.nodes[0];
    graphState.selectNode(a);
    graphState.patchNode("a", { ...a, status: "running" as const });
    expect(graphState.selectedNode?.status).toBe("running");
  });

  it("selectNode 与 selectEdge 互斥", () => {
    graphState.setGraph(makeGraph());
    graphState.selectNode(graphState.graph!.nodes[0]);
    graphState.selectEdge({ id: "e1", source: "a", target: "b", type: "depends_on" });
    expect(graphState.selectedNode).toBeNull();
    expect(graphState.selectedEdge?.id).toBe("e1");
    graphState.selectNode(graphState.graph!.nodes[1]);
    expect(graphState.selectedEdge).toBeNull();
  });

  it("toggleLevel 循环：null → [1] → [1,2] → [2] → null", () => {
    graphState.toggleLevel(1);
    expect(graphState.levelFilter).toEqual([1]);
    graphState.toggleLevel(2);
    expect(graphState.levelFilter).toEqual([1, 2]);
    graphState.toggleLevel(1);
    expect(graphState.levelFilter).toEqual([2]);
    graphState.toggleLevel(2);
    expect(graphState.levelFilter).toBeNull();
  });
});
