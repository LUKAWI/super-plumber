import type {
	GraphIndex,
	NodeSchema,
	NodeStatus,
	EdgeSchema,
	GraphsListData,
	GraphMeta,
} from "./types";
import { DEFAULT_ACTIVE_MAPS, type ActiveMaps, type MapKind } from "./maps";
import { GraphApiError, readGraphResponse } from "./api";

export type { ActiveMaps, MapKind };

// ── UI 偏好持久化（刷新不丢透镜/折叠/当前图；v0.7 评审 P2）──
const UI_KEY = "sp.ui.v1";
interface UiPrefs {
	currentName?: string | null;
	activeMaps?: ActiveMaps;
}
function loadUiPrefs(): UiPrefs {
	try {
		return JSON.parse(localStorage.getItem(UI_KEY) ?? "{}") as UiPrefs;
	} catch {
		return {};
	}
}
function saveUiPrefs(patch: UiPrefs) {
	try {
		localStorage.setItem(UI_KEY, JSON.stringify({ ...loadUiPrefs(), ...patch }));
	} catch {
		/* 隐私模式等：静默降级为不持久化 */
	}
}
const _uiPrefs = loadUiPrefs();

export interface DiffState {
	from: string;
	to: string;
	added: string[];
	removed: string[];
	modified: string[];
	status_changes: { node: string; from: string; to: string }[];
}

export interface SnapshotInfo {
	id: string;
	created_at: string;
	message?: string;
	files: { file: string; sha256: string }[];
}

/**
 * v0.5.2 多图并行渲染：按图名分桶持有各图状态。
 * 每桶 = 图数据 + 该图的查看状态（选中/过滤/搜索/透镜/diff/快照），
 * 切换图 = 纯本地切桶（不向服务端发任何命令）；后台桶持续接收 ws 热更新，
 * 切回即时新鲜。桶未加载（graph === null）时 selectGraph 懒拉 /api/graph。
 */
interface GraphBucket {
	graph: GraphIndex | null;
	loading: boolean;
	/** 懒拉失败（网络/服务端错误）：区别于"空图"的错误态（v0.7 评审 P2） */
	loadError: string | null;
	selectedNode: NodeSchema | null;
	selectedEdge: EdgeSchema | null;
	lastPatched: NodeSchema | null;
	levelFilter: number[] | null;
	/** 状态过滤（可点状态 chips；null = 不过滤） */
	statusFilter: NodeStatus[] | null;
	/** 前沿（frontier）一键档：ready + ready_eligible 合并过滤（ctx-webui 术语） */
	frontierOnly: boolean;
	query: string;
	activeMaps: ActiveMaps;
	diff: DiffState | null;
	snapshots: SnapshotInfo[] | null;
	snapshotsLoading: boolean;
	snapshotsError: string | null;
	diffError: string | null;
}

let _buckets = $state<Record<string, GraphBucket>>({});
let _current = $state<string | null>(null);
let _graphsList = $state<GraphsListData | null>(null);
/** 全局 UI 态（不随图切换）：专注模式（瞬态，不持久化）/ 布局钉住 / 画布缩放与定位请求 */
let _focusMode = $state(false);
let _layoutPinned = $state(false);
// 2026-08-28：ADR 决策目录随「图中不设 ADR 文档入口」删除
let _diffOpen = $state(false);
let _lensOpen = $state(false);
/** 图库弹层（dock 选图器）：低频操作收进折叠栏，顶栏不再随图数量膨胀 */
let _graphsOpen = $state(false);
/** 决策文档弹层（ADR 目录）：画布徽章退役后决策文档的唯一目录入口（2026-08-28 用户拍板恢复） */
let _adrOpen = $state(false);
/** GraphCanvas 消费的命令令牌：缩放 / 定位节点 */
let _zoomRequest = $state<{ kind: "in" | "out" | "fit"; token: number } | null>(null);
let _locateRequest = $state<{ nodeId: string; token: number } | null>(null);

