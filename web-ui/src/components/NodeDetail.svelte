<script lang="ts">
  import { graphState } from "../lib/store.svelte";
  import { STATUS_COLORS, type NodeStatus } from "../lib/types";

  let visible = $state(false);
  let prevId: string | undefined;

  $effect(() => {
    const node = graphState.selectedNode;
    if (node) {
      if (node.id !== prevId) {
        visible = false;
        // tick to trigger reflow, then show
        requestAnimationFrame(() => { visible = true; });
        prevId = node.id;
      }
    } else {
      visible = false;
      prevId = undefined;
    }
  });
</script>

{#if graphState.selectedNode}
  <div class="detail-panel" class:visible>
    <div class="panel-header">
      <span class="panel-title">节点详情</span>
      <button class="close-btn" onclick={() => graphState.selectNode(null)} aria-label="关闭">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 3l8 8M11 3l-8 8"/>
        </svg>
      </button>
    </div>

    <div class="panel-body">
      <h2 class="node-label">{graphState.selectedNode.label}</h2>

      <div class="info-grid">
        <div class="field">
          <span class="field-label">ID</span>
          <code class="field-value">{graphState.selectedNode.id}</code>
        </div>
        <div class="field">
          <span class="field-label">类型</span>
          <span class="field-value type-badge">{graphState.selectedNode.type}</span>
        </div>
        <div class="field">
          <span class="field-label">层级</span>
          <span class="field-value">L{graphState.selectedNode.level}</span>
        </div>
        <div class="field">
          <span class="field-label">状态</span>
          <span
            class="status-badge"
            style="background: {STATUS_COLORS[graphState.selectedNode.status as NodeStatus]}"
          >
            {graphState.selectedNode.status}
          </span>
        </div>
        {#if graphState.selectedNode.assigned_to}
          <div class="field">
            <span class="field-label">执行者</span>
            <span class="field-value">{graphState.selectedNode.assigned_to}</span>
          </div>
        {/if}
        <div class="field">
          <span class="field-label">尝试</span>
          <span class="field-value">{graphState.selectedNode.attempts} / {graphState.selectedNode.max_attempts}</span>
        </div>
      </div>
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
    background: #0f172a;
    border-left: 1px solid #1e293b;
    color: #e2e8f0;
    display: flex;
    flex-direction: column;
    z-index: 100;
    transform: translateX(100%);
    transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1);
    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.3);
  }
  .detail-panel.visible {
    transform: translateX(0);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid #1e293b;
    flex-shrink: 0;
  }
  .panel-title {
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
  }
  .close-btn {
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .close-btn:hover {
    color: #e2e8f0;
    background: #1e293b;
  }

  .panel-body {
    padding: 1.25rem;
    overflow-y: auto;
    flex: 1;
  }

  .node-label {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0 0 1.25rem;
    color: #f1f5f9;
    line-height: 1.4;
  }

  .info-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid #1e293b;
  }
  .field:last-child {
    border-bottom: none;
  }
  .field-label {
    font-size: 0.7rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
  }
  .field-value {
    font-size: 0.8rem;
    color: #e2e8f0;
    font-variant-numeric: tabular-nums;
  }

  .type-badge {
    background: #1e293b;
    padding: 1px 8px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 500;
  }
  .status-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: #fff;
  }

  @media (prefers-reduced-motion: reduce) {
    .detail-panel {
      transition: none;
    }
  }
</style>
