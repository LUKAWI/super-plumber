import type { GraphIndex, NodeSchema, WsMessage } from "./types";

export type GraphListener = (graph: GraphIndex) => void;
export type NodeUpdatedListener = (nodeId: string, node: NodeSchema | null) => void;

export function connectGraph(
  host: string,
  onGraph: GraphListener,
  onNodeUpdated: NodeUpdatedListener
): () => void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${host}`);

  ws.onmessage = (event) => {
    const msg: WsMessage = JSON.parse(event.data);
    switch (msg.type) {
      case "graph:full":
      case "graph:update":
        onGraph(msg.data as GraphIndex);
        break;
      case "node:updated":
        if (msg.nodeId !== undefined) {
          onNodeUpdated(msg.nodeId, msg.node ?? null);
        }
        break;
    }
  };

  ws.onerror = () => {
    console.warn("WebSocket 连接失败，尝试 HTTP 回退...");
    fetch("/api/graph")
      .then((r) => r.json())
      .then(onGraph);
  };

  return () => ws.close();
}
