<script lang="ts">
  import { graphState } from "../lib/store.svelte";
  import { STATUS_COLORS, type NodeStatus, type Checkpoint } from "../lib/types";

  let visible = $state(false);
  let prevId: string | undefined;

  $effect(() => {
    const node = graphState.selectedNode;
    if (node) {
      if (node.id !== prevId) {
        visible = false;
        requestAnimationFrame(() => { visible = true; });
        prevId = node.id;
      }
    } else {
      visible = false;
      prevId = undefined;
    }
  });

  function cpIcon(status: string): string {
    const m: Record<string, string> = {
      passed: "✅", failed: "❌", running: "⏳", pending: "🔲", skipped: "⏭️",
    };
    return m[status] ?? "🔲";
  }
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

      <!-- 元信息 -->
      <div class="meta-grid">
        <span class="meta-tag id-tag">{graphState.selectedNode.id}</span>
        <span class="meta-tag type-tag">{graphState.selectedNode.type}</span>
        <span class="meta-tag">L{graphState.selectedNode.level}</span>
        <span class="meta-tag status-tag"
          style="background: {STATUS_COLORS[graphState.selectedNode.status as NodeStatus]}">
          {graphState.selectedNode.status}
        </span>
        {#if graphState.selectedNode.assigned_to}
          <span class="meta-tag assign-tag">{graphState.selectedNode.assigned_to}</span>
        {/if}
      </div>

      <!-- 构建计划 -->
      {#if graphState.selectedNode.plan?.description}
        <section class="section">
          <h3 class="section-title">📋 构建计划</h3>
          <p class="plan-desc">{graphState.selectedNode.plan.description}</p>
          {#if graphState.selectedNode.plan.output_to && graphState.selectedNode.plan.output_to.length > 0}
            <div class="sub-list">
              <span class="sub-label">交付: </span>
              {#each graphState.selectedNode.plan.output_to as out}
                <span class="chip">{out.artifact} → {out.node}</span>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <!-- 完成标准 -->
      {#if graphState.selectedNode.expected_outcome?.definition_of_done}
        <section class="section">
          <h3 class="section-title">✅ 完成标准</h3>
          <ul class="dod-list">
            {#each graphState.selectedNode.expected_outcome.definition_of_done as item}
              <li>{item}</li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- Checkpoints -->
      {#if graphState.selectedNode.checkpoints && graphState.selectedNode.checkpoints.length > 0}
        <section class="section">
          <h3 class="section-title">🔲 检查点 ({graphState.selectedNode.checkpoints.filter((c: Checkpoint) => c.status === 'passed').length}/{graphState.selectedNode.checkpoints.length})</h3>
          <div class="cp-list">
            {#each graphState.selectedNode.checkpoints as cp}
              <div class="cp-item">
                <span class="cp-icon">{cpIcon(cp.status)}</span>
                <div class="cp-body">
                  <span class="cp-label">{cp.label}</span>
                  <span class="cp-status" class:cp-done={cp.status === 'passed'} class:cp-fail={cp.status === 'failed'}>
                    {cp.status}
                  </span>
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- 底部信息 -->
      <div class="footer-info">
        <span>尝试: {graphState.selectedNode.attempts}/{graphState.selectedNode.max_attempts}</span>
        {#if graphState.selectedNode.created_at}
          <span>创建: {new Date(graphState.selectedNode.created_at).toLocaleDateString()}</span>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .detail-panel {
    position: fixed; right: 0; top: 0; bottom: 0; width: 360px;
    background: #0f172a; border-left: 1px solid #1e293b; color: #e2e8f0;
    display: flex; flex-direction: column; z-index: 100;
    transform: translateX(100%);
    transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1);
    box-shadow: -4px 0 24px rgba(0,0,0,0.3);
  }
  .detail-panel.visible { transform: translateX(0); }

  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.875rem 1.25rem; border-bottom: 1px solid #1e293b; flex-shrink: 0;
  }
  .panel-title {
    font-size: 0.75rem; font-weight: 500; text-transform: uppercase;
    letter-spacing: 0.06em; color: #64748b;
  }
  .close-btn {
    background: none; border: none; color: #64748b; cursor: pointer;
    padding: 4px; border-radius: 4px;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .close-btn:hover { color: #e2e8f0; background: #1e293b; }

  .panel-body { padding: 1.25rem; overflow-y: auto; flex: 1; }

  .node-label {
    font-size: 1.1rem; font-weight: 600; margin: 0 0 0.75rem;
    color: #f1f5f9; line-height: 1.4;
  }

  /* 元信息标签行 */
  .meta-grid { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 1rem; }
  .meta-tag {
    font-size: 0.65rem; padding: 2px 8px; border-radius: 4px;
    background: #1e293b; color: #94a3b8; font-weight: 500;
  }
  .id-tag { font-family: monospace; background: #1e1b4b; color: #a5b4fc; }
  .type-tag { background: #1c1917; color: #fdba74; }
  .status-tag { color: #fff; }
  .assign-tag { background: #052e16; color: #86efac; }

  /* 分区 */
  .section { margin-bottom: 1rem; }
  .section-title {
    font-size: 0.75rem; font-weight: 600; margin: 0 0 0.5rem;
    color: #94a3b8; letter-spacing: 0.02em;
  }
  .plan-desc {
    font-size: 0.8rem; line-height: 1.5; color: #cbd5e1; margin: 0;
  }
  .sub-list { margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .sub-label { font-size: 0.7rem; color: #64748b; }
  .chip {
    font-size: 0.65rem; background: #1e293b; padding: 1px 6px;
    border-radius: 3px; color: #818cf8;
  }

  /* 完成标准列表 */
  .dod-list {
    margin: 0; padding-left: 1.2rem;
    font-size: 0.8rem; color: #cbd5e1; line-height: 1.6;
  }

  /* 检查点列表 */
  .cp-list { display: flex; flex-direction: column; gap: 0.4rem; }
  .cp-item {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.4rem 0.5rem; background: #1e293b; border-radius: 6px;
  }
  .cp-icon { font-size: 0.85rem; flex-shrink: 0; }
  .cp-body { display: flex; justify-content: space-between; align-items: center; flex: 1; min-width: 0; }
  .cp-label { font-size: 0.75rem; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-status {
    font-size: 0.6rem; padding: 1px 6px; border-radius: 3px;
    background: #334155; color: #94a3b8; flex-shrink: 0;
  }
  .cp-done { background: #052e16; color: #86efac; }
  .cp-fail { background: #450a0a; color: #fca5a5; }

  /* 底部 */
  .footer-info {
    margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #1e293b;
    display: flex; justify-content: space-between;
    font-size: 0.65rem; color: #475569;
  }

  @media (prefers-reduced-motion: reduce) { .detail-panel { transition: none; } }
</style>
