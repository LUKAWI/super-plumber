import type { GraphIndex, GraphsListData, NodeSchema } from "./types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Web API 的图数据契约：成功响应必须至少包含完整的 nodes/edges 数组，
 * 且每个实体带有 UI 渲染所需的身份字段。未知附加字段允许透传，方便后端
 * 增量演进；缺字段或错误类型一律按坏 payload 处理，不进入 store。
 */
export function isGraphIndexPayload(value: unknown): value is GraphIndex {
	if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false;
	if (value.name !== undefined && !isNonEmptyString(value.name)) return false;
	if (value.id !== undefined && !isNonEmptyString(value.id)) return false;
	if (value.label !== undefined && typeof value.label !== "string") return false;
	if (value.version !== undefined && typeof value.version !== "string") return false;
	if (value.class !== undefined && typeof value.class !== "string") return false;
	if (value.adjacency !== undefined && !isStringRecord(value.adjacency)) return false;
	if (value.reverseAdj !== undefined && !isStringRecord(value.reverseAdj)) return false;
	if (value.fog !== undefined) {
		const fog = value.fog;
		if (
			!isRecord(fog) ||
			!isNonEmptyString(fog.id) ||
			typeof fog.description !== "string" ||
			typeof fog.graduation !== "string" ||
			(fog.ignited !== undefined && !isStringArray(fog.ignited))
		) return false;
	}
	return value.nodes.every(isNodePayload) && value.edges.every(isEdgePayload);
}

function isStringRecord(value: unknown): value is Record<string, string[]> {
	return isRecord(value) && Object.values(value).every(isStringArray);
}

/** node:updated 与全量图共用同一实体契约，避免坏节点击穿画布。 */
export function isNodePayload(value: unknown): value is NodeSchema {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.type) &&
		typeof value.label === "string" &&
		isFiniteNumber(value.level) &&
		isNonEmptyString(value.status) &&
		isFiniteNumber(value.attempts) &&
		isFiniteNumber(value.max_attempts) &&
		typeof value.created_at === "string" &&
		typeof value.updated_at === "string"
	);
}

function isEdgePayload(value: unknown): boolean {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.source) &&
		isNonEmptyString(value.target) &&
		isNonEmptyString(value.type)
	);
}

function isGraphMetaPayload(value: unknown): boolean {
	if (!isRecord(value) || !isNonEmptyString(value.name)) return false;
	if (!isFiniteNumber(value.nodeCount) || value.nodeCount < 0) return false;
	if (value.statuses !== undefined) {
		if (!isRecord(value.statuses) || !Object.values(value.statuses).every((n) => isFiniteNumber(n) && n >= 0)) {
			return false;
		}
	}
	return value.lastActivity === undefined || value.lastActivity === null || typeof value.lastActivity === "string";
}

export function isGraphsListPayload(value: unknown): value is GraphsListData {
	return (
		isRecord(value) &&
		(value.active === null || isNonEmptyString(value.active)) &&
		Array.isArray(value.graphs) &&
		value.graphs.every(isGraphMetaPayload)
	);
}

export type GraphApiErrorKind = "http" | "payload";

/**
 * REST 图数据边界错误。message 不携带服务端 detail；status 仅保留 HTTP 状态，
 * 让 UI 能区分可重试的 5xx/网络故障与不可重试的 404。
 */
export class GraphApiError extends Error {
	readonly kind: GraphApiErrorKind;
	readonly status: number | undefined;
	readonly retryable: boolean;

	constructor(kind: GraphApiErrorKind, message: string, status?: number) {
		super(message);
		this.name = "GraphApiError";
		this.kind = kind;
		this.status = status;
		this.retryable = kind === "payload" || status === undefined || status >= 500 || status === 408 || status === 429;
	}
}

/**
 * 读取 /api/graph 的统一成功契约：Response.ok 与可用的 status 都必须表示 2xx，
 * 随后 JSON 还必须通过 isGraphIndexPayload。调用方不会收到 {error: ...} 假图。
 */
export async function readGraphResponse(response: Response): Promise<GraphIndex> {
	const status = typeof response.status === "number" && Number.isFinite(response.status)
		? response.status
		: undefined;
	if (response.ok !== true || (status !== undefined && (status < 200 || status >= 300))) {
		throw new GraphApiError("http", "图数据请求失败", status);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new GraphApiError("payload", "服务端返回了不可解析的图数据", status);
	}
	if (!isGraphIndexPayload(payload)) {
		throw new GraphApiError("payload", "服务端返回了无效的图数据", status);
	}
	return payload;
}

/** 图数据消息（graph:full / graph:update）：graph = 所属图名 */
export type GraphListener = (graph: string, g: GraphIndex) => void;
/** 增量节点消息（node:updated）：graph = 所属图名 */
export type NodeUpdatedListener = (graph: string, nodeId: string, node: NodeSchema | null) => void;
/** 工作区图列表消息（graphs:list） */
export type GraphsListListener = (data: GraphsListData) => void;
export type ConnectionStatus = "connecting" | "connected" | "offline";
export type GraphConnectionError = {
	code: "HTTP_ERROR" | "INVALID_PAYLOAD" | "INVALID_MESSAGE" | "GRAPH_UNAVAILABLE";
	graph: string;
	retryable: boolean;
};

