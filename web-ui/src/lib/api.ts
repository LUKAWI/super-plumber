import type { GraphIndex, NodeSchema, WsMessage } from "./types";

export type GraphListener = (graph: GraphIndex) => void;
export type NodeUpdatedListener = (nodeId: string, node: NodeSchema | null) => void;
export type ConnectionStatus = "connecting" | "connected" | "offline";

export interface GraphConnectionOptions {
	/** ws://host:port/path */
	url: string;
	onGraph: GraphListener;
	onNodeUpdated: NodeUpdatedListener;
	onStatusChange?: (status: ConnectionStatus) => void;
	/** 重连退避（毫秒），最后一档持续使用 */
	reconnectDelays?: number[];
	/** 测试注入 */
	WebSocketImpl?: typeof WebSocket;
	fetchImpl?: typeof fetch;
}

/**
 * 带指数退避重连的图连接（P4-1：历史实现断线后一次 HTTP 回退即永久假死）。
 * 重连成功后由服务端 graph:full 全量同步；离线期间用 HTTP 兜底刷新一次。
 * 返回断开函数（幂等）。
 */
export function createGraphConnection(opts: GraphConnectionOptions): () => void {
	const delays = opts.reconnectDelays ?? [1000, 2000, 5000, 10000];
	const WS = opts.WebSocketImpl ?? WebSocket;
	const fetchImpl =
		opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

	let ws: WebSocket | null = null;
	let closed = false;
	let attempt = 0;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;

	function notify(status: ConnectionStatus) {
		opts.onStatusChange?.(status);
	}

	function httpFallback() {
		fetchImpl("/api/graph")
			.then((r) => r.json())
			.then((g) => opts.onGraph(g as GraphIndex))
			.catch(() => {
				/* 服务端不可达：等待下一次重连 */
			});
	}

	function scheduleReconnect() {
		if (closed) return;
		const delay = delays[Math.min(attempt, delays.length - 1)];
		attempt += 1;
		notify("offline");
		httpFallback(); // 兜底刷新，避免 UI 停在旧数据
		retryTimer = setTimeout(connect, delay);
	}

	function connect() {
		if (closed) return;
		notify("connecting");
		ws = new WS(opts.url);

		ws.onopen = () => {
			attempt = 0;
			notify("connected");
			// 服务端在连接建立时推送 graph:full
		};

		ws.onmessage = (event) => {
			let msg: WsMessage;
			try {
				msg = JSON.parse(String(event.data)) as WsMessage;
			} catch {
				return;
			}
			switch (msg.type) {
				case "graph:full":
				case "graph:update":
					opts.onGraph(msg.data as GraphIndex);
					break;
				case "node:updated":
					if (msg.nodeId !== undefined) {
						opts.onNodeUpdated(msg.nodeId, msg.node ?? null);
					}
					break;
			}
		};

		ws.onerror = () => {
			/* onclose 会随后触发并进入重连 */
		};

		ws.onclose = () => {
			if (closed) return;
			ws = null;
			scheduleReconnect();
		};
	}

	connect();

	return () => {
		closed = true;
		if (retryTimer) clearTimeout(retryTimer);
		try {
			ws?.close();
		} catch {
			/* 已关闭 */
		}
		ws = null;
	};
}

/** 兼容旧签名（App 使用） */
export function connectGraph(
	host: string,
	onGraph: GraphListener,
	onNodeUpdated: NodeUpdatedListener,
): () => void {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	return createGraphConnection({
		url: `${protocol}//${host}`,
		onGraph,
		onNodeUpdated,
	});
}
