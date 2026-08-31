<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import GraphCanvas from "./components/GraphCanvas.svelte";
  import NodeDetail from "./components/NodeDetail.svelte";
  import EdgeDetail from "./components/EdgeDetail.svelte";
  import DiffPanel from "./components/DiffPanel.svelte";
  import { createGraphConnection } from "./lib/api";
  import { graphState } from "./lib/store.svelte";
  import { deriveMaps } from "./lib/maps";
  import { frontierNodes } from "./lib/frontier";
  import { isKnowledgeType, statusColorOf, type NodeStatus } from "./lib/types";

  let disconnect: (() => void) | null = null;
  let connStatus = $state<"connecting" | "connected" | "offline">("connecting");
  let mainEl: HTMLElement | null = null;

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


  // map 透镜计数（工具轨透镜 flyout 展示每个 map 的可见规模）：
  // 领域图只数 context 顶点——adr 顶点自徽章层退役后不渲染任何形体，不计数
  const mapCounts = $derived.by(() => {
    const g = graphState.graph;
    if (!g) return { workflow: 0, domain: 0 };
    const maps = deriveMaps(g.nodes);
    return {
      workflow: maps.workflow.length,
      domain: maps.domain.filter((n) => n.type === "context").length,
    };
  });

  // ADR 计数（dock「决策文档」按钮徽标）
  const adrList = $derived((graphState.graph?.nodes ?? []).filter((n) => n.type === "adr"));
  const adrCount = $derived(adrList.length);

  // ── 所见即所计（2026-08-28 评审）：chrome 计数一律工作流口径。
  // 知识顶点（context/adr）不渲染星体、ADR 入口已退役，decides 边不画线——
  // 它们进总数只会造成"数出来的和看到的不一样"。context 无工作流生命周期，
  // schema 缺省的 pending 是假状态，一并从统计中剔除。──
  const workflowNodes = $derived(
    (graphState.graph?.nodes ?? []).filter((n) => !isKnowledgeType(n.type)),
  );

  // 前沿（frontier）计数：ready + ready_eligible 两桶合并（ctx-webui 术语——
  // 「现在就能干的活」；前端由既有图数据派生，不是新调度桶）
  const frontierCount = $derived(
    graphState.graph ? frontierNodes(graphState.graph).length : 0,
  );
  const visibleEdgeCount = $derived(
    (graphState.graph?.edges ?? []).filter((e) => e.type !== "decides").length,
  );
  const statusCounts = $derived.by(() => {
    const counts = new Map<NodeStatus, number>();
    for (const s of STATUSES) counts.set(s.key, 0);
    for (const n of workflowNodes) {
      const k = n.status as NodeStatus;
      if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
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

  /** Tab 分组循环（2026-08-28 用户反馈）：焦点在 dock（含其打开的弹层）内时，
   *  Tab 只在 dock 按钮与弹层项之间循环，不再落到顶栏/画布/浏览器 UI；Shift+Tab 逆序。 */
  function dockKeydown(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    const inDock = !!active.closest(".tool-rail");
    const inFlyout = !!active.closest(".rail-flyout");
    if (!inDock && !inFlyout) return; // 焦点不在 dock 组：走原生
    e.preventDefault();
    const group = [
      ...Array.from(mainEl?.querySelectorAll<HTMLElement>(".tool-rail .rail-btn") ?? []),
      ...Array.from(
        mainEl?.querySelectorAll<HTMLElement>(".rail-flyout button, .rail-flyout input") ?? [],
      ),
    ];
    if (group.length === 0) return;
    const idx = group.indexOf(active);
    const next = group[(idx + (e.shiftKey ? -1 : 1) + group.length) % group.length];
    next?.focus();
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
    } else if (graphState.diffOpen || graphState.lensOpen || graphState.graphsOpen || graphState.adrOpen) {
      if (graphState.diffOpen) graphState.toggleDiff();
      if (graphState.lensOpen) graphState.toggleLens();
      if (graphState.graphsOpen) graphState.toggleGraphs();
      if (graphState.adrOpen) graphState.toggleAdr();
    }
  }
</script>

<svelte:window onkeydown={globalKeydown} />

<div class="app" class:focus-mode={focusMode}>
  <!-- ── 仪器条（单排）：品牌 + 图 tabs + 状态过滤 + 层级 + 搜索 + 统计 ── -->
  <header class="topbar">
    <div class="brand">
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
        <span class="sb-total"><span class="sb-n">{workflowNodes.length}</span> total</span>
        <button
          class="sb-chip frontier-chip"
          aria-pressed={graphState.frontierOnly}
          onclick={() => graphState.toggleFrontier()}
          title="前沿（frontier）：ready + 门禁已满足的 pending——「现在就能干的活」，一键只看前沿"
        >
          <svg class="frontier-star" width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
            <path d="M5 0 6.2 3.8 10 5 6.2 6.2 5 10 3.8 6.2 0 5 3.8 3.8Z"/>
          </svg>
          <span class="sb-n">{frontierCount}</span>
          <span class="sb-label">前沿</span>
        </button>
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
        {#if graphState.statusFilter || graphState.levelFilter || graphState.frontierOnly}
          <button
            class="sb-clear"
            onclick={() => { graphState.setLevelFilter(null); graphState.clearStatusFilter(); graphState.setFrontierOnly(false); }}
            title="清除全部过滤"
          >清除</button>
        {/if}
      </div>
    {/if}

    <div class="topbar-right">
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
        </div>
      {/if}
      <div class="search-box">
        <svg class="search-icon" width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="6" cy="6" r="4.2"/>
          <path d="M9.2 9.2 12.5 12.5" stroke-linecap="round"/>
        </svg>
        <input
          class="search-input"
          type="search"
          placeholder="搜索节点…"
          autocomplete="off"
          value={graphState.query}
          oninput={(e) => graphState.setQuery((e.currentTarget as HTMLInputElement).value)}
          onkeydown={searchKeydown}
          aria-label="搜索节点"
        />
      </div>
      <div class="stats">
        <span class="stat">{workflowNodes.length}<span class="stat-unit">n</span></span>
        <span class="stat-divider">·</span>
        <span class="stat">{visibleEdgeCount}<span class="stat-unit">e</span></span>
        {#if connStatus === "offline"}
          <span class="conn-off" title="连接中断，自动重连中">offline</span>
        {/if}
      </div>
    </div>
  </header>

    <!-- ── 主区：画布 + 工具轨 + 面板 ── -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <main class="main" bind:this={mainEl} onkeydown={dockKeydown}>
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

    <!-- ── 浮动玻璃 dock（画布存在时；专注模式下隐藏）── -->
    {#if graphState.graph && graphState.graph.nodes.length > 0}
      <nav class="tool-rail" aria-label="画布工具轨">
        <button
          class="rail-btn"
          class:active={graphState.graphsOpen}
          onclick={() => graphState.toggleGraphs()}
          title="图库（切换查看的图）"
          aria-label="图库"
          aria-expanded={graphState.graphsOpen}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M2 5.5 8 2.5l6 3-6 3-6-3Z"/>
            <path d="M2 8.5 8 11.5l6-3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 11.5 8 14.5l6-3" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>
          </svg>
          {#if graphMetas && graphMetas.length > 1}
            <span class="rail-badge">{graphMetas.length}</span>
          {/if}
        </button>
        <button
          class="rail-btn"
          class:active={graphState.adrOpen}
          onclick={() => graphState.toggleAdr()}
          title="决策文档（ADR 目录）"
          aria-label="决策文档"
          aria-expanded={graphState.adrOpen}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M4 1.5h5.5L12 4v10.5H4V1.5Z" stroke-linejoin="round"/>
            <path d="M6 7.5h4M6 10h4M6 12.5h2.5" stroke-linecap="round"/>
          </svg>
          {#if adrCount > 0}
            <span class="rail-badge">{adrCount}</span>
          {/if}
        </button>
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

      {#if graphState.adrOpen && adrList.length > 0}
        <aside class="rail-flyout adr-flyout" aria-label="决策文档目录（ADR）">
          <span class="flyout-title">决策文档</span>
          {#each adrList as adr (adr.id)}
            <button
              class="adr-item"
              class:active={graphState.selectedNode?.id === adr.id}
              onclick={() => graphState.selectNode(adr)}
              title={adr.label ?? adr.id}
            >
              <span class="adr-item-dot" style="background: {statusColorOf(adr.status)}"></span>
              <span class="adr-item-body">
                <span class="adr-item-name" class:superseded={adr.status === "superseded"}>{adr.label ?? adr.id}</span>
                <span class="adr-item-id">
                  {adr.id} · {adr.status}{adr.status === "superseded" && adr.superseded_by ? ` → ${adr.superseded_by}` : ""}
                </span>
              </span>
            </button>
          {/each}
        </aside>
      {/if}

      {#if graphState.graphsOpen && graphMetas && graphMetas.length > 0}
        <aside class="rail-flyout graphs-flyout" aria-label="图库（切换查看的图）">
          <span class="flyout-title">图库</span>
          {#each graphMetas as gm (gm.name)}
            <button
              class="graph-item"
              class:active={gm.name === currentName}
              onclick={() => graphState.selectGraph(gm.name)}
              title={gm.label ?? gm.name}
            >
              <span class="graph-item-dot" class:on={gm.name === graphState.activeName} title={gm.name === graphState.activeName ? "工作区 active" : ""}></span>
              <span class="graph-item-body">
                <span class="graph-item-name">{gm.name}</span>
                {#if gm.label}
                  <span class="graph-item-label">{gm.label}</span>
                {/if}
              </span>
              {#if graphState.isLoaded(gm.name)}
                <span class="graph-item-count">{graphState.nodeCountOf(gm.name)}</span>
              {/if}
            </button>
          {/each}
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

  /* ── 仪器条（单排 48px）：任何宽度不叠两栏；拥挤时过滤组横向滚动 ── */
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: 0 var(--sp-4);
    height: 48px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--line);
    box-shadow: inset 0 1px 0 var(--hi-line);
    background: var(--bg-chrome);
    user-select: none;
    white-space: nowrap;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--ink-muted);
    flex-shrink: 0;
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .title {
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -0.01em;
    color: var(--ink);
    line-height: 1.2;
  }

  .graph-label {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    letter-spacing: 0.02em;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 可点状态 chips：分段容器（计数即图例，点击即过滤）；拥挤时整组横向滚动 */
  .status-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: var(--wash-1);
    border-radius: 11px;
    overflow-x: auto;
    scrollbar-width: none;
    min-width: 0;
    flex-shrink: 1;
  }

  .status-bar::-webkit-scrollbar {
    display: none;
  }

  .sb-total {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-muted);
    padding: 3px var(--sp-2);
    font-variant-numeric: tabular-nums;
    align-self: center;
    flex-shrink: 0;
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
    border: none;
    border-radius: 999px;
    padding: 3px 9px;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    transition: background 0.13s var(--ease-out-quart), color 0.13s var(--ease-out-quart);
  }

  .sb-chip:hover {
    background: var(--wash-2);
    color: var(--ink);
  }

  .sb-chip[aria-pressed="true"] {
    background: var(--wash-3);
    color: var(--ink);
  }

  .sb-chip:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }

  .sb-chip.zero {
    opacity: 0.45;
  }

  /* 前沿 chip（frontier 一键档）：星形图标即视觉锚，激活时 ready 蓝收边 */
  .frontier-chip .frontier-star {
    color: var(--ink-faint);
    transition: color 0.13s var(--ease-out-quart);
    flex-shrink: 0;
  }

  .frontier-chip:hover .frontier-star {
    color: var(--ink-muted);
  }

  .frontier-chip[aria-pressed="true"] {
    box-shadow: inset 0 0 0 1px var(--status-ready);
  }

  .frontier-chip[aria-pressed="true"] .frontier-star {
    color: var(--status-ready);
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

  .sb-clear {
    font-family: var(--font-sans);
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--ink);
    background: var(--wash-3);
    border: none;
    border-radius: 999px;
    padding: 3px 10px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.13s var(--ease-out-quart);
  }

  .sb-clear:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  .sb-clear:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }

  .topbar-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex-shrink: 0;
  }

  .level-chips {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: var(--wash-1);
    border-radius: 11px;
  }

  .level-chip {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    padding: 3px 9px;
    border-radius: 999px;
    border: none;
    background: transparent;
    color: var(--ink-muted);
    cursor: pointer;
    letter-spacing: 0.02em;
    transition: background 0.13s var(--ease-out-quart), color 0.13s var(--ease-out-quart);
  }

  .level-chip:hover {
    color: var(--ink);
    background: var(--wash-2);
  }

  .level-chip.active {
    background: var(--wash-3);
    color: var(--ink);
  }

  .stats {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding-left: var(--sp-2);
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
    border-radius: 999px;
    padding: 1px var(--sp-2);
  }

  /* 搜索：图标内嵌的胶囊输入 */
  .search-box {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 10px;
    color: var(--ink-faint);
    pointer-events: none;
  }

  .search-input {
    background: var(--wash-1);
    border: 1px solid var(--line);
    border-radius: var(--r);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    padding: 5px var(--sp-2) 5px 28px;
    width: 210px;
    outline: none;
    transition: border-color 0.13s var(--ease-out-quart), background 0.13s var(--ease-out-quart);
  }

  .search-input::placeholder {
    color: var(--ink-faint);
  }

  .search-input:hover {
    border-color: var(--line-strong);
  }

  .search-input:focus {
    background: var(--wash-2);
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

  /* ── 浮动玻璃 dock（左缘，垂直居中）── */
  .tool-rail {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    width: var(--rail-w);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 0;
    background: var(--glass);
    -webkit-backdrop-filter: var(--blur-panel);
    backdrop-filter: var(--blur-panel);
    border: 1px solid var(--glass-line, var(--line));
    border-radius: 16px;
    box-shadow: var(--shadow-float), inset 0 1px 0 var(--hi-line);
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
    border: none;
    border-radius: var(--r);
    color: var(--ink-muted);
    cursor: pointer;
    transition: background 0.13s var(--ease-out-quart), color 0.13s var(--ease-out-quart);
  }

  .rail-btn:hover {
    background: var(--wash-2);
    color: var(--ink);
  }

  .rail-btn.active {
    background: var(--wash-3);
    color: var(--ink);
  }

  .rail-btn:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }

  /* dock 按钮角标（图库数量） */
  .rail-badge {
    position: absolute;
    top: 3px;
    right: 3px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 999px;
    background: var(--wash-3);
    border: 1px solid var(--line-strong);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    line-height: 12px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  /* 图库弹层：dock 选图器的折叠栏（低频操作不占顶栏） */
  .graphs-flyout {
    min-width: 260px;
    max-height: 60vh;
    overflow-y: auto;
    gap: var(--sp-1);
  }

  /* 决策文档弹层（ADR 目录） */
  .adr-flyout {
    min-width: 280px;
    max-width: 340px;
    max-height: 60vh;
    overflow-y: auto;
    gap: var(--sp-1);
  }

  .adr-item {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-2);
    border: none;
    background: transparent;
    border-radius: var(--r);
    cursor: pointer;
    text-align: left;
    transition: background 0.13s var(--ease-out-quart);
  }

  .adr-item:hover {
    background: var(--wash-2);
  }

  .adr-item.active {
    background: var(--wash-3);
  }

  .adr-item:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }

  .adr-item-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
  }

  .adr-item-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .adr-item-name {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .adr-item-name.superseded {
    text-decoration: line-through;
    color: var(--ink-faint);
    font-weight: 500;
  }

  .adr-item-id {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    letter-spacing: 0.02em;
  }

  .graph-item {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-2);
    border: none;
    background: transparent;
    border-radius: var(--r);
    cursor: pointer;
    text-align: left;
    transition: background 0.13s var(--ease-out-quart);
  }

  .graph-item:hover {
    background: var(--wash-2);
  }

  .graph-item.active {
    background: var(--wash-3);
  }

  .graph-item:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }

  .graph-item-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px solid var(--ink-faint);
    flex-shrink: 0;
  }

  .graph-item-dot.on {
    background: var(--ink);
    border-color: var(--ink);
  }

  .graph-item-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .graph-item-name {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .graph-item-label {
    font-family: var(--font-sans);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .graph-item-count {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    background: var(--wash-2);
    border-radius: 999px;
    padding: 1px 8px;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }


  .rail-sep {
    width: 18px;
    height: 1px;
    background: var(--line);
    margin: var(--sp-1) 0;
    flex-shrink: 0;
  }

  /* dock 旁的玻璃浮层（透镜） */
  .rail-flyout {
    position: absolute;
    left: calc(var(--rail-w) + 20px);
    top: 50%;
    transform: translateY(-50%);
    background: var(--glass-strong);
    -webkit-backdrop-filter: var(--blur-panel);
    backdrop-filter: var(--blur-panel);
    border: 1px solid var(--glass-line, var(--line));
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-float), inset 0 1px 0 var(--hi-line);
    padding: var(--sp-3);
    z-index: var(--z-panel);
    min-width: 210px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
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
    background: var(--wash-2);
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
    background: var(--wash-2);
    border-radius: 999px;
    padding: 1px 8px;
    font-variant-numeric: tabular-nums;
  }

  /* ── 专注模式：chrome 退场，画布即一切 ── */
  .focus-mode .topbar {
    display: none;
  }

  .focus-mode .tool-rail {
    transform: translate(-80px, -50%);
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
    right: var(--sp-4);
    bottom: var(--sp-4);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    background: var(--glass-strong);
    -webkit-backdrop-filter: var(--blur-panel);
    backdrop-filter: var(--blur-panel);
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    box-shadow: var(--shadow-float);
    color: var(--ink-muted);
    font-family: var(--font-sans);
    font-size: var(--text-2xs);
    padding: var(--sp-2) var(--sp-3);
    cursor: pointer;
    /* 面板档：详情抽屉若残留也不得盖住唯一出口（评审 F3） */
    z-index: var(--z-panel);
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
    .sb-chip, .rail-btn, .tool-rail, .rail-flyout { transition: none; }
    .skeleton-node, .skeleton-edge { animation: none; opacity: 0.5; }
  }

  /* ── Responsive：单排仪器条收紧（仍不叠两栏，过滤组横向滚动）── */
  @media (max-width: 768px) {
    .topbar {
      padding: 0 var(--sp-3);
      gap: var(--sp-2);
    }
    .stats { display: none; }
    .graph-label { display: none; }
    .search-input { width: 130px; }

    .tool-rail {
      top: auto;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      width: auto;
      height: 56px;
      flex-direction: row;
      padding: 0 8px;
      border-radius: 18px;
    }
    .focus-mode .tool-rail {
      transform: translate(-50%, 90px);
    }
    .rail-btn { width: var(--tap); height: var(--tap); }
    .rail-sep { width: 1px; height: 20px; margin: 0 var(--sp-1); }
    .rail-flyout {
      left: var(--sp-2);
      right: var(--sp-2);
      top: auto;
      bottom: calc(56px + 20px);
      transform: none;
    }
    .focus-exit { bottom: calc(56px + 20px); }
  }
</style>
