<script lang="ts">
  import { graphState } from "../lib/store.svelte";
  import { STATUS_COLORS } from "../lib/types";
</script>

{#if graphState.selectedNode}
  <div class="detail-panel">
    <button class="close-btn" onclick={() => graphState.selectNode(null)}>✕</button>
    <h2>{graphState.selectedNode.label}</h2>
    <div class="info-grid">
      <div class="field">
        <label>ID</label>
        <span>{graphState.selectedNode.id}</span>
      </div>
      <div class="field">
        <label>类型</label>
        <span>{graphState.selectedNode.type}</span>
      </div>
      <div class="field">
        <label>层级</label>
        <span>L{graphState.selectedNode.level}</span>
      </div>
      <div class="field">
        <label>状态</label>
        <span class="status-badge"
          style="background: {STATUS_COLORS[graphState.selectedNode.status]}">
          {graphState.selectedNode.status}
        </span>
      </div>
      {#if graphState.selectedNode.assigned_to}
        <div class="field">
          <label>执行者</label>
          <span>{graphState.selectedNode.assigned_to}</span>
        </div>
      {/if}
      <div class="field">
        <label>尝试</label>
        <span>{graphState.selectedNode.attempts}/{graphState.selectedNode.max_attempts}</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .detail-panel {
    position: fixed; right: 0; top: 0; bottom: 0; width: 320px;
    background: #1e293b; color: #e2e8f0; padding: 1.5rem;
    box-shadow: -2px 0 8px rgba(0,0,0,0.3); overflow-y: auto;
  }
  .close-btn { float: right; background: none; border: none; color: #94a3b8; font-size: 1.2rem; cursor: pointer; }
  .info-grid { margin-top: 1rem; }
  .field { margin-bottom: 0.75rem; }
  .field label { display: block; font-size: 0.75rem; color: #64748b; text-transform: uppercase; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; color: #fff; }
</style>
