import type { GraphIndex, GraphsListData, NodeSchema, WsMessage } from "./types";

/** 图数据消息（graph:full / graph:update）：graph = 所属图名 */
export type GraphListener = (graph: string, g: GraphIndex) => void;
/** 增量节点消息（node:updated）：graph = 所属图名 */
export type NodeUpdatedListener = (graph: string, nodeId: string, node: NodeSchema | null) => void;
/** 工作区图列表消息（graphs:list） */
export type GraphsListListener = (data: GraphsListData) => void;
export type ConnectionStatus = "connecting" | "connected" | "offline";

export interface GraphConnectionOptions {
	/** ws://host:port/path */
	url: string;
	onGraph: GraphListener;
	onNodeUpdated: NodeUpdatedListener;
	/** 工作区图列表（选图器数据源；active = 初始选中） */
	onGraphsList?: GraphsListListener;
	onStatusChange?: (status: ConnectionStatus) => void;
	/** 重连退避（毫秒），最后一档持续使用 */
	reconnectDelays?: number[];
	/** 测试注入 */
	WebSocketImpl?: typeof WebSocket;
	fetchImpl?: typeof fetch;
}

/**
 * 带指数退避重连的图连接（P4-1：历史实现断线后一次 HTTP 回退即永久假死）。
 * v0.5.2 多图：按消息的 graph 字段路由到对应回调——后台图持续热更新，
 * 前端 store 按图名分桶，切换查看不丢任何图的新鲜度。
 * 重连成功后由服务端 graphs:list + graph:full（active 图）全量同步；
 * 离线期间用 HTTP 兜底刷新一次（active 图）。返回断开函数（幂等）。
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
			.then((g: GraphIndex) => {
				// 服务端序列化带 name 字段；缺失时（旧服务端）退回 default
				opts.onGraph(typeof g.name === "string" ? g.name : "default", g);
			})
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
			// 服务端在连接建立时推送 graphs:list + graph:full（active 图）
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
					opts.onGraph(msg.graph, msg.data as GraphIndex);
					break;
				case "node:updated":
					opts.onNodeUpdated(msg.graph, msg.nodeId, msg.node ?? null);
					break;
				case "graphs:list":
					opts.onGraphsList?.(msg.data as GraphsListData);
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