function newBucket(): GraphBucket {
	return {
		graph: null,
		loading: false,
		loadError: null,
		selectedNode: null,
		selectedEdge: null,
		lastPatched: null,
		levelFilter: null,
		statusFilter: null,
		frontierOnly: false,
		query: "",
		activeMaps: { ...( _uiPrefs.activeMaps ?? DEFAULT_ACTIVE_MAPS) },
		diff: null,
		snapshots: null,
		snapshotsLoading: false,
		snapshotsError: null,
		diffError: null,
	};
}

function bucketOf(name: string): GraphBucket {
	if (!_buckets[name]) _buckets[name] = newBucket();
	return _buckets[name];
}

/** 当前桶；无当前图时落到 "default"（单图兼容面：老调用方/测试不感知多图） */
function cur(): GraphBucket {
	return bucketOf(_current ?? "default");
}

function curName(): string {
	return _current ?? "default";
}

/** 只读空桶兜底（冻结防误写）：字段缺省值与 newBucket() 一致 */
const EMPTY_BUCKET: GraphBucket = newBucket();
Object.freeze(EMPTY_BUCKET);

/**
 * 当前桶的只读视图：桶未命中时返回 EMPTY_BUCKET，**绝不创建**。
 * getter 会被模板表达式（编译为 derived）在求值中调用——若此时隐式建桶
 * （变更 $state）即抛 state_unsafe_mutation，整棵组件树崩溃（0.5.2 前端
 * 黑屏根因）。建桶只允许发生在事件/异步上下文（cur()/bucketOf 的调用方：
 * selectGraph/applyFull/setGraph 等）。响应性不受影响：getter 每次仍读取
 * _buckets 与 _current（皆 $state），真实桶落地后 derived/effect 自动重算。
 */
function curReadonly(): GraphBucket {
	return _buckets[curName()] ?? EMPTY_BUCKET;
}

