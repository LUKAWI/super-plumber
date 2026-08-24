import type {
	GraphIndex,
	NodeSchema,
	EdgeSchema,
	GraphsListData,
	GraphMeta,
} from "./types";
import { DEFAULT_ACTIVE_MAPS, type ActiveMaps, type MapKind } from "./maps";

export type { ActiveMaps, MapKind };

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
	selectedNode: NodeSchema | null;
	selectedEdge: EdgeSchema | null;
	lastPatched: NodeSchema | null;
	levelFilter: number[] | null;
	query: string;
	activeMaps: ActiveMaps;
	diff: DiffState | null;
	snapshots: SnapshotInfo[] | null;
	snapshotsLoading: boolean;
}

let _buckets = $state<Record<string, GraphBucket>>({});
let _current = $state<string | null>(null);
let _graphsList = $state<GraphsListData | null>(null);

function newBucket(): GraphBucket {
	return {
		graph: null,
		loading: false,
		selectedNode: null,
		selectedEdge: null,
		lastPatched: null,
		levelFilter: null,
		query: "",
		activeMaps: { ...DEFAULT_ACTIVE_MAPS },
		diff: null,
		snapshots: null,
		snapshotsLoading: false,
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

	/** 图节点数（选图器徽标）：已加载桶用实时数据，否则退回列表元信息 */
	nodeCountOf(name: string): number {
		const b = _buckets[name];
		if (b?.graph) return b.graph.nodes.length;
		return _graphsList?.graphs.find((g) => g.name === name)?.nodeCount ?? 0;
	},

	/** ws graphs:list：更新图列表；无当前图或当前图已被删 → 选中 active（初始选中） */
	applyGraphsList(data: GraphsListData) {
		_graphsList = data;
		const names = data.graphs.map((g) => g.name);
		if (_current === null || !names.includes(_current)) {
			const pick =
				data.active !== null && names.includes(data.active) ? data.active : (names[0] ?? null);
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
		const b = bucketOf(name);
		if (b.graph === null && !b.loading) void this.fetchGraph(name);
	},

	/** 懒加载未连接过的图（切换即时渲染的兜底路径） */
	async fetchGraph(name: string) {
		const b = bucketOf(name);
		if (b.loading || b.graph !== null) return;
		b.loading = true;
		try {
			const res = await fetch(`/api/graph?graph=${encodeURIComponent(name)}`);
			if (res.ok) {
				this.applyFull(name, (await res.json()) as GraphIndex);
			}
		} catch {
			/* 离线：留待重连 full / 下次切换重试 */
		} finally {
			b.loading = false;
		}
	},

	/** 测试辅助：清空全部多图状态 */
	resetAll() {
		_buckets = {};
		_current = null;
		_graphsList = null;
	},

	// ── 单图兼容面（作用于当前桶；组件与既有测试零改动）──
	get graph() {
		return cur().graph;
	},
	get selectedNode() {
		return cur().selectedNode;
	},
	get selectedEdge() {
		return cur().selectedEdge;
	},
	/** 最近一次增量更新的节点（GraphCanvas 监听它做局部刷新；仅当前桶触发画布刷新） */
	get lastPatched() {
		return cur().lastPatched;
	},
	get levelFilter() {
		return cur().levelFilter;
	},
	get query() {
		return cur().query;
	},
	get diff() {
		return cur().diff;
	},
	get snapshots() {
		return cur().snapshots;
	},
	get snapshotsLoading() {
		return cur().snapshotsLoading;
	},
	/** 当前激活的 map 子集（workflow / domain） */
	get activeMaps() {
		return cur().activeMaps;
	},

	setGraph(g: GraphIndex | null) {
		cur().graph = g;
		cur().lastPatched = null;
	},

	/** 增量更新当前图的节点（就地替换 nodes 数组中的对象，不换数组引用） */
	patchNode(nodeId: string, node: NodeSchema | null) {
		this.applyNodeUpdate(curName(), nodeId, node);
	},

	selectNode(n: NodeSchema | null) {
		cur().selectedNode = n;
		if (n) cur().selectedEdge = null;
	},

	selectEdge(e: EdgeSchema | null) {
		cur().selectedEdge = e;
		if (e) cur().selectedNode = null;
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

	setQuery(q: string) {
		cur().query = q;
	},

	/** map 透镜开关（任意子集叠加；两个都关 = 空视图，由画布提示） */
	toggleMap(kind: MapKind) {
		const b = cur();
		b.activeMaps = { ...b.activeMaps, [kind]: !b.activeMaps[kind] };
	},

	setActiveMaps(maps: ActiveMaps) {
		cur().activeMaps = { ...maps };
	},

	setDiff(d: DiffState | null) {
		cur().diff = d;
	},

	async loadSnapshots() {
		const b = cur();
		b.snapshotsLoading = true;
		try {
			const res = await fetch(`/api/snapshots?graph=${encodeURIComponent(curName())}`);
			b.snapshots = (await res.json()) as SnapshotInfo[];
		} catch {
			b.snapshots = [];
		} finally {
			b.snapshotsLoading = false;
		}
	},

	async loadDiff(against?: string) {
		const b = cur();
		const params = new URLSearchParams({ graph: curName() });
		if (against) params.set("against", against);
		try {
			const res = await fetch(`/api/diff?${params.toString()}`);
			const data = (await res.json()) as DiffState | { error: string };
			if ("error" in data) {
				b.diff = null;
			} else {
				b.diff = data;
			}
		} catch {
			b.diff = null;
		}
	},

	clearDiff() {
		cur().diff = null;
	},
};
