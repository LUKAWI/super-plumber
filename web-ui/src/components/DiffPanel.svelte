<script lang="ts">
  import { onMount } from "svelte";
  import { graphState } from "../lib/store.svelte";

  let open = $state(false);

  function toggle() {
    open = !open;
    if (open) {
      void graphState.loadSnapshots();
      void graphState.loadDiff();
    } else {
      graphState.clearDiff();
    }
  }

  function selectSnapshot(id: string | null) {
    if (id === null) {
      void graphState.loadDiff();
    } else {
      void graphState.loadDiff(id);
    }
  }

  function fileToLabel(file: string): string {
    return file.replace(/^nodes\//, "").replace(/^edges\//, "").replace(/\.yaml$/, "");
  }

  onMount(() => {
    return () => graphState.clearDiff();
  });
</script>

<div class="diff-panel" class:open>
  <div class="diff-header">
    <span class="diff-title">VERSIONS</span>
    <button class="diff-close" onclick={toggle} aria-label="关闭版本面板">✕</button>
  </div>

  <div class="diff-body">
    {#if graphState.snapshotsLoading}
      <p class="diff-hint">loading snapshots…</p>
    {:else if !graphState.snapshots || graphState.snapshots.length === 0}
      <p class="diff-hint">
        没有快照。在 CLI 执行 <code>graph snapshot</code> 创建基线后即可审核变更。
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
            <span class="diff-count added">+{graphState.diff.added.length}</span>
            <span class="diff-count removed">-{graphState.diff.removed.length}</span>
            <span class="diff-count modified">~{graphState.diff.modified.length}</span>
          </div>
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
              <div class="change-row added">+ {fileToLabel(f)}</div>
            {/each}
            {#each graphState.diff.removed as f}
              <div class="change-row removed">- {fileToLabel(f)}</div>
            {/each}
            {#each graphState.diff.modified as f}
              <div class="change-row modified">~ {fileToLabel(f)}</div>
            {/each}
          </div>
        </div>
      {:else}
        <p class="diff-hint">对比加载失败或服务端无快照。</p>
      {/if}
    {/if}
  </div>
</div>

<button class="diff-toggle {open ? 'active' : ''}" onclick={toggle}
  title="版本对比（快照 → 当前工作区）" aria-label="版本对比">
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M4 1v12M10 1v12M4 6l3-3 3 3M4 8l3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <span class="diff-toggle-label">versions</span>
</button>

<style>
  .diff-toggle {
    position: absolute;
    top: var(--sp-3);
    right: var(--sp-14);
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: var(--sp-2) var(--sp-3);
    color: var(--ink-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: var(--track-label);
    cursor: pointer;
    z-index: var(--z-overlay);
    opacity: 0.7;
    transition: opacity 0.2s var(--ease-out-quart), color 0.15s var(--ease-out-quart);
  }

  .diff-toggle:hover,
  .diff-toggle.active {
    opacity: 0.95;
    color: var(--ink);
  }

  .diff-panel {
    position: absolute;
    top: var(--sp-12);
    right: var(--sp-4);
    width: 300px;
    max-height: 70vh;
    background: var(--surface-1);
    border: 1px solid var(--line);
    border-radius: var(--r);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    display: none;
    flex-direction: column;
    z-index: var(--z-overlay);
    overflow: hidden;
  }

  .diff-panel.open {
    display: flex;
  }

  .diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--line);
    background: var(--surface-2);
    flex-shrink: 0;
  }

  .diff-title {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: var(--track-caps);
    color: var(--ink-muted);
  }

  .diff-close {
    background: none;
    border: none;
    color: var(--ink-muted);
    cursor: pointer;
    font-size: var(--text-xs);
    min-width: var(--tap);
    min-height: var(--tap);
    border-radius: var(--r-sm);
  }

  .diff-close:hover {
    color: var(--ink);
    background: rgba(255, 255, 255, 0.06);
  }

  .diff-body {
    padding: var(--sp-3);
    overflow-y: auto;
    flex: 1;
  }

  .diff-hint {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ink-faint);
    line-height: 1.6;
    margin: 0;
  }

  .diff-hint code {
    background: var(--surface-2);
    padding: 2px 6px;
    border-radius: var(--r-sm);
    color: var(--ink-muted);
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
    border-radius: var(--r-sm);
    padding: var(--sp-2) var(--sp-3);
    cursor: pointer;
    transition: background 0.15s var(--ease-out-quart), border-color 0.15s var(--ease-out-quart);
  }

  .snapshot-item:hover {
    background: var(--surface-2);
  }

  .snapshot-item.active {
    background: var(--surface-2);
    border-color: var(--line-strong);
  }

  .snap-name {
    font-family: var(--font-mono);
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
    font-weight: 700;
  }

  .diff-count.added { color: var(--status-passed); }
  .diff-count.removed { color: var(--status-failed); }
  .diff-count.modified { color: var(--status-running); }

  .status-changes,
  .file-changes {
    display: flex;
    flex-direction: column;
    gap: 2px;
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

  .change-row.added { color: var(--status-passed); }
  .change-row.removed { color: var(--status-failed); }
  .change-row.modified { color: var(--status-running); }

  .change-node {
    flex-shrink: 0;
    font-weight: 600;
  }

  .change-arrow {
    color: var(--ink-faint);
  }
</style>
