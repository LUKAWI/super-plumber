<script lang="ts">
  // 左下角 ADR 座：当前图全部 ADR 以菱形芯片堆叠锚定在画布左下角。
  // 本组件是画布容器的 HTML 图层（不在 SVG zoomGroup 内）——平移/缩放/力导向
  // 都不影响它；ADR 顶点本就不进模拟（GraphCanvas 渲染前已过滤），这里是
  // 它们在图上的唯一常驻形态，点击进决策文档抽屉（AdrDocument）。
  import { graphState } from "../lib/store.svelte";
  import { ADR_STATUS_META, adrDockItems, type AdrDockItem } from "../lib/maps";
  import { statusColorOf } from "../lib/types";

  let collapsed = $state(false);

  const items = $derived.by(() => {
    const g = graphState.graph;
    return g ? adrDockItems(g.nodes, g.edges) : [];
  });

  function open(item: AdrDockItem): void {
    const g = graphState.graph;
    if (!g) return;
    const full = g.nodes.find((n) => n.id === item.id);
    if (full) graphState.selectNode(full);
  }

  function summaryOf(item: AdrDockItem): string {
    const meta = ADR_STATUS_META[item.status];
    const gov = item.governs.length > 0 ? ` · governs ${item.governs.length}` : " · 孤儿决策";
    return `${meta.mark} ${meta.en}（${meta.zh}）${gov}`;
  }
</script>

{#if items.length > 0}
  <div class="adr-dock" aria-label="ADR 决策目录">
    <button
      class="dock-toggle"
      onclick={() => (collapsed = !collapsed)}
      title={collapsed ? "展开 ADR 列表" : "折叠"}
    >
      <span class="toggle-mark">⚖</span>
      <span class="toggle-count">{items.length}</span>
    </button>
    {#if !collapsed}
      <div class="dock-stack">
        {#each items as item (item.id)}
          <button
            class="adr-chip st-{item.status}"
            class:active={graphState.selectedNode?.id === item.id}
            style="--adr-color: {statusColorOf(item.status)}"
            onclick={() => open(item)}
            title={summaryOf(item)}
          >
            <svg class="diamond" width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
              <path d={item.status === "superseded" ? "M0,-7 L7,0 L0,7 L-7,0 Z M-5,-5 L5,5" : "M0,-7 L7,0 L0,7 L-7,0 Z"} />
            </svg>
            <span class="chip-body">
              <span class="chip-top">
                <span class="chip-id">{item.id}</span>
                <span class="chip-status">{ADR_STATUS_META[item.status].mark} {item.status}</span>
              </span>
              <span class="chip-title" class:strike={item.status === "superseded"}>{item.label}</span>
              {#if item.status === "superseded" && item.supersededBy}
                <span class="chip-superseded">→ {item.supersededBy}</span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .adr-dock {
    position: absolute;
    left: var(--sp-3);
    bottom: var(--sp-3);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    z-index: var(--z-tooltip, 30);
    max-width: 240px;
  }

  .dock-toggle {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--ink-muted);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: calc(var(--sp-1) + 1px) var(--sp-2);
    cursor: pointer;
    letter-spacing: var(--track-caps);
    transition: color 0.15s var(--ease-out-quart), border-color 0.15s var(--ease-out-quart);
  }

  .dock-toggle:hover {
    color: var(--ink);
    border-color: var(--ink-faint);
  }

  .dock-stack {
    display: flex;
    flex-direction: column-reverse; /* 编号小的贴底部，新决策往上长 */
    gap: var(--sp-2);
    max-height: min(46vh, 380px);
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
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-left: 3px solid var(--adr-color);
    border-radius: var(--r-sm);
    padding: var(--sp-2);
    cursor: pointer;
    transition: border-color 0.15s var(--ease-out-quart), background 0.15s var(--ease-out-quart);
  }

  /* proposed 沿用叠加视图徽章的虚线语义：待裁决 = 未定案 */
  .adr-chip.st-proposed {
    border-style: dashed;
    border-left-style: solid;
  }

  .adr-chip:hover {
    background: var(--surface-3, rgba(255, 255, 255, 0.06));
  }

  .adr-chip.active {
    outline: 1.5px solid var(--adr-color);
    outline-offset: 1px;
    background: var(--surface-3, rgba(255, 255, 255, 0.08));
  }

  .diamond {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .diamond path {
    fill: transparent;
    stroke: var(--adr-color);
    stroke-width: 1.5;
    stroke-linecap: round;
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
    color: var(--adr-color);
    letter-spacing: var(--track-label);
  }

  .chip-status {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    color: var(--adr-color);
    white-space: nowrap;
  }

  .chip-title {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--ink-muted);
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .chip-title.strike {
    text-decoration: line-through;
    color: var(--ink-faint);
  }

  .chip-superseded {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--ink-faint);
  }
</style>
