import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGraphConnection } from "./api";

/** 可控的假 WebSocket：手动触发 open/message/close */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  serverOpen() { this.onopen?.(); }
  serverMessage(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  serverClose() { if (!this.closed) this.onclose?.(); }
}

describe("createGraphConnection (reconnect)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeFetch() {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ nodes: [], edges: [] }),
    }) as unknown as typeof fetch;
  }

  it("断开后按退避重连，重连后收到全量消息", async () => {
    const onGraph = vi.fn();
    const fetchImpl = makeFetch();
    const disconnect = createGraphConnection({
      url: "ws://test/graph",
      onGraph,
      onNodeUpdated: vi.fn(),
      reconnectDelays: [10, 20],
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl,
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    const first = FakeWebSocket.instances[0];
    first.serverOpen();
    first.serverMessage({ type: "graph:full", graph: "default", data: { nodes: [], edges: [] } });
    expect(onGraph).toHaveBeenCalledTimes(1);

    // 服务端断开 → 立即 HTTP 兜底（onGraph #2）+ 10ms 后重连
    first.serverClose();
    expect(fetchImpl).toHaveBeenCalledWith("/api/graph");
    await vi.advanceTimersByTimeAsync(0);
    expect(onGraph).toHaveBeenCalledTimes(2); // WS 全量 + HTTP 兜底各一次

    await vi.advanceTimersByTimeAsync(10);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1];
    second.serverOpen();
    second.serverMessage({
      type: "graph:full",
      graph: "default",
      data: { nodes: [], edges: [], adjacency: {} },
    });
    expect(onGraph).toHaveBeenCalledTimes(3); // 重连后的全量

    // 手动断开后不再重连
    disconnect();
    second.serverClose();
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("HTTP fallback 校验状态与 payload，错误不伪造图数据", async () => {
    const onGraph = vi.fn();
    const onError = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ nodes: [], edges: [] }),
    }) as unknown as typeof fetch;
    const disconnect = createGraphConnection({
      url: "ws://test/graph",
      onGraph,
      onNodeUpdated: vi.fn(),
      onError,
      reconnectDelays: [10],
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl,
    });

    FakeWebSocket.instances[0].serverClose();
    await vi.advanceTimersByTimeAsync(0);
    expect(onGraph).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({ code: "HTTP_ERROR", graph: "default", retryable: true });
    disconnect();
  });

  it("HTTP 2xx 但坏 payload 时进入降级错误契约", async () => {
    const onGraph = vi.fn();
    const onError = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ error: "half-written" }),
    }) as unknown as typeof fetch;
    const disconnect = createGraphConnection({
      url: "ws://test/graph",
      onGraph,
      onNodeUpdated: vi.fn(),
      onError,
      reconnectDelays: [10],
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl,
    });

    FakeWebSocket.instances[0].serverClose();
    await vi.advanceTimersByTimeAsync(0);
    expect(onGraph).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({ code: "INVALID_PAYLOAD", graph: "default", retryable: true });
    disconnect();
  });

  it("重连后的 WS 全量使旧 HTTP fallback 失效", async () => {
    const onGraph = vi.fn();
    let resolveFetch!: (response: unknown) => void;
    const fetchImpl = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })) as unknown as typeof fetch;
    const disconnect = createGraphConnection({
      url: "ws://test/graph",
      onGraph,
      onNodeUpdated: vi.fn(),
      reconnectDelays: [10],
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl,
    });

    const first = FakeWebSocket.instances[0];
    first.serverClose();
    await vi.advanceTimersByTimeAsync(10);
    const second = FakeWebSocket.instances[1];
    second.serverOpen();
    second.serverMessage({ type: "graph:full", graph: "default", data: { nodes: [], edges: [] } });
    resolveFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ nodes: [], edges: [] }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onGraph).toHaveBeenCalledTimes(1);
    disconnect();
  });

  it("node:updated 增量消息按图名路由到 onNodeUpdated", () => {
    const onNodeUpdated = vi.fn();
    createGraphConnection({
      url: "ws://test/graph",
      onGraph: vi.fn(),
      onNodeUpdated,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: makeFetch(),
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverMessage({
      type: "node:updated",
      graph: "refactor-auth",
      nodeId: "a",
      node: {
        id: "a",
        type: "task",
        label: "A",
        level: 1,
        status: "running",
        attempts: 1,
        max_attempts: 3,
        created_at: "",
        updated_at: "",
      },
    });
    expect(onNodeUpdated).toHaveBeenCalledWith(
      "refactor-auth",
      "a",
      expect.objectContaining({ id: "a" }),
    );
  });

  it("坏消息 JSON 被忽略不崩溃", () => {
    const onGraph = vi.fn();
    createGraphConnection({
      url: "ws://test/graph",
      onGraph,
      onNodeUpdated: vi.fn(),
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: makeFetch(),
    });
    const ws = FakeWebSocket.instances[0];
    expect(() => ws.serverMessage({ type: "graph:full", data: null })).not.toThrow();
  });
});

