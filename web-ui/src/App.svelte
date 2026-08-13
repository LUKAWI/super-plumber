<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import GraphCanvas from "./components/GraphCanvas.svelte";
  import NodeDetail from "./components/NodeDetail.svelte";
  import EdgeDetail from "./components/EdgeDetail.svelte";
  import DiffPanel from "./components/DiffPanel.svelte";
  import { connectGraph } from "./lib/api";
  import { graphState } from "./lib/store.svelte";

  let disconnect: (() => void) | null = null;
  let connected = $state(false);

  onMount(() => {
    disconnect = connectGraph(
      location.host,
      (g) => {
        graphState.setGraph(g);
        connected = true;
      },
      (nodeId, node) => graphState.patchNode(nodeId, node),
    );
  });
  onDestroy(() => disconnect?.());

  // 层级过滤（L0–L5，P4-4 分层钻取）
  const LEVELS = [0, 1, 2, 3, 4, 5];
  const levelsPresent = $derived(
    graphState.graph
      ? [...new Set(graphState.graph.nodes.map((n) => n.level))].sort((a, b) => a - b)
      : [],
  );

  const summary = $derived.by(() => {
    const g = graphState.graph;
    if (!g) return null;
    const s = { total: g.nodes.length, passed: 0, running: 0, blocked: 0, failed: 0, ready: 0 };
    for (const n of g.nodes) {
      if (n.status === "passed") s.passed++;
      else if (n.status === "running") s.running++;
      else if (n.status === "blocked") s.blocked++;
      else if (n.status === "failed") s.failed++;
      else if (n.status === "ready") s.ready++;
    }
    return s;
  });
</script>

