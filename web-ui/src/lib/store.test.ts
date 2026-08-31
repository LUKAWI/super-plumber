import { describe, it, expect, beforeEach, vi } from "vitest";
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
    graphState.setActiveMaps({ workflow: true, domain: false });
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

  it("默认透镜：工作流开、领域关", () => {
    expect(graphState.activeMaps).toEqual({ workflow: true, domain: false });
  });

  it("toggleMap 可开领域透镜成叠加视图，再关回工作流视图", () => {
    graphState.toggleMap("domain");
    expect(graphState.activeMaps).toEqual({ workflow: true, domain: true });
    graphState.toggleMap("domain");
    expect(graphState.activeMaps).toEqual({ workflow: true, domain: false });
  });

  it("toggleMap 允许两透镜全关（空视图，由画布提示）", () => {
    // 默认 { workflow: true, domain: false }：只关工作流即两透镜全关
    graphState.toggleMap("workflow");
    expect(graphState.activeMaps).toEqual({ workflow: false, domain: false });
    // 再关领域仍是全关（幂等路径：先开再关）
    graphState.toggleMap("domain");
    graphState.toggleMap("domain");
    expect(graphState.activeMaps).toEqual({ workflow: false, domain: false });
  });

  it("toggleMap 不 mutate 旧对象（替换引用触发响应）", () => {
    const before = graphState.activeMaps;
    graphState.toggleMap("domain");
    expect(graphState.activeMaps).not.toBe(before);
    expect(before.domain).toBe(false); // 旧对象不被改写
  });
});

describe("前沿（frontier）一键档", () => {
  beforeEach(() => {
    graphState.resetAll();
  });

  it("默认关闭，toggle 往返，set 显式赋值", () => {
    expect(graphState.frontierOnly).toBe(false);
    graphState.toggleFrontier();
    expect(graphState.frontierOnly).toBe(true);
    graphState.toggleFrontier();
    expect(graphState.frontierOnly).toBe(false);
    graphState.setFrontierOnly(true);
    expect(graphState.frontierOnly).toBe(true);
    graphState.setFrontierOnly(false);
    expect(graphState.frontierOnly).toBe(false);
  });

  it("前沿档随图分桶隔离（查看状态不跨图泄漏）", () => {
    graphState.applyGraphsList({
      active: "alpha",
      graphs: [
        { name: "alpha", nodeCount: 1 },
        { name: "beta", nodeCount: 1 },
      ],
    });
    graphState.applyFull("alpha", makeGraphOf("a1"));
    graphState.applyFull("beta", makeGraphOf("b1"));
    graphState.setFrontierOnly(true);
    graphState.selectGraph("beta");
    expect(graphState.frontierOnly).toBe(false);
    graphState.selectGraph("alpha");
    expect(graphState.frontierOnly).toBe(true);
  });
});

// ── v0.5.2 多图分桶 store ─────────────────────────────────────────────────────
function makeGraphOf(id: string, status = "pending"): GraphIndex {
  return {
    nodes: [
      {
        id,
        type: "task",
        label: id.toUpperCase(),
        level: 1,
        status: status as NodeSchema["status"],
        attempts: 0,
        max_attempts: 3,
        created_at: "",
        updated_at: "",
      },
    ],
    edges: [],
  };
}

function graphsListOf(names: string[], active: string | null) {
  return {
    active,
    graphs: names.map((name) => ({ name, nodeCount: 1, statuses: { pending: 1 }, lastActivity: null })),
  };
}

