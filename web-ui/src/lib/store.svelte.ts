import type { GraphIndex, NodeSchema } from "./types";

let _graph: GraphIndex | null = $state(null);
let _selectedNode: NodeSchema | null = $state(null);

export const graphState = {
  get graph() { return _graph; },
  get selectedNode() { return _selectedNode; },
  setGraph(g: GraphIndex | null) { _graph = g; },
  selectNode(n: NodeSchema | null) { _selectedNode = n; },
};
