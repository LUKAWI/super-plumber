import type { GraphIndex, NodeSchema, EdgeSchema } from "./types";

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

let _graph: GraphIndex | null = $state(null);
let _selectedNode: NodeSchema | null = $state(null);
let _selectedEdge: EdgeSchema | null = $state(null);
let _lastPatched: NodeSchema | null = $state(null);
// 过滤与 diff（P4-4/P4-5）
let _levelFilter: number[] | null = $state(null); // null = 不过滤
let _query = $state("");
let _diff: DiffState | null = $state(null);
let _snapshots: SnapshotInfo[] | null = $state(null);
let _snapshotsLoading = $state(false);

export const graphState = {
	get graph() { return _graph; },
	get selectedNode() { return _selectedNode; },
	get selectedEdge() { return _selectedEdge; },
	/** 最近一次增量更新的节点（GraphCanvas 监听它做局部刷新） */
	get lastPatched() { return _lastPatched; },
	get levelFilter() { return _levelFilter; },
	get query() { return _query; },
	get diff() { return _diff; },
	get snapshots() { return _snapshots; },
	get snapshotsLoading() { return _snapshotsLoading; },

	setGraph(g: GraphIndex | null) {
		_graph = g;
		_lastPatched = null;
	},

	/** 增量更新单个节点：就地替换 nodes 数组中的对象（不换数组引用） */
	patchNode(nodeId: string, node: NodeSchema | null) {
		if (!_graph) return;
		if (node === null) {
			// 节点删除：过滤掉（低频事件，允许数组替换）
			_graph = {
				..._graph,
				nodes: _graph.nodes.filter((n) => n.id !== nodeId),
			};
			_lastPatched = null;
			if (_selectedNode?.id === nodeId) _selectedNode = null;
		} else {
			// 就地替换节点对象，保持数组引用不变 → 全量 $effect 不触发
			const idx = _graph.nodes.findIndex((n) => n.id === nodeId);
			if (idx === -1) {
				_graph = { ..._graph, nodes: [..._graph.nodes, node] };
			} else {
				_graph.nodes[idx] = node;
			}
			_lastPatched = node;
			if (_selectedNode?.id === nodeId) _selectedNode = node;
		}
	},

	selectNode(n: NodeSchema | null) {
		_selectedNode = n;
		if (n) _selectedEdge = null;
	},

	selectEdge(e: EdgeSchema | null) {
		_selectedEdge = e;
		if (e) _selectedNode = null;
	},

	setLevelFilter(levels: number[] | null) {
		_levelFilter = levels;
	},

	toggleLevel(level: number) {
		if (_levelFilter === null) {
			_levelFilter = [level];
		} else if (_levelFilter.includes(level)) {
			_levelFilter = _levelFilter.filter((l) => l !== level);
			if (_levelFilter.length === 0) _levelFilter = null;
		} else {
			_levelFilter = [..._levelFilter, level];
		}
	},

	setQuery(q: string) {
		_query = q;
	},

	setDiff(d: DiffState | null) {
		_diff = d;
	},

	async loadSnapshots() {
		_snapshotsLoading = true;
		try {
			const res = await fetch("/api/snapshots");
			_snapshots = (await res.json()) as SnapshotInfo[];
		} catch {
			_snapshots = [];
		} finally {
			_snapshotsLoading = false;
		}
	},

	async loadDiff(against?: string) {
		const url = against ? `/api/diff?against=${encodeURIComponent(against)}` : "/api/diff";
		try {
			const res = await fetch(url);
			const data = (await res.json()) as DiffState | { error: string };
			if ("error" in data) {
				_diff = null;
			} else {
				_diff = data;
			}
		} catch {
			_diff = null;
		}
	},

	clearDiff() {
		_diff = null;
	},
};
