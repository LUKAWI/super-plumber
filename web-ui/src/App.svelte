<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import GraphCanvas from "./components/GraphCanvas.svelte";
  import NodeDetail from "./components/NodeDetail.svelte";
  import { connectGraph } from "./lib/api";
  import { graphState } from "./lib/store.svelte";

  let disconnect: (() => void) | null = null;

  onMount(() => {
    disconnect = connectGraph(location.host, (g) => graphState.setGraph(g));
  });
  onDestroy(() => disconnect?.());
</script>

<div class="app">
  <header class="header">
    <h1>拓扑图可视化</h1>
    <div class="legend">
      <span class="legend-item" style="background: #94a3b8">pending</span>
      <span class="legend-item" style="background: #3b82f6">ready</span>
      <span class="legend-item" style="background: #f59e0b">running</span>
      <span class="legend-item" style="background: #22c55e">passed</span>
      <span class="legend-item" style="background: #ef4444">failed</span>
      <span class="legend-item" style="background: #8b5cf6">blocked</span>
      <span class="legend-item" style="background: #6b7280">cancelled</span>
    </div>
    <div class="stats">
      节点: {graphState.graph?.nodes.length ?? 0}
      边: {graphState.graph?.edges.length ?? 0}
    </div>
  </header>
  <main class="main">
    <GraphCanvas />
  </main>
  <NodeDetail />
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; background: #0f172a; color: #e2e8f0; }
  .header { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1rem; border-bottom: 1px solid #1e293b; }
  .header h1 { font-size: 1rem; margin: 0; }
  .legend { display: flex; gap: 4px; font-size: 0.7rem; }
  .legend-item { padding: 2px 6px; border-radius: 3px; color: #fff; }
  .stats { margin-left: auto; font-size: 0.8rem; color: #64748b; }
  .main { flex: 1; position: relative; }
</style>
