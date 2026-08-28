<script lang="ts">
  import { graphState } from "../lib/store.svelte";
  import { EDGE_TYPE_LABELS, type EdgeType } from "../lib/types";
  import DetailDrawer from "../lib/components/DetailDrawer.svelte";

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
    decides: "决策管辖：ADR 决定该节点/簇的架构走向（dock「决策文档」可查阅）",
    relates: "领域关系：context 之间的领域关联（rel_kind 自由标注，仅领域视图可见）",
  };
</script>

{#if graphState.selectedEdge}
  {@const edge = graphState.selectedEdge}
  <DetailDrawer title="边详情" open={visible} width={360} onclose={() => graphState.selectEdge(null)}>
    <!-- 人类可读标题 = 类型名；边 id 是数据 → meta chip -->
    <h2 class="entity-title">{EDGE_TYPE_LABELS[edge.type]}</h2>

    <div class="meta-grid">
      <span class="meta-tag id-tag">{edge.id}</span>
      <span class="meta-tag">{edge.type}</span>
    </div>

    <section class="section">
      <h3 class="section-title">语义</h3>
      <p class="plan-desc">{EDGE_SEMANTICS[edge.type]}</p>
      {#if edge.type === "relates" && edge.rel_kind}
        <div class="sub-list">
          <span class="sub-label">rel_kind:</span>
          <span class="chip">{edge.rel_kind}</span>
        </div>
      {/if}
    </section>

    <section class="section">
      <h3 class="section-title">端点</h3>
      <div class="endpoint-row">
        <span class="endpoint-label">source</span>
        <button class="endpoint-link" onclick={() => {
          const n = graphState.graph?.nodes.find((x) => x.id === edge.source);
          graphState.selectEdge(null);
          if (n) graphState.selectNode(n);
        }}>
          {edge.source}
        </button>
      </div>
      <div class="endpoint-row">
        <span class="endpoint-label">target</span>
        <button class="endpoint-link" onclick={() => {
          const n = graphState.graph?.nodes.find((x) => x.id === edge.target);
          graphState.selectEdge(null);
          if (n) graphState.selectNode(n);
        }}>
          {edge.target}
        </button>
      </div>
    </section>

    {#if edge.contract}
      <section class="section">
        <h3 class="section-title">契约</h3>
        {#if edge.contract.produces}
          <div class="sub-list">
            <span class="sub-label">produces:</span>
            <span class="chip">{edge.contract.produces}</span>
          </div>
        {/if}
        {#if edge.contract.consumed_by && edge.contract.consumed_by.length > 0}
          <div class="sub-list">
            <span class="sub-label">consumed by:</span>
            {#each edge.contract.consumed_by as c}
              <span class="chip">{c.artifact} · {c.used_as}</span>
            {/each}
          </div>
        {/if}
        {#if edge.contract.validation}
          <div class="sub-list">
            <span class="sub-label">validation:</span>
            <span class="chip">{edge.contract.validation.method}</span>
          </div>
        {/if}
      </section>
    {/if}
  </DetailDrawer>
{/if}

<style>
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
    letter-spacing: 0.02em;
    width: 44px;
    flex-shrink: 0;
  }

  .endpoint-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    text-align: left;
    text-decoration: underline;
    text-decoration-color: var(--line-strong);
    text-underline-offset: 3px;
    transition: text-decoration-color 0.13s var(--ease-out-quart);
  }

  .endpoint-link:hover {
    text-decoration-color: var(--ink);
  }
</style>