// ── v0.5.2 多图：消息按 graph 字段路由 ────────────────────────────────────────
describe("createGraphConnection (multi-graph routing)", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  function setup() {
    const onGraph = vi.fn();
    const onNodeUpdated = vi.fn();
    const onGraphsList = vi.fn();
    createGraphConnection({
      url: "ws://test/graph",
      onGraph,
      onNodeUpdated,
      onGraphsList,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ nodes: [], edges: [] }),
      }) as unknown as typeof fetch,
    });
    return { onGraph, onNodeUpdated, onGraphsList, ws: FakeWebSocket.instances[0] };
  }

  it("graph:full / graph:update 携带图名，投递到 onGraph(name, data)", () => {
    const { ws, onGraph } = setup();
    ws.serverMessage({ type: "graph:full", graph: "alpha", data: { nodes: [], edges: [] } });
    ws.serverMessage({ type: "graph:update", graph: "beta", data: { nodes: [], edges: [] } });
    expect(onGraph).toHaveBeenCalledTimes(2);
    expect(onGraph).toHaveBeenNthCalledWith(1, "alpha", expect.objectContaining({ edges: [] }));
    expect(onGraph).toHaveBeenNthCalledWith(2, "beta", expect.anything());
  });

  it("不同图名的 node:updated 分别投递（后台图热更新不打扰当前图）", () => {
    const { ws, onNodeUpdated } = setup();
    ws.serverMessage({
      type: "node:updated",
      graph: "alpha",
      nodeId: "n1",
      node: {
        id: "n1",
        type: "task",
        label: "N1",
        level: 1,
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        created_at: "",
        updated_at: "",
      },
    });
    ws.serverMessage({ type: "node:updated", graph: "beta", nodeId: "n2", node: null, removed: true });
    expect(onNodeUpdated).toHaveBeenNthCalledWith(1, "alpha", "n1", expect.objectContaining({ id: "n1" }));
    expect(onNodeUpdated).toHaveBeenNthCalledWith(2, "beta", "n2", null);
  });

  it("graphs:list 工作区消息投递到 onGraphsList（active + 图元信息）", () => {
    const { ws, onGraphsList, onGraph } = setup();
    ws.serverMessage({
      type: "graphs:list",
      graph: "*",
      data: {
        active: "alpha",
        graphs: [
          { name: "alpha", nodeCount: 3, statuses: { pending: 3 }, lastActivity: null },
          { name: "beta", nodeCount: 5, statuses: { passed: 5 }, lastActivity: null },
        ],
      },
    });
    expect(onGraphsList).toHaveBeenCalledTimes(1);
    const data = onGraphsList.mock.calls[0][0];
    expect(data.active).toBe("alpha");
    expect(data.graphs.map((g: { name: string }) => g.name)).toEqual(["alpha", "beta"]);
    expect(onGraph).not.toHaveBeenCalled(); // 列表消息不误投图数据回调
  });

  it("未知消息类型被忽略不崩溃", () => {
    const { ws, onGraph, onNodeUpdated, onGraphsList } = setup();
    expect(() => ws.serverMessage({ type: "future:msg", data: {} })).not.toThrow();
    expect(onGraph).not.toHaveBeenCalled();
    expect(onNodeUpdated).not.toHaveBeenCalled();
    expect(onGraphsList).not.toHaveBeenCalled();
  });

  it("服务端 graph:error 进入可恢复错误回调", () => {
    const onError = vi.fn();
    const disconnect = createGraphConnection({
      url: "ws://test/graph",
      onGraph: vi.fn(),
      onNodeUpdated: vi.fn(),
      onError,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ nodes: [], edges: [] }),
      }) as unknown as typeof fetch,
    });
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    ws.serverMessage({
      type: "graph:error",
      graph: "alpha",
      error: { code: "GRAPH_UNAVAILABLE", retryable: true, message: "暂不可用" },
    });
    expect(onError).toHaveBeenCalledWith({ code: "GRAPH_UNAVAILABLE", graph: "alpha", retryable: true });
    disconnect();
  });
});
