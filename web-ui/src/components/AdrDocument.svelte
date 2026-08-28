<script lang="ts">
  // ADR 决策文档抽屉（左侧）：ADR 在本产品的唯一详情呈现——状态横幅 +
  // Markdown 五段 + 管辖清单。任何路径选中 adr 节点都路由到这里
  // （NodeDetail 已对 adr 设卫语句），保证决策文档只有一种打开方式。
  import { graphState } from "../lib/store.svelte";
  import Markdown from "../lib/components/Markdown.svelte";
  import { ADR_STATUS_META, governsOf, type AdrGovernTarget } from "../lib/maps";
  import { statusColorOf, type AdrStatus } from "../lib/types";

  let visible = $state(false);
  let prevId: string | undefined;

  $effect(() => {
    const node = graphState.selectedNode;
    if (node && node.type === "adr") {
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

  const adr = $derived.by(() => {
    const n = graphState.selectedNode;
    return n && n.type === "adr" ? n : null;
  });

  // 五个正文字段里 decision 之外的可选段落（有内容才出节）
  // type 守卫不收窄 status 联合 → 这里显式锚定为 ADR 三态
  const adrStatus = $derived(adr ? (adr.status as AdrStatus) : "proposed");

  const sections = $derived.by(() => {
    const n = adr;
    if (!n) return [];
    const out: { title: string; text: string }[] = [];
    if (n.background) out.push({ title: "背景", text: n.background });
    if (n.considered_options) out.push({ title: "备选方案", text: n.considered_options });
    if (n.why) out.push({ title: "为何", text: n.why });
    if (n.consequences) out.push({ title: "后果", text: n.consequences });
    return out;
  });

  const governs = $derived.by(() => {
    const g = graphState.graph;
    const n = adr;
    if (!g || !n) return [] as AdrGovernTarget[];
    return governsOf(g.nodes, g.edges).get(n.id) ?? [];
  });

  function jump(target: AdrGovernTarget): void {
    const g = graphState.graph;
    if (!g) return;
    const full = g.nodes.find((m) => m.id === target.nodeId);
    if (full) graphState.selectNode(full);
  }

  /** 三态符号（统一描边 SVG）：proposed 虚线圆 / accepted 圆+勾 / superseded 圆+斜线 */
  const bannerGlyph = $derived.by(() => {
    if (adrStatus === "accepted") return { d: "M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM5.6 8.3 7.4 10l3.2-4", dash: null as string | null };
    if (adrStatus === "superseded") return { d: "M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM4.6 11.4 11.4 4.6", dash: null as string | null };
    return { d: "M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z", dash: "2.6 2.2" as string | null };
  });
</script>

{#if adr}
  <aside class="adr-doc" class:visible>
    <div class="panel-header">
      <span class="panel-title">决策文档</span>
      <span class="panel-kbd">Esc 关闭</span>
      <button class="close-btn" onclick={() => graphState.selectNode(null)} aria-label="关闭">
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M3.5 3.5l8 8M11.5 3.5l-8 8" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div class="doc-body">
      <!-- 状态横幅：三态三色 + 线型语义（proposed 虚线 / superseded 划题） -->
      <div
        class="status-banner st-{adr.status}"
        style="--adr-color: {statusColorOf(adr.status)}"
        role="status"
      >
        <svg class="banner-mark" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <path d={bannerGlyph.d} stroke-linecap="round" stroke-linejoin="round" stroke-dasharray={bannerGlyph.dash ?? undefined}/>
        </svg>
        <span class="banner-text">
          <span class="banner-en">{ADR_STATUS_META[adrStatus].en}</span>
          <span class="banner-zh">{ADR_STATUS_META[adrStatus].zh}</span>
        </span>
        {#if adr.status === "superseded" && adr.superseded_by}
          <span class="banner-successor">→ 被 <code>{adr.superseded_by}</code> 接替</span>
        {/if}
      </div>

      <h2 class="doc-title" class:strike={adr.status === "superseded"}>{adr.label}</h2>

      <div class="meta-grid">
        <span class="meta-tag id-tag">{adr.id}</span>
        <span class="meta-tag">adr</span>
        <span class="meta-tag">L{adr.level}</span>
        {#if adr.created_at}
          <span class="meta-tag date-tag">{new Date(adr.created_at).toLocaleDateString()}</span>
        {/if}
      </div>

      <!-- 决策正文：引言块放大（阅读主位） -->
      {#if adr.decision}
        <section class="section">
          <h3 class="section-title">决策</h3>
          <blockquote class="decision-quote"><Markdown text={adr.decision} /></blockquote>
        </section>
      {/if}

      {#each sections as s (s.title)}
        <section class="section">
          <h3 class="section-title">{s.title}</h3>
          <Markdown text={s.text} />
        </section>
      {/each}

      <!-- 管辖范围：decides 出边反查，可点击跳转被管辖对象 -->
      <section class="section">
        <h3 class="section-title">管辖
          <span class="section-count">{governs.length}</span>
        </h3>
        {#if governs.length > 0}
          <div class="governs-list">
            {#each governs as t (t.nodeId)}
              <button class="govern-chip" onclick={() => jump(t)} title="跳转到 {t.nodeId}">
                <span class="govern-kind">{t.isContext ? "ctx" : "node"}</span>
                <span class="govern-label">{t.label}</span>
                <span class="govern-id">{t.nodeId}</span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="orphan-note">孤儿决策：尚未用 decides 边挂接到它管辖的节点 / context</p>
        {/if}
      </section>
    </div>
  </aside>
{/if}

<style>
  .adr-doc {
    position: fixed;
    left: 0;
    top: var(--header-h);
    bottom: 0;
    width: min(440px, 92vw);
    background: var(--surface-1);
    border-right: 1px solid var(--line);
    color: var(--ink);
    display: flex;
    flex-direction: column;
    /* v0.7：z 体系归位——工具轨/浮层在 --z-overlay(10)，面板层 100 足以覆盖 */
    z-index: var(--z-panel);
    transform: translateX(-100%);
    transition: transform 0.22s var(--ease-out-quint);
  }

  .adr-doc.visible {
    transform: translateX(0);
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 0 var(--sp-3);
    min-height: 44px;
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
    background: var(--surface-1);
  }

  .panel-title {
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

  .close-btn {
    background: none;
    border: none;
    color: var(--ink-muted);
    cursor: pointer;
    border-radius: var(--r);
    min-width: var(--tap);
    min-height: var(--tap);
    margin-right: calc((var(--tap) - 32px) / -2);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.13s var(--ease-out-quart), color 0.13s var(--ease-out-quart);
  }

  .close-btn:hover {
    background: var(--surface-2);
    color: var(--ink);
  }

  .doc-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-4);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  /* ── 状态横幅 ── */
  .status-banner {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r);
    border: 1px solid var(--adr-color);
    background: color-mix(in srgb, var(--adr-color) 12%, transparent);
    color: var(--adr-color);
  }

  .status-banner.st-proposed {
    border-style: dashed;
  }

  .banner-mark {
    flex-shrink: 0;
  }

  .banner-text {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
  }

  .banner-en {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: var(--track-caps);
    color: var(--adr-color);
  }

  .banner-zh {
    font-size: var(--text-xs);
    color: var(--ink-muted);
  }

  .banner-successor {
    margin-left: auto;
    font-size: var(--text-2xs);
    color: var(--ink-muted);
  }

  .banner-successor code {
    font-family: var(--font-mono);
    color: var(--adr-color);
  }

  .doc-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
    line-height: 1.35;
    color: var(--ink);
    text-wrap: balance;
  }

  .doc-title.strike {
    text-decoration: line-through;
    text-decoration-color: var(--ink-faint);
  }

  .meta-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
  }

  .meta-tag {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--ink-muted);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 2px var(--sp-2);
  }

  .id-tag {
    color: var(--ink);
  }

  .date-tag {
    color: var(--ink-faint);
  }

  .section-title {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 650;
    color: var(--ink);
    margin: 0 0 var(--sp-1);
  }

  .section-count {
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    font-family: var(--font-mono);
  }

  /* ── 决策引言块（中性引用线：2px ink 阶梯，非彩色边条） ── */
  .decision-quote {
    margin: 0;
    padding: var(--sp-2) var(--sp-3);
    border-left: 2px solid var(--ink-faint);
    background: var(--surface-2);
    border-radius: 0 var(--r) var(--r) 0;
  }

  /* ── 管辖 ── */
  .governs-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }

  .govern-chip {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: var(--sp-1) var(--sp-2);
    cursor: pointer;
    transition: border-color 0.13s var(--ease-out-quart);
  }

  .govern-chip:hover {
    border-color: var(--ink-faint);
  }

  .govern-chip:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }

  .govern-kind {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    white-space: nowrap;
  }

  .govern-label {
    font-size: var(--text-xs);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .govern-id {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    white-space: nowrap;
  }

  .orphan-note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--ink-faint);
    font-style: italic;
  }

  @media (max-width: 768px) {
    .adr-doc {
      top: 0;
      width: 100vw;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .adr-doc {
      transition: none;
    }
  }
</style>
