<script lang="ts">
  import { graphState } from "../lib/store.svelte";

  function selectSnapshot(id: string | null) {
    void graphState.loadDiff(id ?? undefined);
  }

  function fileToLabel(file: string): string {
    return file.replace(/^nodes\//, "").replace(/^edges\//, "").replace(/\.yaml$/, "");
  }
</script>

{#if graphState.diffOpen}
  <div class="diff-panel">
    <div class="diff-header">
      <span class="diff-title">版本对比</span>
      <span class="panel-kbd">Esc 关闭</span>
      <button class="diff-close" onclick={() => graphState.toggleDiff()} aria-label="关闭版本面板">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div class="diff-body">
      {#if graphState.snapshotsLoading}
        <p class="diff-hint">正在加载快照…</p>
      {:else if graphState.snapshotsError}
        <p class="diff-hint diff-error" role="alert">
          {graphState.snapshotsError}
          <button class="diff-retry" onclick={() => void graphState.loadSnapshots()}>重试</button>
        </p>
      {:else if !graphState.snapshots || graphState.snapshots.length === 0}
        <p class="diff-hint">
          暂无快照。在 CLI 执行 <code>graph snapshot</code> 创建基线后即可审核变更。
        </p>
      {:else}
        <div class="snapshot-list">
          <button class="snapshot-item" class:active={!graphState.diff || graphState.diff.from === graphState.snapshots[graphState.snapshots.length - 1].id}
            onclick={() => selectSnapshot(null)}>
            <span class="snap-name">最新快照 → 当前</span>
            <span class="snap-time">working tree</span>
          </button>
          {#each [...graphState.snapshots].reverse() as snap}
            <button class="snapshot-item {graphState.diff?.from === snap.id ? 'active' : ''}"
              onclick={() => selectSnapshot(snap.id)}>
              <span class="snap-name">{snap.message ?? snap.id.slice(0, 20)}</span>
              <span class="snap-time">{new Date(snap.created_at).toLocaleString()}</span>
            </button>
          {/each}
        </div>

        {#if graphState.diff}
          <div class="diff-result">
            <div class="diff-summary">
              <!-- 中性符号徽章：diff 不占用状态色相（色彩即状态） -->
              <span class="diff-count"><span class="diff-sig">+</span>{graphState.diff.added.length}</span>
              <span class="diff-count"><span class="diff-sig">−</span>{graphState.diff.removed.length}</span>
              <span class="diff-count"><span class="diff-sig">~</span>{graphState.diff.modified.length}</span>
            </div>
            {#if graphState.diff.added.length === 0 && graphState.diff.removed.length === 0 && graphState.diff.modified.length === 0 && graphState.diff.status_changes.length === 0}
              <p class="diff-hint">当前工作区与该快照一致，没有差异。</p>
            {:else}
              {#if graphState.diff.status_changes.length > 0}
                <div class="status-changes">
                  {#each graphState.diff.status_changes as c}
                    <div class="change-row">
                      <span class="change-node">{c.node}</span>
                      <span class="change-arrow">{c.from} → {c.to}</span>
                    </div>
                  {/each}
                </div>
              {/if}
              <div class="file-changes">
                {#each graphState.diff.added as f}
                  <div class="change-row"><span class="diff-sig">+</span> {fileToLabel(f)}</div>
                {/each}
                {#each graphState.diff.removed as f}
                  <div class="change-row"><span class="diff-sig">−</span> {fileToLabel(f)}</div>
                {/each}
                {#each graphState.diff.modified as f}
                  <div class="change-row"><span class="diff-sig">~</span> {fileToLabel(f)}</div>
                {/each}
              </div>
            {/if}
          </div>
        {:else if graphState.diffError}
          <p class="diff-hint diff-error" role="alert">
            {graphState.diffError}
            <button class="diff-retry" onclick={() => void graphState.loadDiff()}>重试</button>
          </p>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  /* 版本对比面板：工具轨「版本」按钮的 flyout（v0.7：--sp-14 未定义 token 修复 +
     从画布右上角迁到工具轨旁，不再与缩放控件/详情面板抢右上角） */
  .diff-panel {
    position: absolute;
    left: calc(var(--rail-w) + var(--sp-2));
    bottom: var(--sp-3);
    width: 320px;
    max-height: min(60vh, 520px);
    background: var(--surface-1);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    display: flex;
    flex-direction: column;
    z-index: var(--z-panel);
    overflow: hidden;
  }

  .diff-header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 0 var(--sp-3);
    min-height: 44px;
    border-bottom: 1px solid var(--line);
    background: var(--surface-1);
    flex-shrink: 0;
  }

  .diff-title {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 650;
    color: var(--ink);
    flex: 1;
  }

  .panel-kbd {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 1px var(--sp-1);
  }

  .diff-close {
    background: none;
    border: none;
    color: var(--ink-muted);
    cursor: pointer;
    min-width: 32px;
    min-height: 32px;
    border-radius: var(--r);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.13s var(--ease-out-quart), color 0.13s var(--ease-out-quart);
  }

  .diff-close:hover {
    color: var(--ink);
    background: var(--surface-2);
  }

  .diff-body {
    padding: var(--sp-3);
    overflow-y: auto;
    flex: 1;
  }

  .diff-hint {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--ink-faint);
    line-height: 1.7;
    margin: 0;
  }

  .diff-hint code {
    background: var(--surface-2);
    padding: 2px 6px;
    border-radius: var(--r-sm);
    color: var(--ink-muted);
    font-family: var(--font-mono);
  }

  .diff-error {
    color: var(--status-failed);
  }

  .diff-retry {
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-sm);
    color: var(--ink-muted);
    font-family: var(--font-sans);
    font-size: var(--text-2xs);
    padding: 2px var(--sp-2);
    cursor: pointer;
    margin-left: var(--sp-2);
    transition: color 0.13s var(--ease-out-quart), border-color 0.13s var(--ease-out-quart);
  }

  .diff-retry:hover {
    color: var(--ink);
    border-color: var(--ink-faint);
  }

  .snapshot-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }

  .snapshot-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--r);
    padding: var(--sp-2) var(--sp-3);
    cursor: pointer;
    transition: background 0.13s var(--ease-out-quart), border-color 0.13s var(--ease-out-quart);
  }

  .snapshot-item:hover {
    background: var(--surface-2);
  }

  .snapshot-item.active {
    background: var(--surface-2);
    border-color: var(--line-strong);
  }

  .snapshot-item:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }

  .snap-name {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .snap-time {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
  }

  .diff-result {
    margin-top: var(--sp-3);
    padding-top: var(--sp-3);
    border-top: 1px solid var(--line);
  }

  .diff-summary {
    display: flex;
    gap: var(--sp-3);
    margin-bottom: var(--sp-2);
  }

  .diff-count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  /* 中性符号徽章 */
  .diff-sig {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    font-weight: 700;
  }

  .status-changes,
  .file-changes {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: var(--sp-2);
  }

  .change-row {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-muted);
    display: flex;
    gap: var(--sp-2);
    align-items: baseline;
  }

  .change-node {
    flex-shrink: 0;
    font-weight: 600;
    color: var(--ink);
  }

  .change-arrow {
    color: var(--ink-faint);
  }

  @media (max-width: 768px) {
    .diff-panel {
      left: var(--sp-2);
      right: var(--sp-2);
      width: auto;
      bottom: calc(52px + var(--sp-2));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .snapshot-item { transition: none; }
  }
</style>
