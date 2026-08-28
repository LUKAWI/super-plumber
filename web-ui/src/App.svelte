<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import GraphCanvas from "./components/GraphCanvas.svelte";
  import NodeDetail from "./components/NodeDetail.svelte";
  import EdgeDetail from "./components/EdgeDetail.svelte";
  import DiffPanel from "./components/DiffPanel.svelte";
  import { createGraphConnection } from "./lib/api";
  import { graphState } from "./lib/store.svelte";
  import { deriveMaps } from "./lib/maps";
  import type { NodeStatus } from "./lib/types";

  let disconnect: (() => void) | null = null;
  let connStatus = $state<"connecting" | "connected" | "offline">("connecting");

  onMount(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    disconnect = createGraphConnection({
      url: `${protocol}//${location.host}`,
      // 消息按 graph 字段路由到对应桶：当前图渲染刷新，后台图静默热更新
      onGraph: (name, g) => graphState.applyFull(name, g),
      onNodeUpdated: (name, nodeId, node) => graphState.applyNodeUpdate(name, nodeId, node),
      onGraphsList: (data) => graphState.applyGraphsList(data),
      onStatusChange: (s) => (connStatus = s),
    });
  });
  onDestroy(() => disconnect?.());

  const graphMetas = $derived(graphState.graphMetas);
  const currentName = $derived(graphState.currentName);
  const focusMode = $derived(graphState.focusMode);
  const layoutPinned = $derived(graphState.layoutPinned);

  // 层级过滤（L0–L5，分层钻取）
  const LEVELS = [0, 1, 2, 3, 4, 5];
  const levelsPresent = $derived(
    graphState.graph
      ? [...new Set(graphState.graph.nodes.map((n) => n.level))].sort((a, b) => a - b)
      : [],
  );

  // 状态计数（顶栏可点 chips：计数即图例，点击即过滤）
  const STATUSES: { key: NodeStatus; label: string }[] = [
    { key: "pending", label: "pending" },
    { key: "ready", label: "ready" },
    { key: "running", label: "running" },
    { key: "passed", label: "passed" },
    { key: "failed", label: "failed" },
    { key: "blocked", label: "blocked" },
    { key: "cancelled", label: "cancelled" },
  ];
  const statusCounts = $derived.by(() => {
    const counts = new Map<NodeStatus, number>();
    for (const s of STATUSES) counts.set(s.key, 0);
    const g = graphState.graph;
    if (g) for (const n of g.nodes) {
      const k = n.status as NodeStatus;
      if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  });

  // map 透镜计数（工具轨透镜 flyout 展示每个 map 的顶点规模）
  const mapCounts = $derived.by(() => {
    const g = graphState.graph;
    if (!g) return { workflow: 0, domain: 0 };
    const maps = deriveMaps(g.nodes);
    return { workflow: maps.workflow.length, domain: maps.domain.length };
  });

  // ADR 计数（工具轨「决策」按钮徽标）
  /** 搜索 Enter：选中并居中首个命中节点 */
  function searchKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter") return;
    const q = graphState.query.trim().toLowerCase();
    if (!q) return;
    const node = graphState.graph?.nodes.find(
      (n) => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q),
    );
    if (node) {
      graphState.selectNode(node);
      graphState.locateNode(node.id);
    }
  }

  /** 全局退出手势：Esc 按 面板 → 对比 → 专注 → 浮层 的优先级逐层退出 */
  function globalKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (graphState.selectedNode || graphState.selectedEdge) {
      graphState.selectNode(null);
      graphState.selectEdge(null);
    } else if (graphState.diff) {
      graphState.clearDiff();
    } else if (graphState.focusMode) {
      graphState.setFocusMode(false);
    } else if (graphState.diffOpen || graphState.lensOpen) {
      if (graphState.diffOpen) graphState.toggleDiff();
      if (graphState.lensOpen) graphState.toggleLens();
    }
  }
</script>

<svelte:window onkeydown={globalKeydown} />