export const graphState = {
	// ── 多图面（v0.5.2）──
	get currentName(): string | null {
		return _current;
	},
	get graphsList(): GraphsListData | null {
		return _graphsList;
	},
	get graphMetas(): GraphMeta[] | null {
		return _graphsList?.graphs ?? null;
	},
	get activeName(): string | null {
		return _graphsList?.active ?? null;
	},
	/** 某图是否已加载过全量数据（未加载的图 selectGraph 时懒拉） */
	isLoaded(name: string): boolean {
		return _buckets[name]?.graph != null;
	},

	/** 图节点数（选图器徽标）：工作流口径——只数非知识顶点（所见即所计）。
	 *  未加载的图无数据可算，返回 null（徽标隐藏），避免列表元信息（含 context/adr）误导 */
	nodeCountOf(name: string): number | null {
		const g = _buckets[name]?.graph;
		if (g) return g.nodes.filter((n) => n.type !== "context" && n.type !== "adr").length;
		return null;
	},

	/** ws graphs:list：更新图列表；无当前图或当前图已被删 → 优先恢复上次查看的图，再退 active/首图 */
	applyGraphsList(data: GraphsListData) {
		_graphsList = data;
		const names = data.graphs.map((g) => g.name);
		if (_current === null || !names.includes(_current)) {
			const remembered = _uiPrefs.currentName;
			let pick: string | null = null;
			if (remembered && names.includes(remembered)) pick = remembered;
			else if (data.active !== null && names.includes(data.active)) pick = data.active;
			else pick = names[0] ?? null;
			if (pick !== null) this.selectGraph(pick);
		}
	},

	/** ws graph:full / HTTP 全量：落到对应桶；首个到达的图顺带成为当前图 */
	applyFull(name: string, g: GraphIndex) {
		const b = bucketOf(name);
		b.graph = g;
		b.lastPatched = null;
		if (_current === null) _current = name;
	},

	/** ws node:updated：增量更新对应桶（后台桶静默热更新，不打扰当前视图） */
	applyNodeUpdate(name: string, nodeId: string, node: NodeSchema | null) {
		const b = bucketOf(name);
		if (!b.graph) return; // 桶未加载：等全量，不凭增量拼半图
		if (node === null) {
			b.graph = {
				...b.graph,
				nodes: b.graph.nodes.filter((n) => n.id !== nodeId),
			};
			b.lastPatched = null;
			if (b.selectedNode?.id === nodeId) b.selectedNode = null;
		} else {
			// 就地替换节点对象，保持数组引用不变 → 全量 $effect 不触发
			const idx = b.graph.nodes.findIndex((n) => n.id === nodeId);
			if (idx === -1) {
				b.graph = { ...b.graph, nodes: [...b.graph.nodes, node] };
			} else {
				b.graph.nodes[idx] = node;
			}
			b.lastPatched = node;
			if (b.selectedNode?.id === nodeId) b.selectedNode = node;
		}
	},

	/** 切换查看的图（纯审阅：仅本地状态 + 未加载时 GET 懒拉，不写任何服务端状态） */
	selectGraph(name: string) {
		_current = name;
		saveUiPrefs({ currentName: name });
		_graphsOpen = false;
		_adrOpen = false;
		const b = bucketOf(name);
		b.loadError = null;
		if (b.graph === null && !b.loading) void this.fetchGraph(name);
	},

	/** 懒加载未连接过的图（切换即时渲染的兜底路径） */
	async fetchGraph(name: string) {
		const b = bucketOf(name);
		if (b.loading || b.graph !== null) return;
		b.loading = true;
		b.loadError = null;
		try {
			const res = await fetch(`/api/graph?graph=${encodeURIComponent(name)}`);
			const graph = await readGraphResponse(res);
			// 查询参数与载荷图名必须一致；缺省 name 只为旧服务端兼容，
			// 但服务端显式返回另一张图时不能把数据落进当前桶。
			if (graph.name !== undefined && graph.name !== name) {
				throw new GraphApiError("payload", "服务端返回了不匹配的图数据", res.status);
			}
			this.applyFull(name, graph);
		} catch (error: unknown) {
			if (error instanceof GraphApiError) {
				b.loadError = error.kind === "http" && error.status !== undefined
					? `服务端返回 ${error.status}`
					: "服务端返回无效图数据";
			} else {
				b.loadError = "网络不可达——检查 graph serve 是否在运行";
			}
		} finally {
			b.loading = false;
		}
	},

	/** 测试辅助：清空全部多图状态 + 持久化偏好（隔离用例间泄漏）；全局 UI 态回到生产默认 */
	resetAll() {
		_buckets = {};
		_current = null;
		_graphsList = null;
		_focusMode = false;
		_layoutPinned = false;
		_diffOpen = false;
		_lensOpen = false;
		_graphsOpen = false;
		_adrOpen = false;
		_zoomRequest = null;
		_locateRequest = null;
		try {
			localStorage.removeItem(UI_KEY);
		} catch {
			/* 非浏览器环境：忽略 */
		}
	},

	// ── 单图兼容面（作用于当前桶；组件与既有测试零改动）──
	// 全部 getter 走 curReadonly()：渲染上下文安全（见其注释）
	get graph() {
		return curReadonly().graph;
	},
	get selectedNode() {
		return curReadonly().selectedNode;
	},
	get selectedEdge() {
		return curReadonly().selectedEdge;
	},
	/** 最近一次增量更新的节点（GraphCanvas 监听它做局部刷新；仅当前桶触发画布刷新） */
	get lastPatched() {
		return curReadonly().lastPatched;
	},
	get levelFilter() {
		return curReadonly().levelFilter;
	},
	get statusFilter() {
		return curReadonly().statusFilter;
	},
	get query() {
		return curReadonly().query;
	},
	get loadError() {
		return curReadonly().loadError;
	},
	get diff() {
		return curReadonly().diff;
	},
	get snapshots() {
		return curReadonly().snapshots;
	},
	get snapshotsLoading() {
		return curReadonly().snapshotsLoading;
	},
	get snapshotsError() {
		return curReadonly().snapshotsError;
	},
	get diffError() {
		return curReadonly().diffError;
	},
	/** 当前激活的 map 子集（workflow / domain） */
	get activeMaps() {
		return curReadonly().activeMaps;
	},

	// ── 全局 UI 态（v0.7 工具轨/专注模式/画布命令）──
	get focusMode() {
		return _focusMode;
	},
	setFocusMode(v: boolean) {
		_focusMode = v;
		if (v) {
			// 专注模式 = 画布即一切：入口先收掉所有浮层与详情抽屉，Esc 才能干净退出
			_diffOpen = false;
			_lensOpen = false;
			_graphsOpen = false;
			_adrOpen = false;
			const b = cur();
			b.selectedNode = null;
			b.selectedEdge = null;
		}
	},
	get layoutPinned() {
		return _layoutPinned;
	},
	setLayoutPinned(v: boolean) {
		_layoutPinned = v;
	},
	get diffOpen() {
		return _diffOpen;
	},
	toggleDiff() {
		_diffOpen = !_diffOpen;
		if (_diffOpen) {
			_lensOpen = false;
			_graphsOpen = false;
			_adrOpen = false;
			// 右缘抽屉互斥：开对比即收详情（同一泊位，评审 F1 的结构性解法）
			const b = cur();
			b.selectedNode = null;
			b.selectedEdge = null;
			void this.loadSnapshots();
			void this.loadDiff();
		} else {
			this.clearDiff();
		}
	},
	get lensOpen() {
		return _lensOpen;
	},
	toggleLens() {
		_lensOpen = !_lensOpen;
		if (_lensOpen) {
			_diffOpen = false;
			_graphsOpen = false;
			_adrOpen = false;
		}
	},
	get graphsOpen() {
		return _graphsOpen;
	},
	toggleGraphs() {
		_graphsOpen = !_graphsOpen;
		if (_graphsOpen) {
			_diffOpen = false;
			_lensOpen = false;
			_adrOpen = false;
		}
	},
	get adrOpen() {
		return _adrOpen;
	},
	toggleAdr() {
		_adrOpen = !_adrOpen;
		if (_adrOpen) {
			_diffOpen = false;
			_lensOpen = false;
			_graphsOpen = false;
		}
	},
	get zoomRequest() {
		return _zoomRequest;
	},
	requestZoom(kind: "in" | "out" | "fit") {
		_zoomRequest = { kind, token: (_zoomRequest?.token ?? 0) + 1 };
	},
	get locateRequest() {
		return _locateRequest;
	},
	/** 画布平移居中到指定节点（搜索 Enter 跳转） */
	locateNode(nodeId: string) {
		_locateRequest = { nodeId, token: (_locateRequest?.token ?? 0) + 1 };
	},

	setGraph(g: GraphIndex | null) {
		cur().graph = g;
		cur().lastPatched = null;
	},

	/** 增量更新当前图的节点（就地替换 nodes 数组中的对象，不换数组引用） */
	patchNode(nodeId: string, node: NodeSchema | null) {
		this.applyNodeUpdate(curName(), nodeId, node);
	},

	/** 选中即纯数据快照：剥掉 d3 SimNode 附加字段（x/y/fx/index…），避免模拟对象泄漏进 UI 层 */
	selectNode(n: NodeSchema | null) {
		cur().selectedNode = n ? this.plainNode(n) : null;
		if (n) {
			cur().selectedEdge = null;
			// 右缘抽屉互斥：选中节点即退出对比面板与目录弹层（单焦点）
			_diffOpen = false;
			_adrOpen = false;
			this.clearDiff();
		}
	},

	selectEdge(e: EdgeSchema | null) {
		cur().selectedEdge = e;
		if (e) {
			cur().selectedNode = null;
			_diffOpen = false;
			this.clearDiff();
		}
	},

	setLevelFilter(levels: number[] | null) {
		cur().levelFilter = levels;
	},

	toggleLevel(level: number) {
		const b = cur();
		if (b.levelFilter === null) {
			b.levelFilter = [level];
		} else if (b.levelFilter.includes(level)) {
			b.levelFilter = b.levelFilter.filter((l) => l !== level);
			if (b.levelFilter.length === 0) b.levelFilter = null;
		} else {
			b.levelFilter = [...b.levelFilter, level];
		}
	},

	/** 状态过滤（顶栏可点状态 chips）：null = 不过滤；全部取消即回到不过滤 */
	toggleStatus(status: NodeStatus) {
		const b = cur();
		if (b.statusFilter === null) {
			b.statusFilter = [status];
		} else if (b.statusFilter.includes(status)) {
			const next = b.statusFilter.filter((s) => s !== status);
			b.statusFilter = next.length > 0 ? next : null;
		} else {
			b.statusFilter = [...b.statusFilter, status];
		}
	},

	clearStatusFilter() {
		cur().statusFilter = null;
	},

	/** 前沿（frontier）一键档：开 = 只强调「现在就能干的活」（ready+ready_eligible） */
	get frontierOnly() {
		return curReadonly().frontierOnly;
	},
	setFrontierOnly(v: boolean) {
		cur().frontierOnly = v;
	},
	toggleFrontier() {
		const b = cur();
		b.frontierOnly = !b.frontierOnly;
	},

	setQuery(q: string) {
		cur().query = q;
	},

	/** map 透镜开关（任意子集叠加；两个都关 = 空视图，由画布提示）；开关即持久化 */
	toggleMap(kind: MapKind) {
		const b = cur();
		b.activeMaps = { ...b.activeMaps, [kind]: !b.activeMaps[kind] };
		saveUiPrefs({ activeMaps: b.activeMaps });
	},

	setActiveMaps(maps: ActiveMaps) {
		cur().activeMaps = { ...maps };
		saveUiPrefs({ activeMaps: cur().activeMaps });
	},

	setDiff(d: DiffState | null) {
		cur().diff = d;
		cur().diffError = null;
	},

	async loadSnapshots() {
		const b = cur();
		b.snapshotsLoading = true;
		b.snapshotsError = null;
		try {
			const res = await fetch(`/api/snapshots?graph=${encodeURIComponent(curName())}`);
			if (!res.ok) {
				b.snapshotsError = `服务端返回 ${res.status}`;
				b.snapshots = [];
				return;
			}
			b.snapshots = (await res.json()) as SnapshotInfo[];
		} catch {
			b.snapshotsError = "网络不可达，加载快照列表失败";
			b.snapshots = [];
		} finally {
			b.snapshotsLoading = false;
		}
	},

	async loadDiff(against?: string) {
		const b = cur();
		const params = new URLSearchParams({ graph: curName() });
		if (against) params.set("against", against);
		b.diffError = null;
		try {
			const res = await fetch(`/api/diff?${params.toString()}`);
			const data = (await res.json()) as DiffState | { error: string };
			if ("error" in data) {
				b.diff = null;
				b.diffError = data.error;
			} else {
				b.diff = data;
			}
		} catch {
			b.diff = null;
			b.diffError = "网络不可达，对比加载失败";
		}
	},

	clearDiff() {
		cur().diff = null;
		cur().diffError = null;
	},

	/** 剥离 d3 模拟附加字段，输出纯 NodeSchema 视图 */
	plainNode(n: NodeSchema): NodeSchema {
		const {
			x: _x, y: _y, vx: _vx, vy: _vy,
			fx: _fx, fy: _fy, index: _index,
			...rest
		} = n as NodeSchema & Record<string, unknown>;
		return rest as NodeSchema;
	},
};
