<script lang="ts">
  import { graphState } from "../lib/store.svelte";
  import DetailDrawer from "../lib/components/DetailDrawer.svelte";

  function selectSnapshot(id: string | null) {
    void graphState.loadDiff(id ?? undefined);
  }

  function fileToLabel(file: string): string {
    return file.replace(/^nodes\//, "").replace(/^edges\//, "").replace(/\.yaml$/, "");
  }
</script>

{#if graphState.diffOpen}
  <DetailDrawer title="版本对比" open={true} width={360} onclose={() => graphState.toggleDiff()}>
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
  </DetailDrawer>
{/if}

<style>
  /* 版本对比：右缘玻璃抽屉（DetailDrawer 舱体），与节点/边/决策详情同一泊位互斥——
     左下角从此只属于簇色图例，画布底部提示条不再被盖（评审 F1/F2 的结构性解法） */
  .diff-hint {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--ink-faint);
    line-height: 1.7;
    margin: 0;
  }

  .diff-hint code {
    background: var(--wash-2);
    padding: 2px 6px;
    border-radius: 6px;
    color: var(--ink-muted);
    font-family: var(--font-mono);
  }

  .diff-error {
    color: var(--status-failed);
  }

  .diff-retry {
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 6px;
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
    background: var(--wash-2);
  }

  .snapshot-item.active {
    background: var(--wash-3);
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
    border-radius: 6px;
    background: var(--wash-2);
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

  @media (prefers-reduced-motion: reduce) {
    .snapshot-item { transition: none; }
  }
</style>