<div class="app" class:focus-mode={focusMode}>
  <!-- ── 排 1：品牌 + 可点状态 chips（计数即图例）── -->
  <header class="header">
    <div class="brand">
      <svg class="logo" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 1.2 13.9 4.6v6.8L8 14.8 2.1 11.4V4.6L8 1.2Z" stroke="currentColor" stroke-width="1.3"/>
        <circle cx="8" cy="8" r="2" fill="currentColor"/>
      </svg>
      <div class="brand-text">
        <span class="title">Super Plumber</span>
        {#if currentName}
          <span class="graph-label" title={graphState.graph?.label ?? ""}>
            {currentName}{graphState.graph?.label ? ` · ${graphState.graph.label}` : ""}
          </span>
        {/if}
      </div>
    </div>

    {#if graphState.graph}
      <div class="status-bar" role="group" aria-label="按状态过滤（计数即图例）">
        <span class="sb-total"><span class="sb-n">{graphState.graph.nodes.length}</span> total</span>
        {#each STATUSES as s (s.key)}
          <button
            class="sb-chip"
            class:zero={(statusCounts.get(s.key) ?? 0) === 0}
            aria-pressed={graphState.statusFilter?.includes(s.key) ?? false}
            onclick={() => graphState.toggleStatus(s.key)}
            title="点击只看 {s.label}"
          >
            <span class="sb-dot" style="background: var(--status-{s.key})"></span>
            <span class="sb-n">{statusCounts.get(s.key) ?? 0}</span>
            <span class="sb-label">{s.label}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="stats">
      <span class="stat">{graphState.graph?.nodes.length ?? 0}<span class="stat-unit">n</span></span>
      <span class="stat-divider">·</span>
      <span class="stat">{graphState.graph?.edges.length ?? 0}<span class="stat-unit">e</span></span>
      {#if connStatus === "offline"}
        <span class="conn-off" title="连接中断，自动重连中">offline</span>
      {/if}
    </div>
  </header>

  <!-- ── 排 2：图 tab + 层级 + 搜索 ── -->
  {#if graphMetas && graphMetas.length > 0}
    <div class="toolbar">
      <div class="graph-tabs" role="tablist" aria-label="图选择（纯审阅，不影响 CLI/MCP 状态）">
        {#each graphMetas as gm (gm.name)}
          <button
            class="graph-tab"
            class:active={gm.name === currentName}
            role="tab"
            aria-selected={gm.name === currentName}
            title={gm.label ? `${gm.name} · ${gm.label}` : gm.name}
            onclick={() => graphState.selectGraph(gm.name)}
          >
            {#if gm.name === graphState.activeName}
              <span class="tab-dot" title="工作区 active"></span>
            {/if}
            <span class="tab-name">{gm.name}</span>
            <span class="tab-count">{graphState.nodeCountOf(gm.name)}</span>
          </button>
        {/each}
      </div>
      <div class="toolbar-right">
        {#if graphState.graph && levelsPresent.length > 0}
          <div class="level-chips" role="group" aria-label="按层级过滤">
            {#each LEVELS.filter((l) => levelsPresent.includes(l)) as l}
              <button
                class="level-chip {graphState.levelFilter?.includes(l) ? 'active' : ''}"
                onclick={() => graphState.toggleLevel(l)}
              >
                L{l}
              </button>
            {/each}
            {#if graphState.levelFilter || graphState.statusFilter}
              <button class="level-chip clear" onclick={() => { graphState.setLevelFilter(null); graphState.clearStatusFilter(); }}>
                清除
              </button>
            {/if}
          </div>
        {/if}
        <input
          class="search-input"
          type="search"
          placeholder="搜索 id / 标签，Enter 定位…"
          value={graphState.query}
          oninput={(e) => graphState.setQuery((e.currentTarget as HTMLInputElement).value)}
          onkeydown={searchKeydown}
          aria-label="搜索节点"
        />
      </div>
    </div>
  {/if}

  <!-- ── 主区：画布 + 工具轨 + 面板 ── -->
  <main class="main">
    {#if connStatus === "connecting" && graphState.graph === null && currentName === null}
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
        <p class="loading-text">正在连接拓扑服务…</p>
      </div>
    {:else if graphState.graph === null && graphState.loadError}
      <div class="error-state" role="alert">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--status-failed)" stroke-width="1.5" aria-hidden="true">
          <path d="M8 32c6-8 12-8 16 0s10 8 16 0"/>
          <path d="M24 12v10M24 27v3"/>
          <circle cx="24" cy="38" r="1.6" fill="var(--status-failed)" stroke="none"/>
        </svg>
        <h3 class="error-title">图「{currentName}」加载失败</h3>
        <p class="error-hint">{graphState.loadError}</p>
        <button class="retry-btn" onclick={() => currentName && graphState.fetchGraph(currentName)}>
          重试
        </button>
      </div>
    {:else if graphMetas !== null && graphMetas.length === 0}
      <div class="empty-state">
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none" stroke="var(--ink-faint)" stroke-width="1.5" aria-hidden="true">
          <circle cx="20" cy="20" r="6"/>
          <circle cx="60" cy="40" r="6"/>
          <circle cx="20" cy="60" r="6"/>
          <path d="M26 20h14M26 60h14M46 40H34" stroke-dasharray="4 3"/>
        </svg>
        <h3 class="empty-title">工作区还没有图</h3>
        <p class="empty-hint">
          运行 <code>graph init &lt;图名&gt;</code> 创建第一张拓扑
        </p>
      </div>
    {:else if graphState.graph === null}
      <div class="loading-state">
        <p class="loading-text">正在加载图「{currentName}」…</p>
      </div>
    {:else if graphState.graph && graphState.graph.nodes.length === 0}
      <div class="empty-state">
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none" stroke="var(--ink-faint)" stroke-width="1.5" aria-hidden="true">
          <circle cx="20" cy="20" r="6"/>
          <circle cx="60" cy="40" r="6"/>
          <circle cx="20" cy="60" r="6"/>
          <path d="M26 20h14M26 60h14M46 40H34" stroke-dasharray="4 3"/>
        </svg>
        <h3 class="empty-title">空拓扑</h3>
        <p class="empty-hint">
          运行 <code>graph create-node</code> 添加第一个节点
        </p>
      </div>
    {:else}
      <GraphCanvas />
      <DiffPanel />
    {/if}

    <!-- ── 统一工具轨（画布存在时；专注模式下隐藏）── -->
    {#if graphState.graph && graphState.graph.nodes.length > 0}
      <nav class="tool-rail" aria-label="画布工具轨">
        <button
          class="rail-btn"
          class:active={graphState.lensOpen}
          onclick={() => graphState.toggleLens()}
          title="map 透镜"
          aria-label="map 透镜"
          aria-expanded={graphState.lensOpen}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <circle cx="6" cy="6" r="4"/>
            <circle cx="10" cy="10" r="4"/>
          </svg>
        </button>
        <button
          class="rail-btn"
          class:active={graphState.diffOpen}
          onclick={() => graphState.toggleDiff()}
          title="版本对比（快照 → 当前工作区）"
          aria-label="版本对比"
          aria-expanded={graphState.diffOpen}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M4 2v12M12 2v12M4 7l3-3 3 3M12 9l-3 3-3-3"/>
          </svg>
        </button>

        <span class="rail-sep" aria-hidden="true"></span>

        <button class="rail-btn" onclick={() => graphState.requestZoom("in")} title="放大" aria-label="放大">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M8 3v10M3 8h10"/>
          </svg>
        </button>
        <button class="rail-btn" onclick={() => graphState.requestZoom("out")} title="缩小" aria-label="缩小">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M3 8h10"/>
          </svg>
        </button>
        <button class="rail-btn" onclick={() => graphState.requestZoom("fit")} title="适配全图" aria-label="适配全图">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>
          </svg>
        </button>
        <button
          class="rail-btn"
          class:active={layoutPinned}
          onclick={() => graphState.setLayoutPinned(!layoutPinned)}
          title="固定布局（停用模拟，大图性能）"
          aria-label="固定布局"
          aria-pressed={layoutPinned}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M5 1h6l-1.2 4.2L12 8H4l2.2-2.8L5 1ZM8 8v7"/>
          </svg>
        </button>

        <span class="rail-sep" aria-hidden="true"></span>

        <button
          class="rail-btn"
          class:active={focusMode}
          onclick={() => graphState.setFocusMode(!focusMode)}
          title="专注模式（隐藏 chrome，挂屏监控）"
          aria-label="专注模式"
          aria-pressed={focusMode}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/>
            <circle cx="8" cy="8" r="2"/>
          </svg>
        </button>
      </nav>

      {#if graphState.lensOpen}
        <aside class="rail-flyout lens-flyout" aria-label="map 透镜选择">
          <span class="flyout-title">map 透镜</span>
          <label class="lens-item" title="任务/检查点/决策/门与调度边">
            <input
              type="checkbox"
              class="lens-checkbox"
              checked={graphState.activeMaps.workflow}
              onchange={() => graphState.toggleMap("workflow")}
            />
            <span class="lens-name">工作流图</span>
            <span class="lens-count">{mapCounts.workflow}</span>
          </label>
          <label class="lens-item" title="context 边界（领域图勾选以星云显示簇壳；单独勾选 = 星体保留、无连线）">
            <input
              type="checkbox"
              class="lens-checkbox"
              checked={graphState.activeMaps.domain}
              onchange={() => graphState.toggleMap("domain")}
            />
            <span class="lens-name">领域图</span>
            <span class="lens-count">{mapCounts.domain}</span>
          </label>
        </aside>
      {/if}
    {/if}

    {#if focusMode}
      <button class="focus-exit" onclick={() => graphState.setFocusMode(false)}>
        退出专注 <span class="focus-kbd">Esc</span>
      </button>
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
    background: var(--bg-chrome);
    color: var(--ink);
    overflow: hidden;
  }

  /* ── 排 1：品牌 + 状态 chips ── */
  .header {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-2) var(--sp-4);
    min-height: 40px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-chrome);
    user-select: none;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--ink-muted);
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .title {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: var(--track-caps);
    color: var(--ink);
    text-transform: uppercase;
    line-height: 1.2;
  }

  .graph-label {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    letter-spacing: 0.02em;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 可点状态 chips：计数即图例，点击即过滤 */
  .status-bar {
    display: flex;
    gap: 2px;
    margin-left: var(--sp-2);
    flex-wrap: wrap;
  }

  .sb-total {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-muted);
    padding: 3px var(--sp-2);
    font-variant-numeric: tabular-nums;
    align-self: center;
  }

  .sb-n {
    color: var(--ink);
    font-weight: 600;
  }

  .sb-total .sb-n {
    margin-right: 3px;
  }

  .sb-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--r);
    padding: 3px var(--sp-2);
    cursor: pointer;
    font-variant-numeric: tabular-nums;
    transition: background 0.13s var(--ease-out-quart), color 0.13s var(--ease-out-quart),
      border-color 0.13s var(--ease-out-quart);
  }

  .sb-chip:hover {
    background: var(--surface-1);
    color: var(--ink);
  }

  .sb-chip[aria-pressed="true"] {
    background: var(--surface-2);
    border-color: var(--line-strong);
    color: var(--ink);
  }

  .sb-chip:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }

  .sb-chip.zero {
    opacity: 0.5;
  }

  .sb-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .sb-label {
    letter-spacing: 0.02em;
  }

  .stats {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
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

  /* ── 排 2：图 tab + 层级 + 搜索 ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-1) var(--sp-4);
    min-height: 34px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-chrome);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .graph-tabs {
    display: flex;
    gap: var(--sp-1);
    flex-wrap: wrap;
    overflow-x: auto;
  }

  .graph-tab {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-muted);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: 3px var(--sp-2);
    cursor: pointer;
    max-width: 220px;
    transition: background 0.13s var(--ease-out-quart), color 0.13s var(--ease-out-quart),
      border-color 0.13s var(--ease-out-quart);
  }

  .graph-tab:hover {
    color: var(--ink);
    border-color: var(--line-strong);
  }

  .graph-tab.active {
    background: var(--surface-2);
    color: var(--ink);
    border-color: var(--line-strong);
    font-weight: 600;
  }

  .tab-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    border: 1.5px solid var(--ink-faint);
    flex-shrink: 0;
  }

  .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-count {
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    background: var(--surface-2);
    border-radius: var(--r-sm);
    padding: 0 var(--sp-1);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .toolbar-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .level-chips {
    display: flex;
    gap: 2px;
  }

  .level-chip {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    padding: 3px var(--sp-2);
    border-radius: var(--r);
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink-muted);
    cursor: pointer;
    letter-spacing: 0.02em;
    transition: background 0.13s var(--ease-out-quart), color 0.13s var(--ease-out-quart),
      border-color 0.13s var(--ease-out-quart);
  }

  .level-chip:hover {
    color: var(--ink);
    border-color: var(--line-strong);
  }

  .level-chip.active {
    background: var(--surface-2);
    color: var(--ink);
    border-color: var(--line-strong);
  }

  .level-chip.clear {
    color: var(--ink-faint);
  }

  .search-input {
    background: var(--surface-1);
    border: 1px solid var(--line);
    border-radius: var(--r);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    padding: 4px var(--sp-2);
    width: 210px;
    outline: none;
    transition: border-color 0.13s var(--ease-out-quart), box-shadow 0.13s var(--ease-out-quart);
  }

  .search-input::placeholder {
    color: var(--ink-faint);
  }

  .search-input:focus {
    border-color: var(--line-strong);
  }

  /* 键盘焦点环 ≥3:1（PRODUCT.md a11y 承诺：2px 白环） */
  .search-input:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }

  /* ── 主区 ── */
  .main {
    flex: 1 1 0%;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  /* ── 统一工具轨 ── */
  .tool-rail {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: var(--rail-w);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--sp-2) 0;
    background: var(--bg-chrome);
    border-right: 1px solid var(--line);
    z-index: var(--z-overlay);
    transition: transform 0.22s var(--ease-out-quint), opacity 0.22s var(--ease-out-quint);
  }

  .rail-btn {
    position: relative;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--r);
    color: var(--ink-muted);
    cursor: pointer;
    transition: background 0.13s var(--ease-out-quart), color 0.13s var(--ease-out-quart),
      border-color 0.13s var(--ease-out-quart);
  }

  .rail-btn:hover {
    background: var(--surface-1);
    color: var(--ink);
  }

  .rail-btn.active {
    background: var(--surface-2);
    border-color: var(--line-strong);
    color: var(--ink);
  }

  .rail-btn:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }


  .rail-sep {
    width: 20px;
    height: 1px;
    background: var(--line);
    margin: var(--sp-1) 0;
    flex-shrink: 0;
  }

  /* 工具轨 flyout（透镜） */
  .rail-flyout {
    position: absolute;
    left: calc(var(--rail-w) + var(--sp-2));
    bottom: var(--sp-3);
    background: var(--surface-1);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    padding: var(--sp-3);
    z-index: var(--z-panel);
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }

  .lens-flyout {
    bottom: auto;
    top: var(--sp-3);
  }

  .flyout-title {
    font-family: var(--font-sans);
    font-size: var(--text-2xs);
    font-weight: 650;
    color: var(--ink-faint);
    padding: 0 var(--sp-1) var(--sp-1);
  }

  .lens-item {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2);
    border-radius: var(--r);
    cursor: pointer;
    transition: background 0.13s var(--ease-out-quart);
    user-select: none;
  }

  .lens-item:hover {
    background: var(--surface-2);
  }

  .lens-checkbox {
    accent-color: var(--ink-muted);
    width: 14px;
    height: 14px;
    cursor: pointer;
    flex-shrink: 0;
    margin: 0;
  }

  .lens-name {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--ink);
    flex: 1;
  }

  .lens-count {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    background: var(--surface-2);
    border-radius: var(--r-sm);
    padding: 1px var(--sp-1);
    font-variant-numeric: tabular-nums;
  }

  /* ── 专注模式：chrome 退场，画布即一切 ── */
  .focus-mode .header,
  .focus-mode .toolbar {
    display: none;
  }

  .focus-mode .tool-rail {
    transform: translateX(-100%);
    opacity: 0;
    pointer-events: none;
  }

  /* 工具轨的浮层面板一并退场（跨组件：global 穿透） */
  .focus-mode :global(.rail-flyout),
  .focus-mode :global(.diff-panel) {
    display: none;
  }

  .focus-exit {
    position: absolute;
    right: var(--sp-3);
    bottom: var(--sp-3);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    background: var(--surface-1);
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--ink-muted);
    font-family: var(--font-sans);
    font-size: var(--text-2xs);
    padding: var(--sp-2) var(--sp-3);
    cursor: pointer;
    z-index: var(--z-overlay);
    transition: color 0.13s var(--ease-out-quart), border-color 0.13s var(--ease-out-quart);
  }

  .focus-exit:hover {
    color: var(--ink);
    border-color: var(--ink-faint);
  }

  .focus-kbd {
    font-family: var(--font-mono);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 0 4px;
    color: var(--ink-faint);
  }

  /* ── 加载 / 空态 / 错误态 ── */
  .loading-state,
  .empty-state,
  .error-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-3);
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
    background: var(--surface-2);
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
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    margin: 0;
  }

  .error-title {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 650;
    color: var(--ink);
    margin: 0;
  }

  .error-hint {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--ink-faint);
    margin: 0;
    max-width: 44ch;
    text-align: center;
    line-height: 1.6;
  }

  .retry-btn {
    background: var(--interactive);
    color: #000000;
    border: none;
    border-radius: var(--r);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
    padding: var(--sp-2) var(--sp-4);
    cursor: pointer;
    transition: opacity 0.13s var(--ease-out-quart);
  }

  .retry-btn:hover {
    opacity: 0.88;
  }

  .empty-title {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 650;
    margin: var(--sp-2) 0 0;
    color: var(--ink-muted);
  }

  .empty-hint {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    margin: 0;
    color: var(--ink-faint);
  }

  .empty-hint code {
    background: var(--surface-1);
    padding: 2px 6px;
    border-radius: var(--r-sm);
    color: var(--ink-muted);
    font-family: var(--font-mono);
  }

  /* ── 动效 ── */
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 0.6; transform: translateY(0); }
  }

  /* ── Reduced motion ── */
  @media (prefers-reduced-motion: reduce) {
    .sb-chip, .rail-btn, .tool-rail { transition: none; }
    .skeleton-node, .skeleton-edge { animation: none; opacity: 0.5; }
  }

  /* ── Responsive：工具轨转底部横条 ── */
  @media (max-width: 768px) {
    .header {
      padding: var(--sp-2) var(--sp-3);
      gap: var(--sp-2);
    }
    .stats { display: none; }
    .title { font-size: var(--text-2xs); }
    .search-input { width: 130px; }

    .tool-rail {
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      width: auto;
      height: 52px;
      flex-direction: row;
      padding: 0 var(--sp-2);
      border-right: none;
      border-top: 1px solid var(--line);
    }
    .rail-btn { width: var(--tap); height: var(--tap); }
    .rail-sep { width: 1px; height: 20px; margin: 0 var(--sp-1); }
    .rail-flyout {
      left: var(--sp-2);
      bottom: calc(52px + var(--sp-2));
      top: auto;
    }
    .lens-flyout { top: auto; }
    .focus-exit { bottom: calc(52px + var(--sp-2)); }
  }
</style>
