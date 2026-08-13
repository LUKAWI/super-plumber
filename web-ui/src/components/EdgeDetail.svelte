<script lang="ts">
  import { graphState } from "../lib/store.svelte";
  import { EDGE_TYPE_COLORS, EDGE_TYPE_LABELS, type EdgeType } from "../lib/types";

  let visible = $state(false);
  let prevId: string | undefined;

  $effect(() => {
    const edge = graphState.selectedEdge;
    if (edge) {
      if (edge.id !== prevId) {
        visible = false;
        requestAnimationFrame(() => { visible = true; });
        prevId = edge.id;
      }
    } else {
      visible = false;
      prevId = undefined;
    }
  });

  const EDGE_SEMANTICS: Record<EdgeType, string> = {
    depends_on: "顺序依赖：B 依赖 A 完成（参与拓扑排序）",
    validates: "验证关系：A 的输出由 B 验证（参与拓扑排序）",
    shares_context: "A 的输出作为 B 的输入上下文",
    fan_out: "A 完成后多个下游可并行",
    fan_in: "多个上游都完成后才可执行（参与 ready 门禁）",
    fallback: "B 失败时回退到 A 重试",
    iterates: "A ⇄ B 反复迭代优化",
  };
</script>

{#if graphState.selectedEdge}
  <div class="detail-panel edge-panel" class:visible>
    <div class="panel-header">
      <span class="panel-title">EDGE DETAIL</span>
      <button class="close-btn" onclick={() => graphState.selectEdge(null)} aria-label="关闭">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 3l8 8M11 3l-8 8"/>
        </svg>
      </button>
    </div>

    <div class="panel-body">
      <h2 class="edge-label-title">{graphState.selectedEdge.id}</h2>

      <div class="meta-grid">
        <span class="meta-tag id-tag">
          <span class="edge-dot" style="background: {EDGE_TYPE_COLORS[graphState.selectedEdge.type]}"></span>
          {graphState.selectedEdge.type}
        </span>
      </div>

      <section class="section">
        <h3 class="section-title"><span class="section-icon">▸</span>SEMANTICS</h3>
        <p class="plan-desc">{EDGE_SEMANTICS[graphState.selectedEdge.type]}</p>
      </section>

      <section class="section">
        <h3 class="section-title"><span class="section-icon">▸</span>ENDPOINTS</h3>
        <div class="endpoint-row">
          <span class="endpoint-label">source</span>
          <button class="endpoint-link" onclick={() => {
            const n = graphState.graph?.nodes.find((x) => x.id === graphState.selectedEdge!.source);
            graphState.selectEdge(null);
            if (n) graphState.selectNode(n);
          }}>
            {graphState.selectedEdge.source}
          </button>
        </div>
        <div class="endpoint-row">
          <span class="endpoint-label">target</span>
          <button class="endpoint-link" onclick={() => {
            const n = graphState.graph?.nodes.find((x) => x.id === graphState.selectedEdge!.target);
            graphState.selectEdge(null);
            if (n) graphState.selectNode(n);
          }}>
            {graphState.selectedEdge.target}
          </button>
        </div>
      </section>

      {#if graphState.selectedEdge.contract}
        <section class="section">
          <h3 class="section-title"><span class="section-icon">▸</span>CONTRACT</h3>
          {#if graphState.selectedEdge.contract.produces}
            <div class="sub-list">
              <span class="sub-label">produces:</span>
              <span class="chip">{graphState.selectedEdge.contract.produces}</span>
            </div>
          {/if}
          {#if graphState.selectedEdge.contract.consumed_by && graphState.selectedEdge.contract.consumed_by.length > 0}
            <div class="sub-list">
              <span class="sub-label">consumed by:</span>
              {#each graphState.selectedEdge.contract.consumed_by as c}
                <span class="chip">{c.artifact} · {c.used_as}</span>
              {/each}
            </div>
          {/if}
          {#if graphState.selectedEdge.contract.validation}
            <div class="sub-list">
              <span class="sub-label">validation:</span>
              <span class="chip">{graphState.selectedEdge.contract.validation.method}</span>
            </div>
          {/if}
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .detail-panel {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    width: 340px;
    background: var(--surface-1);
    border-left: 1px solid var(--line);
    color: var(--ink);
    display: flex;
    flex-direction: column;
    z-index: var(--z-panel);
    transform: translateX(100%);
    transition: transform 0.25s var(--ease-out-quart);
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.5);
  }

  .detail-panel.visible {
    transform: translateX(0);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
    background: var(--surface-2);
  }

  .panel-title {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: var(--track-caps);
    color: var(--ink-muted);
    text-transform: uppercase;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--ink-muted);
    cursor: pointer;
    padding: var(--sp-1);
    border-radius: var(--r-sm);
    min-width: var(--tap);
    min-height: var(--tap);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart);
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--ink);
  }

  .panel-body {
    padding: var(--sp-5);
    overflow-y: auto;
    flex: 1;
  }

  .edge-label-title {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 700;
    margin: 0 0 var(--sp-4);
    color: var(--ink);
    word-break: break-all;
  }

  .meta-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
    margin-bottom: var(--sp-5);
    padding-bottom: var(--sp-4);
    border-bottom: 1px solid var(--line);
  }

  .meta-tag {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    color: var(--ink-muted);
    border: 1px solid var(--line);
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    letter-spacing: var(--track-label);
  }

  .id-tag {
    color: var(--ink);
    border-color: var(--line-strong);
    background: var(--surface-3);
  }

  .edge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .section {
    margin-bottom: var(--sp-5);
    padding-top: var(--sp-3);
    border-top: 1px solid var(--line);
  }

  .section-title {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    margin: 0 0 var(--sp-3);
    color: var(--ink-muted);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    letter-spacing: var(--track-caps);
  }

  .section-icon {
    color: var(--ink-faint);
    font-size: var(--text-2xs);
  }

  .plan-desc {
    font-size: var(--text-sm);
    line-height: 1.6;
    color: var(--ink-muted);
    margin: 0;
  }

  .sub-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    margin-top: var(--sp-3);
  }

  .sub-label {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    text-transform: lowercase;
    letter-spacing: var(--track-label);
  }

  .chip {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ink-muted);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 2px var(--sp-2);
    align-self: flex-start;
  }

  .endpoint-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-2);
  }

  .endpoint-label {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    text-transform: lowercase;
    letter-spacing: var(--track-label);
    width: 44px;
    flex-shrink: 0;
  }

  .endpoint-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--status-ready);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    text-align: left;
  }

  .endpoint-link:hover {
    text-decoration: underline;
  }

  @media (max-width: 768px) {
    .detail-panel {
      width: 100%;
      max-width: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .detail-panel {
      transition: none;
    }
  }
</style>