export interface GraphConnectionOptions {
	/** ws://host:port/path */
	url: string;
	onGraph: GraphListener;
	onNodeUpdated: NodeUpdatedListener;
	/** 工作区图列表（选图器数据源；active = 初始选中） */
	onGraphsList?: GraphsListListener;
	onStatusChange?: (status: ConnectionStatus) => void;
	onError?: (error: GraphConnectionError) => void;
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
	const delays = (opts.reconnectDelays ?? [1000, 2000, 5000, 10000])
		.filter((delay) => Number.isFinite(delay) && delay >= 0)
		.map((delay) => Math.floor(delay));
	const reconnectDelays = delays.length > 0 ? delays : [1000];
	const WS = opts.WebSocketImpl ?? WebSocket;
	const fetchImpl =
		opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

	let ws: WebSocket | null = null;
	let closed = false;
	let attempt = 0;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	/** 每次 WS 成功同步都使之前的 HTTP 兜底失效，防止旧响应覆盖新状态。 */
	let syncEpoch = 0;

	function notify(status: ConnectionStatus) {
		opts.onStatusChange?.(status);
	}

	function notifyError(error: GraphConnectionError) {
		opts.onError?.(error);
	}

	function httpFallback() {
		const epoch = syncEpoch;
		fetchImpl("/api/graph")
			.then(readGraphResponse)
			.then((g) => {
				if (closed || epoch !== syncEpoch) return;
				// 服务端序列化带 name 字段；缺失时（旧服务端）退回 default
				opts.onGraph(typeof g.name === "string" ? g.name : "default", g);
			})
			.catch((error: unknown) => {
				if (closed || epoch !== syncEpoch) return;
				if (error instanceof GraphApiError && error.kind === "http") {
					notifyError({
						code: "HTTP_ERROR",
						graph: "default",
						retryable: error.retryable,
					});
				} else {
					notifyError({ code: "INVALID_PAYLOAD", graph: "default", retryable: true });
				}
			});
	}

	function scheduleReconnect() {
		if (closed) return;
		const delay = reconnectDelays[Math.min(attempt, reconnectDelays.length - 1)];
		attempt += 1;
		notify("offline");
		syncEpoch += 1;
		httpFallback(); // 兜底刷新，避免 UI 停在旧数据
		retryTimer = setTimeout(() => {
			retryTimer = null;
			connect();
		}, delay);
	}

	function connect() {
		if (closed) return;
		notify("connecting");
		let socket: WebSocket;
		try {
			socket = new WS(opts.url);
		} catch {
			scheduleReconnect();
			return;
		}
		ws = socket;

		socket.onopen = () => {
			if (closed || ws !== socket) return;
			attempt = 0;
			syncEpoch += 1;
			notify("connected");
			// 服务端在连接建立时推送 graphs:list + graph:full（active 图）
		};

		socket.onmessage = (event) => {
			let raw: unknown;
			try {
				raw = JSON.parse(String(event.data)) as unknown;
			} catch {
				return;
			}
			if (!isRecord(raw) || typeof raw.type !== "string") return;
			switch (raw.type) {
				case "graph:full":
				case "graph:update":
					if (
						!isNonEmptyString(raw.graph) ||
						raw.graph === "*" ||
						!isGraphIndexPayload(raw.data) ||
						(typeof raw.data.name === "string" && raw.data.name !== raw.graph)
					) {
						notifyError({ code: "INVALID_MESSAGE", graph: "default", retryable: true });
						return;
					}
					opts.onGraph(raw.graph, raw.data);
					break;
				case "node:updated":
					if (
						!isNonEmptyString(raw.graph) ||
						raw.graph === "*" ||
						!isNonEmptyString(raw.nodeId) ||
						(raw.node !== null && !isNodePayload(raw.node)) ||
						(isNodePayload(raw.node) && raw.node.id !== raw.nodeId) ||
						(raw.removed !== undefined && typeof raw.removed !== "boolean")
					) {
						notifyError({ code: "INVALID_MESSAGE", graph: "default", retryable: true });
						return;
					}
					opts.onNodeUpdated(raw.graph, raw.nodeId, raw.node ?? null);
					break;
				case "graphs:list":
					if (raw.graph !== "*" || !isGraphsListPayload(raw.data)) {
						notifyError({ code: "INVALID_MESSAGE", graph: "default", retryable: true });
						return;
					}
					opts.onGraphsList?.(raw.data);
					break;
				case "graph:error": {
					const error = raw.error;
					if (
						!isNonEmptyString(raw.graph) ||
						raw.graph === "*" ||
						!isRecord(error) ||
						error.code !== "GRAPH_UNAVAILABLE" ||
						error.retryable !== true
					) {
						notifyError({ code: "INVALID_MESSAGE", graph: "default", retryable: true });
						return;
					}
					notifyError({ code: "GRAPH_UNAVAILABLE", graph: raw.graph, retryable: true });
					break;
				}
			}
		};

		socket.onerror = () => {
			/* onclose 会随后触发并进入重连 */
		};

		socket.onclose = () => {
			if (closed || ws !== socket) return;
			ws = null;
			scheduleReconnect();
		};
	}

	connect();

	return () => {
		closed = true;
		syncEpoch += 1;
		if (retryTimer) clearTimeout(retryTimer);
		retryTimer = null;
		try {
			ws?.close();
		} catch {
			/* 已关闭 */
		}
		ws = null;
	};
}