describe("多图分桶 store", () => {
  beforeEach(() => {
    graphState.resetAll();
  });

  it("applyGraphsList 初始选中 = 工作区 active", () => {
    graphState.applyGraphsList(graphsListOf(["alpha", "beta"], "beta"));
    expect(graphState.currentName).toBe("beta");
    expect(graphState.activeName).toBe("beta");
  });

  it("active 无效/缺失时回落第一张图", () => {
    graphState.applyGraphsList(graphsListOf(["alpha", "beta"], null));
    expect(graphState.currentName).toBe("alpha");
  });

  it("后续 active 变化不夺走用户当前查看的图（纯审阅）", () => {
    graphState.applyGraphsList(graphsListOf(["alpha", "beta"], "alpha"));
    graphState.selectGraph("beta");
    graphState.applyFull("beta", makeGraphOf("b1"));
    graphState.applyGraphsList(graphsListOf(["alpha", "beta"], "alpha")); // CLI 切了 active
    expect(graphState.currentName).toBe("beta"); // 视图不被拽走
    expect(graphState.activeName).toBe("alpha"); // 标记照常更新
  });

  it("applyFull 按图分桶隔离，切换保留各自数据", () => {
    graphState.applyGraphsList(graphsListOf(["alpha", "beta"], "alpha"));
    graphState.applyFull("alpha", makeGraphOf("a1"));
    graphState.applyFull("beta", makeGraphOf("b1"));
    expect(graphState.graph?.nodes[0].id).toBe("a1");
    graphState.selectGraph("beta");
    expect(graphState.graph?.nodes[0].id).toBe("b1");
    graphState.selectGraph("alpha");
    expect(graphState.graph?.nodes[0].id).toBe("a1");
  });

  it("查看状态（过滤/搜索/选中）随桶隔离", () => {
    graphState.applyGraphsList(graphsListOf(["alpha", "beta"], "alpha"));
    graphState.applyFull("alpha", makeGraphOf("a1"));
    graphState.applyFull("beta", makeGraphOf("b1"));
    graphState.setLevelFilter([1]);
    graphState.setQuery("a");
    graphState.selectNode(graphState.graph!.nodes[0]);
    graphState.selectGraph("beta");
    expect(graphState.levelFilter).toBeNull();
    expect(graphState.query).toBe("");
    expect(graphState.selectedNode).toBeNull();
    graphState.selectGraph("alpha");
    expect(graphState.levelFilter).toEqual([1]);
    expect(graphState.query).toBe("a");
    expect(graphState.selectedNode?.id).toBe("a1");
  });

  it("后台图持续热更新：applyNodeUpdate 更新后台桶，切回即时新鲜", () => {
    graphState.applyGraphsList(graphsListOf(["alpha", "beta"], "alpha"));
    graphState.applyFull("alpha", makeGraphOf("a1"));
    graphState.applyFull("beta", makeGraphOf("b1"));
    // 当前在 alpha，beta 的增量照收（不打扰当前视图）
    graphState.applyNodeUpdate("beta", "b1", { ...makeGraphOf("b1").nodes[0], status: "running" });
    expect(graphState.graph?.nodes[0].id).toBe("a1"); // alpha 视图不动
    expect(graphState.lastPatched?.id).not.toBe("b1"); // 画布局部刷新不被后台图触发
    graphState.selectGraph("beta");
    expect(graphState.graph?.nodes[0].status).toBe("running"); // 切回已新鲜
  });

  it("未加载的桶丢弃增量消息（等全量，不拼半图）", () => {
    graphState.applyGraphsList(graphsListOf(["alpha", "beta"], "alpha"));
    graphState.applyFull("alpha", makeGraphOf("a1"));
    graphState.applyNodeUpdate("beta", "b1", makeGraphOf("b1").nodes[0]);
    expect(graphState.isLoaded("beta")).toBe(false);
  });

  it("selectGraph 未加载的图触发懒加载 GET /api/graph?graph=<名>", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeGraphOf("b1")),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      graphState.applyGraphsList(graphsListOf(["alpha", "beta"], "alpha"));
      graphState.applyFull("alpha", makeGraphOf("a1"));
      graphState.selectGraph("beta");
      expect(fetchMock).toHaveBeenCalledWith("/api/graph?graph=beta");
      await vi.waitFor(() => expect(graphState.isLoaded("beta")).toBe(true));
      expect(graphState.graph?.nodes[0].id).toBe("b1");
      // 已加载的图再切换不重复拉取（纯本地切桶）
      fetchMock.mockClear();
      graphState.selectGraph("alpha");
      graphState.selectGraph("beta");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("当前图被删（列表刷新）→ 回落 active 图", () => {
    graphState.applyGraphsList(graphsListOf(["alpha", "beta"], "alpha"));
    graphState.applyFull("alpha", makeGraphOf("a1"));
    graphState.applyFull("beta", makeGraphOf("b1"));
    graphState.selectGraph("beta");
    graphState.applyGraphsList(graphsListOf(["alpha"], "alpha")); // beta 被 trash
    expect(graphState.currentName).toBe("alpha");
    expect(graphState.graph?.nodes[0].id).toBe("a1");
  });
});
