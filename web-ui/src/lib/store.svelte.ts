import type { GraphIndex, NodeSchema } from "./types";

let _graph: GraphIndex | null = $state(null);
let _selectedNode: NodeSchema | null = $state(null);
let _lastPatched: NodeSchema | null = $state(null);

export const graphState = {
  get graph() { return _graph; },
  get selectedNode() { return _selectedNode; },
  /** 最近一次增量更新的节点（GraphCanvas 监听它做局部刷新） */
  get lastPatched() { return _lastPatched; },

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

  selectNode(n: NodeSchema | null) { _selectedNode = n; },
};
