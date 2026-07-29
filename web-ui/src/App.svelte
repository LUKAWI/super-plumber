<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import GraphCanvas from "./components/GraphCanvas.svelte";
  import NodeDetail from "./components/NodeDetail.svelte";
  import { connectGraph } from "./lib/api";
  import { graphState } from "./lib/store.svelte";

  let disconnect: (() => void) | null = null;
  let connected = $state(false);

  onMount(() => {
    disconnect = connectGraph(location.host, (g) => {
      graphState.setGraph(g);
      connected = true;
    });
  });
  onDestroy(() => disconnect?.());
</script>

<div class="app">
  <header class="header">
    <div class="brand">
      <svg class="logo" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="6" cy="6" r="3"/>
        <circle cx="18" cy="12" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M9 6h6M9 18h6M15 12H9"/>
      </svg>
      <h1>TopoGraph</h1>
    </div>
    <nav class="legend">
      {#each [
        { label: "pending", color: "#94a3b8" },
        { label: "ready", color: "#3b82f6" },
        { label: "running", color: "#f59e0b" },
        { label: "passed", color: "#22c55e" },
        { label: "failed", color: "#ef4444" },
        { label: "blocked", color: "#8b5cf6" },
        { label: "cancelled", color: "#6b7280" },
      ] as item}
        <span class="legend-item" style="background: {item.color}">
          {item.label}
        </span>
      {/each}
    </nav>
    {#if graphState.graph}
      <div class="stats">
        <span class="stat">{graphState.graph.nodes.length} 节点</span>
        <span class="stat-divider">·</span>
        <span class="stat">{graphState.graph.edges.length} 边</span>
      </div>
    {/if}
  </header>

  <main class="main">
    {#if !connected}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>连接拓扑服务中...</p>
      </div>
    {:else if graphState.graph && graphState.graph.nodes.length === 0}
      <div class="empty-state">
        <svg viewBox="0 0 80 80" width="80" height="80" fill="none" stroke="#334155" stroke-width="1.5">
          <circle cx="20" cy="20" r="6"/>
          <circle cx="60" cy="40" r="6"/>
          <circle cx="20" cy="60" r="6"/>
          <path d="M26 20h14M26 60h14M46 40H34" stroke-dasharray="4 3"/>
        </svg>
        <h3>空白拓扑图</h3>
        <p>使用 <code>graph create-node</code> 添加第一个节点</p>
      </div>
    {:else}
      <GraphCanvas />
    {/if}
  </main>

  <NodeDetail />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #0b1120;
    color: #e2e8f0;
    font-family: "Inter", system-ui, -apple-system, sans-serif;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.625rem 1.25rem;
    border-bottom: 1px solid #1e293b;
    background: #0f172a;
    -webkit-user-select: none;
    user-select: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .brand h1 {
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0;
    color: #f1f5f9;
  }
  .logo {
    color: #6366f1;
    flex-shrink: 0;
  }

  /* ── Legend ── */
  .legend {
    display: flex;
    gap: 3px;
  }
  .legend-item {
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: #fff;
    transition: transform 0.15s var(--ease-out-quart), filter 0.15s var(--ease-out-quart);
    cursor: default;
  }
  .legend-item:hover {
    transform: translateY(-1px);
    filter: brightness(1.15);
  }

  /* ── Stats ── */
  .stats {
    margin-left: auto;
    font-size: 0.75rem;
    color: #64748b;
    font-variant-numeric: tabular-nums;
  }
  .stat-divider {
    margin: 0 0.35rem;
    opacity: 0.4;
  }

  /* ── Main ── */
  .main {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Loading ── */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    color: #64748b;
    font-size: 0.85rem;
  }
  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid #1e293b;
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Empty state ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    color: #475569;
    opacity: 0.8;
    animation: fadeIn 0.5s var(--ease-out-quart);
  }
  .empty-state h3 {
    margin: 0.5rem 0 0;
    font-size: 1rem;
    font-weight: 500;
    color: #64748b;
  }
  .empty-state p {
    margin: 0;
    font-size: 0.8rem;
  }
  .empty-state code {
    background: #1e293b;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 0.75rem;
    color: #94a3b8;
  }

  /* ── Animations ── */
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Reduced motion ── */
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      opacity: 0.5;
    }
    .legend-item { transition: none; }
    .empty-state { animation: none; }
  }
</style>
