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
    first.serverMessage({ type: "graph:full", data: { nodes: [], edges: [] } });
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
      data: { nodes: [], edges: [], adjacency: {} },
    });
    expect(onGraph).toHaveBeenCalledTimes(3); // 重连后的全量

    // 手动断开后不再重连
    disconnect();
    second.serverClose();
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("node:updated 增量消息走 onNodeUpdated", () => {
    const onNodeUpdated = vi.fn();
    createGraphConnection({
      url: "ws://test/graph",
      onGraph: vi.fn(),
      onNodeUpdated,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: makeFetch(),
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverMessage({ type: "node:updated", nodeId: "a", node: { id: "a", status: "running" } });
    expect(onNodeUpdated).toHaveBeenCalledWith("a", expect.objectContaining({ id: "a" }));
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
