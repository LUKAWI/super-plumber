import type { GraphIndex, WsMessage } from "./types";

export type GraphListener = (graph: GraphIndex) => void;

export function connectGraph(host: string, onGraph: GraphListener): () => void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${host}`);

  ws.onmessage = (event) => {
    const msg: WsMessage = JSON.parse(event.data);
    if (msg.type === "graph:full" || msg.type === "graph:update") {
      onGraph(msg.data as GraphIndex);
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
