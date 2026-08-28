<script lang="ts">
  // ADR 决策目录：工具轨「决策」按钮的 flyout。ADR 顶点不进力导向模拟
  // （GraphCanvas 渲染前已过滤），这里是它们在图上的常驻目录形态，
  // 点击进决策文档抽屉（AdrDocument）。
  // v0.7：废除 3px 彩色左边条（craft-floor 禁令）——状态由 SVG 状态符号 +
  // 线型语义表达（proposed 虚线 / superseded 划题 + 接替链）。
  import { graphState } from "../lib/store.svelte";
  import { ADR_STATUS_META, adrDockItems, type AdrDockItem } from "../lib/maps";

  const items = $derived.by(() => {
    const g = graphState.graph;
    return g ? adrDockItems(g.nodes, g.edges) : [];
  });

  // 栈内折叠：只收芯片堆，目录头保留（工具轨按钮负责整体开关）
  let collapsed = $state(false);

  function open(item: AdrDockItem): void {
    const g = graphState.graph;
    if (!g) return;
    const full = g.nodes.find((n) => n.id === item.id);
    if (full) graphState.selectNode(full);
  }

  function summaryOf(item: AdrDockItem): string {
    const meta = ADR_STATUS_META[item.status];
    const gov = item.governs.length > 0 ? ` · governs ${item.governs.length}` : " · 孤儿决策";
    return `${meta.en}（${meta.zh}）${gov}`;
  }

  /** 三态符号路径（统一描边 SVG，废除 ⊘○● Unicode）：proposed 虚线圆 / accepted 实心圆 / superseded 圆+斜线 */
  function statusGlyph(status: AdrDockItem["status"]): { d: string; dash: string | null } {
    if (status === "accepted") return { d: "M8 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10ZM5.6 8.2 7.4 10l3-3.8", dash: null };
    if (status === "superseded") return { d: "M8 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10ZM4.8 11.2 11.2 4.8", dash: null };
    return { d: "M8 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z", dash: "2.4 2" };
  }
</script>

{#if graphState.adrDockOpen && items.length > 0}
  <div class="adr-dock" aria-label="ADR 决策目录">
    <div class="dock-header">
      <span class="dock-title">决策目录</span>
      <span class="dock-count">{items.length}</span>
      <button
        class="dock-toggle"
        onclick={() => (collapsed = !collapsed)}
        title={collapsed ? "展开决策列表" : "折叠决策列表"}
        aria-label={collapsed ? "展开决策列表" : "折叠决策列表"}
        aria-expanded={!collapsed}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class:flip={collapsed}>
          <path d="M2.5 5l4.5 4.5L11.5 5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
    {#if !collapsed}
    <div class="dock-stack">
      {#each items as item (item.id)}
        <button
          class="adr-chip st-{item.status}"
          class:active={graphState.selectedNode?.id === item.id}
          onclick={() => open(item)}
          title={summaryOf(item)}
        >
          <svg class="diamond" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={item.status === "superseded" ? "var(--status-failed)" : item.status === "accepted" ? "var(--status-passed)" : "var(--status-pending)"} stroke-width="1.4" aria-hidden="true">
            {#if item.status === "accepted"}
              <path d={statusGlyph(item.status).d} stroke-linecap="round" stroke-linejoin="round"/>
            {:else}
              <path d={statusGlyph(item.status).d} stroke-linecap="round" stroke-dasharray={statusGlyph(item.status).dash ?? undefined}/>
            {/if}
          </svg>
          <span class="chip-body">
            <span class="chip-top">
              <span class="chip-id">{item.id}</span>
              <span class="chip-status">{item.status}</span>
            </span>
            <span class="chip-title" class:strike={item.status === "superseded"}>{item.label}</span>
            {#if item.status === "superseded" && item.supersededBy}
              <span class="chip-superseded">→ 被 {item.supersededBy} 接替</span>
            {/if}
          </span>
        </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* 工具轨「决策」flyout：贴轨右侧，不再锚定画布左下角（与透镜面板互斥由 store 保证） */
  .adr-dock {
    position: absolute;
    left: calc(var(--rail-w) + var(--sp-2));
    bottom: var(--sp-3);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    z-index: var(--z-panel);
    width: 300px;
    background: var(--surface-1);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    padding: var(--sp-2);
  }

  .dock-header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-1) var(--sp-2) 0;
  }

  .dock-title {
    font-family: var(--font-sans);
    font-size: var(--text-2xs);
    font-weight: 650;
    color: var(--ink-faint);
    flex: 1;
  }

  .dock-count {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }

  .dock-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: var(--r);
    color: var(--ink-muted);
    cursor: pointer;
    transition: background 0.13s var(--ease-out-quart), color 0.13s var(--ease-out-quart);
  }

  .dock-toggle:hover {
    background: var(--surface-2);
    color: var(--ink);
  }

  .dock-stack {
    display: flex;
    flex-direction: column; /* 编号小的在上，目录阅读序 */
    gap: var(--sp-1);
    max-height: min(52vh, 420px);
    overflow-y: auto;
    padding: 2px;
    scrollbar-width: thin;
  }

  .adr-chip {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: var(--sp-2) var(--sp-3);
    cursor: pointer;
    transition: border-color 0.13s var(--ease-out-quart), background 0.13s var(--ease-out-quart);
  }

  /* proposed 沿用叠加视图徽章的虚线语义：待裁决 = 未定案 */
  .adr-chip.st-proposed {
    border-style: dashed;
  }

  .adr-chip:hover {
    background: var(--surface-2);
    border-color: var(--line-strong);
  }

  /* 选中高亮 = 交互白（不再借用状态色） */
  .adr-chip.active {
    outline: 1.5px solid var(--interactive);
    outline-offset: 1px;
    background: var(--surface-2);
  }

  .adr-chip:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }

  .diamond {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .dock-toggle :global(svg.flip) {
    transform: rotate(180deg);
  }

  .chip-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .chip-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
  }

  .chip-id {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--ink);
    letter-spacing: 0.02em;
  }

  .chip-status {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    white-space: nowrap;
    text-transform: lowercase;
  }

  .chip-title {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--ink-muted);
    line-height: 1.45;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .chip-title.strike {
    text-decoration: line-through;
    text-decoration-color: var(--ink-faint);
    color: var(--ink-faint);
  }

  .chip-superseded {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
  }

  @media (max-width: 768px) {
    .adr-dock {
      left: var(--sp-2);
      right: var(--sp-2);
      width: auto;
      bottom: calc(52px + var(--sp-2));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .adr-chip, .dock-toggle { transition: none; }
  }
</style>