<div class="app">
  <header class="header">
    <div class="brand">
      <span class="logo" aria-hidden="true">⬡</span>
      <div class="brand-text">
        <h1 class="title">SUPER PLUMBER</h1>
        {#if graphState.graph}
          <span class="graph-label">{graphState.graph.label}</span>
        {/if}
      </div>
    </div>

    {#if summary}
      <div class="status-bar" aria-label="状态摘要">
        <span class="sb-item total">{summary.total}<span class="sb-unit">total</span></span>
        <span class="sb-item ready">{summary.ready}<span class="sb-unit">ready</span></span>
        <span class="sb-item running">{summary.running}<span class="sb-unit">running</span></span>
        <span class="sb-item passed">{summary.passed}<span class="sb-unit">passed</span></span>
        <span class="sb-item blocked">{summary.blocked}<span class="sb-unit">blocked</span></span>
        <span class="sb-item failed">{summary.failed}<span class="sb-unit">failed</span></span>
      </div>
    {/if}

    <nav class="legend" aria-label="状态图例">
      {#each [
        { label: "pending", color: "var(--status-pending)" },
        { label: "ready", color: "var(--status-ready)" },
        { label: "running", color: "var(--status-running)" },
        { label: "passed", color: "var(--status-passed)" },
        { label: "failed", color: "var(--status-failed)" },
        { label: "blocked", color: "var(--status-blocked)" },
        { label: "cancelled", color: "var(--status-cancelled)" },
      ] as item}
        <span class="legend-item">
          <span class="legend-dot" style="background: {item.color}"></span>
          <span class="legend-label">{item.label}</span>
        </span>
      {/each}
    </nav>

    <div class="stats">
      <span class="stat">{graphState.graph?.nodes.length ?? 0}<span class="stat-unit">n</span></span>
      <span class="stat-divider">·</span>
      <span class="stat">{graphState.graph?.edges.length ?? 0}<span class="stat-unit">e</span></span>
      {#if !connected}
        <span class="conn-off" title="连接中断，自动重连中">offline</span>
      {/if}
    </div>
  </header>

  {#if graphState.graph && levelsPresent.length > 0}
    <div class="filter-bar">
      <div class="level-chips" role="group" aria-label="按层级过滤">
        {#each LEVELS.filter((l) => levelsPresent.includes(l)) as l}
          <button
            class="level-chip {graphState.levelFilter?.includes(l) ? 'active' : ''}"
            onclick={() => graphState.toggleLevel(l)}
          >
            L{l}
          </button>
        {/each}
        {#if graphState.levelFilter}
          <button class="level-chip clear" onclick={() => graphState.setLevelFilter(null)}>
            清除
          </button>
        {/if}
      </div>
      <input
        class="search-input"
        type="search"
        placeholder="搜索 id / label…"
        value={graphState.query}
        oninput={(e) => graphState.setQuery((e.currentTarget as HTMLInputElement).value)}
        aria-label="搜索节点"
      />
    </div>
  {/if}

  <main class="main">
    {#if !connected}
      <div class="loading-state">
        <div class="skeleton-graph">
          <div class="skeleton-node" style="left: 20%; top: 30%;"></div>
          <div class="skeleton-node" style="left: 45%; top: 25%;"></div>
          <div class="skeleton-node" style="left: 70%; top: 35%;"></div>
          <div class="skeleton-node" style="left: 30%; top: 60%;"></div>
          <div class="skeleton-node" style="left: 55%; top: 65%;"></div>
          <div class="skeleton-node" style="left: 80%; top: 55%;"></div>
          <svg class="skeleton-edges" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1="20" y1="30" x2="45" y2="25" class="skeleton-edge"/>
            <line x1="45" y1="25" x2="70" y2="35" class="skeleton-edge"/>
            <line x1="20" y1="30" x2="30" y2="60" class="skeleton-edge"/>
            <line x1="45" y1="25" x2="55" y2="65" class="skeleton-edge"/>
            <line x1="70" y1="35" x2="80" y2="55" class="skeleton-edge"/>
          </svg>
        </div>
        <p class="loading-text">connecting to topology service…</p>
      </div>
    {:else if graphState.graph && graphState.graph.nodes.length === 0}
      <div class="empty-state">
        <svg viewBox="0 0 80 80" width="80" height="80" fill="none" stroke="var(--ink-faint)" stroke-width="1.5">
          <circle cx="20" cy="20" r="6"/>
          <circle cx="60" cy="40" r="6"/>
          <circle cx="20" cy="60" r="6"/>
          <path d="M26 20h14M26 60h14M46 40H34" stroke-dasharray="4 3"/>
        </svg>
        <h3 class="empty-title">empty topology</h3>
        <p class="empty-hint">
          <code>graph create-node</code> to add the first node
        </p>
      </div>
    {:else}
      <GraphCanvas />
      <DiffPanel />
    {/if}
  </main>

  <NodeDetail />
  <EdgeDetail />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
    color: var(--ink);
    overflow: hidden;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--line);
    background: var(--surface-1);
    user-select: none;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .logo {
    font-size: var(--text-md);
    color: var(--ink-muted);
    line-height: 1;
  }

  .title {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 700;
    letter-spacing: var(--track-caps);
    margin: 0;
    color: var(--ink);
    text-transform: uppercase;
    line-height: 1.2;
  }

  .graph-label {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    letter-spacing: var(--track-label);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── 状态摘要条 ── */
  .status-bar {
    display: flex;
    gap: var(--sp-1);
    margin-left: var(--sp-2);
  }

  .sb-item {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }

  .sb-unit {
    font-size: var(--text-2xs);
    font-weight: 400;
    color: var(--ink-faint);
    margin-left: 3px;
    text-transform: lowercase;
  }

  .sb-item.total { color: var(--ink); }
  .sb-item.ready { color: var(--status-ready); }
  .sb-item.running { color: var(--status-running); }
  .sb-item.passed { color: var(--status-passed); }
  .sb-item.blocked { color: var(--status-blocked); }
  .sb-item.failed { color: var(--status-failed); }

  /* ── Legend ── */
  .legend {
    display: flex;
    gap: var(--sp-2);
    margin-left: var(--sp-4);
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--r-sm);
    transition: background 0.15s var(--ease-out-quart);
    cursor: default;
  }

  .legend-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .legend-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .legend-label {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-muted);
    text-transform: lowercase;
    letter-spacing: var(--track-label);
  }

  /* ── Stats ── */
  .stats {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--track-label);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .stat {
    color: var(--ink);
    font-weight: 500;
  }

  .stat-unit {
    color: var(--ink-faint);
    margin-left: 1px;
  }

  .stat-divider {
    color: var(--ink-faint);
  }

  .conn-off {
    color: var(--status-failed);
    font-size: var(--text-2xs);
    border: 1px solid rgba(229, 80, 79, 0.5);
    border-radius: var(--r-sm);
    padding: 1px var(--sp-1);
  }

  /* ── Filter bar ── */
  .filter-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-4);
    border-bottom: 1px solid var(--line);
    background: var(--surface-1);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .level-chips {
    display: flex;
    gap: var(--sp-1);
  }

  .level-chip {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    padding: 2px var(--sp-2);
    border-radius: var(--r-sm);
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink-muted);
    cursor: pointer;
    letter-spacing: var(--track-label);
    transition: background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart), border-color 0.15s var(--ease-out-quart);
  }

  .level-chip:hover {
    color: var(--ink);
    border-color: var(--line-strong);
  }

  .level-chip.active {
    background: var(--surface-3);
    color: var(--ink);
    border-color: var(--line-strong);
  }

  .level-chip.clear {
    color: var(--ink-faint);
  }

  .search-input {
    margin-left: auto;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: var(--sp-1) var(--sp-2);
    width: 200px;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--line-strong);
  }

  /* ── Main ── */
  .main {
    flex: 1 1 0%;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  /* ── Loading ── */
  .loading-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-4);
    color: var(--ink-muted);
  }

  .skeleton-graph {
    position: relative;
    width: 400px;
    height: 300px;
    opacity: 0.4;
  }

  .skeleton-node {
    position: absolute;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--surface-3);
    border: 2px solid var(--line-strong);
    animation: skeleton-pulse 1.5s ease-in-out infinite;
  }

  .skeleton-node:nth-child(1) { animation-delay: 0s; }
  .skeleton-node:nth-child(2) { animation-delay: 0.1s; }
  .skeleton-node:nth-child(3) { animation-delay: 0.2s; }
  .skeleton-node:nth-child(4) { animation-delay: 0.3s; }
  .skeleton-node:nth-child(5) { animation-delay: 0.4s; }
  .skeleton-node:nth-child(6) { animation-delay: 0.5s; }

  .skeleton-edges {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .skeleton-edge {
    stroke: var(--line-strong);
    stroke-width: 0.5;
    stroke-dasharray: 2 1;
    animation: skeleton-pulse 1.5s ease-in-out infinite;
  }

  .skeleton-edge:nth-child(1) { animation-delay: 0.1s; }
  .skeleton-edge:nth-child(2) { animation-delay: 0.2s; }
  .skeleton-edge:nth-child(3) { animation-delay: 0.3s; }
  .skeleton-edge:nth-child(4) { animation-delay: 0.4s; }
  .skeleton-edge:nth-child(5) { animation-delay: 0.5s; }

  @keyframes skeleton-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.6; }
  }

  .loading-text {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    margin: 0;
    letter-spacing: var(--track-label);
  }

  /* ── Empty state ── */
  .empty-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-3);
    color: var(--ink-faint);
    opacity: 0.6;
    animation: fadeIn 0.4s var(--ease-out-quart);
  }

  .empty-title {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 600;
    margin: var(--sp-2) 0 0;
    color: var(--ink-muted);
    text-transform: uppercase;
    letter-spacing: var(--track-caps);
  }

  .empty-hint {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    margin: 0;
    color: var(--ink-faint);
    letter-spacing: var(--track-label);
  }

  .empty-hint code {
    background: var(--surface-2);
    padding: 2px 6px;
    border-radius: var(--r-sm);
    color: var(--ink-muted);
    font-family: var(--font-mono);
  }

  /* ── Animations ── */
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 0.6; transform: translateY(0); }
  }

  /* ── Reduced motion ── */
  @media (prefers-reduced-motion: reduce) {
    .legend-item { transition: none; }
    .empty-state { animation: none; }
    .skeleton-node, .skeleton-edge { animation: none; opacity: 0.5; }
  }

  /* ── Responsive ── */
  @media (max-width: 768px) {
    .header {
      padding: var(--sp-2) var(--sp-3);
      gap: var(--sp-2);
    }
    .legend { display: none; }
    .status-bar { display: none; }
    .title { font-size: var(--text-xs); }
    .search-input { width: 120px; }
  }
</style>
