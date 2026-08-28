<script lang="ts">
  import { graphState } from "../lib/store.svelte";
  import {
    statusColorOf,
    type NodeSchema,
    type Checkpoint,
    isKnowledgeType,
  } from "../lib/types";
  import { adrFlagsFor } from "../lib/maps";
  import Markdown from "../lib/components/Markdown.svelte";
  import DetailDrawer from "../lib/components/DetailDrawer.svelte";

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

  // checkpoint 状态图标：统一描边 SVG（废除 ✓✗◐○ Unicode 字形）
  function cpIcon(status: string): string {
    const m: Record<string, string> = {
      passed: "M2.5 6.5 5 9l4.5-5.5",
      failed: "M3 3l6 6M9 3l-6 6",
      running: "M6 1.5A4.5 4.5 0 1 1 1.5 6",
      pending: "M6 2.5A3.5 3.5 0 1 1 2.5 6 3.5 3.5 0 0 1 6 2.5Z",
      skipped: "M2.5 6h7",
    };
    return m[status] ?? m.pending;
  }

  function cpClass(status: string): string {
    const m: Record<string, string> = {
      passed: "cp-passed",
      failed: "cp-failed",
      running: "cp-running",
    };
    return m[status] ?? "cp-pending";
  }

  const node = $derived(graphState.selectedNode);
  // v0.5：知识顶点以文档形态呈现（context=边界/术语，adr=决策文档）
  const isContext = $derived(node?.type === "context");
  const isAdr = $derived(node?.type === "adr");

  // adr_flags：superseded ADR 沿 decides 边传播的"决策依据已过时"警告（客户端预计算，纯只读展示）
  const adrFlags = $derived.by(() => {
    const g = graphState.graph;
    if (!g || !node) return [] as string[];
    return adrFlagsFor(g.nodes, g.edges).get(node.id) ?? [];
  });

  // context 成员（归属该上下文的工作流节点）
  const contextMembers = $derived.by(() => {
    const g = graphState.graph;
    if (!g || !node || node.type !== "context") return [] as NodeSchema[];
    return g.nodes.filter((m) => m.context === node.id && !isKnowledgeType(m.type));
  });

  /** 管辖决策：decides 打到本节点（或本节点所属 context）的 ADR —— 从详情页可跳转 */
  const linkedAdrs = $derived.by(() => {
    const g = graphState.graph;
    if (!g || !node) return [] as NodeSchema[];
    const out: NodeSchema[] = [];
    for (const e of g.edges) {
      if (e.type !== "decides") continue;
      const src = g.nodes.find((x) => x.id === e.source);
      if (!src || src.type !== "adr") continue;
      if (e.target === node.id || (node.context && e.target === node.context)) out.push(src);
    }
    return out;
  });

  /** 决策文档的管辖范围：decides 边的落点（工作流节点或 context 簇） */
  const governedTargets = $derived.by(() => {
    const g = graphState.graph;
    if (!g || !node || node.type !== "adr") return [] as NodeSchema[];
    return g.edges
      .filter((e) => e.type === "decides" && e.source === node.id)
      .map((e) => g.nodes.find((x) => x.id === e.target))
      .filter((x): x is NodeSchema => !!x);
  });

  /** 接替链：superseded ADR 的接替者实体（可跳转） */
  const supersededBy = $derived.by(() => {
    const g = graphState.graph;
    if (!g || !node || node.type !== "adr" || !node.superseded_by) return null;
    return g.nodes.find((x) => x.id === node.superseded_by) ?? null;
  });

  function jumpTo(target: NodeSchema) {
    graphState.selectNode(target);
  }
</script>

{#if node}
  <DetailDrawer
    title={isAdr ? "决策文档" : isContext ? "上下文详情" : "节点详情"}
    open={visible}
    onclose={() => graphState.selectNode(null)}
  >
    <h2 class="entity-title">{node.label}</h2>

    <!-- meta chips：context 是知识顶点，无工作流生命周期，不显示假状态 -->
    <div class="meta-grid">
      <span class="meta-tag id-tag">{node.id}</span>
      <span class="meta-tag">{node.type}</span>
      <span class="meta-tag">L{node.level}</span>
      {#if !isContext}
        <span class="meta-tag status-tag"
          style="border-color: {statusColorOf(node.status)}">
          <span class="status-dot" style="background: {statusColorOf(node.status)}"></span>
          {node.status}
        </span>
      {/if}
      {#if node.assigned_to}
        <span class="meta-tag">{node.assigned_to}</span>
      {/if}
    </div>

    <!-- adr_flags：superseded ADR 沿 decides 边传播的"决策依据已过时"警告 -->
    {#if adrFlags.length > 0}
      <div class="adr-flags" role="alert">
        {#each adrFlags as f}
          <p class="adr-flag-item">
            <svg class="flag-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
              <path d="M6.5 1.5 12 11H1L6.5 1.5ZM6.5 5v3M6.5 9.6v.8" stroke-linejoin="round"/>
            </svg>
            {f}
          </p>
        {/each}
      </div>
    {/if}

    {#if isAdr}
      <!-- 决策文档：decision 必填，其余四节选填 -->
      {#if node.status === "superseded"}
        <div class="adr-flags" role="alert">
          <p class="adr-flag-item">
            <svg class="flag-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
              <path d="M6.5 1.5 12 11H1L6.5 1.5ZM6.5 5v3M6.5 9.6v.8" stroke-linejoin="round"/>
            </svg>
            已被接替：
            {#if supersededBy}
              <button class="chain-link" onclick={() => jumpTo(supersededBy)}>{supersededBy.label ?? supersededBy.id}</button>
            {:else}
              {node.superseded_by}
            {/if}
          </p>
        </div>
      {/if}
      {#if node.decision}
        <section class="section">
          <h3 class="section-title">决策</h3>
          <Markdown text={node.decision} />
        </section>
      {/if}
      {#if node.background}
        <section class="section">
          <h3 class="section-title">背景</h3>
          <Markdown text={node.background} />
        </section>
      {/if}
      {#if node.considered_options}
        <section class="section">
          <h3 class="section-title">备选方案</h3>
          <Markdown text={node.considered_options} />
        </section>
      {/if}
      {#if node.why}
        <section class="section">
          <h3 class="section-title">理由</h3>
          <Markdown text={node.why} />
        </section>
      {/if}
      {#if node.consequences}
        <section class="section">
          <h3 class="section-title">后果与代价</h3>
          <Markdown text={node.consequences} />
        </section>
      {/if}
      {#if governedTargets.length > 0}
        <section class="section">
          <h3 class="section-title">管辖范围
            <span class="section-count">{governedTargets.length}</span>
          </h3>
          <div class="sub-list">
            {#each governedTargets as t (t.id)}
              <button class="chip chip-link" onclick={() => jumpTo(t)}>
                {t.type === "context" ? "◇ " : ""}{t.label || t.id}
              </button>
            {/each}
          </div>
        </section>
      {/if}
      <div class="footer-info">
        {#if node.created_at}
          <span><span class="footer-label">created:</span>{new Date(node.created_at).toLocaleDateString()}</span>
        {/if}
        {#if node.updated_at}
          <span><span class="footer-label">updated:</span>{new Date(node.updated_at).toLocaleDateString()}</span>
        {/if}
      </div>
    {:else if isContext}
      <!-- context 顶点：节点即文档（boundary 全文 + glossary 全部术语 + 成员清单） -->
      {#if node.boundary}
        <section class="section">
          <h3 class="section-title">边界</h3>
          <p class="plan-desc">{node.boundary}</p>
        </section>
      {/if}
      {#if node.glossary && node.glossary.length > 0}
        <section class="section">
          <h3 class="section-title">术语表
            <span class="section-count">{node.glossary.length}</span>
          </h3>
          <dl class="glossary-list">
            {#each node.glossary as entry}
              <div class="glossary-entry">
                <dt class="glossary-term">{entry.term}</dt>
                <dd class="glossary-def">{entry.definition}</dd>
              </div>
            {/each}
          </dl>
        </section>
      {/if}
      <section class="section">
        <h3 class="section-title">成员
          <span class="section-count">{contextMembers.length}</span>
        </h3>
        {#if contextMembers.length > 0}
          <div class="member-list">
            {#each contextMembers as m}
              <button class="chip chip-link" onclick={() => jumpTo(m)}>{m.label} <span class="member-id">{m.id}</span></button>
            {/each}
          </div>
        {:else}
          <p class="plan-desc">暂无成员——用节点的 context 字段挂接到此上下文</p>
        {/if}
      </section>
      {#if linkedAdrs.length > 0}
        <section class="section">
          <h3 class="section-title">管辖决策
            <span class="section-count">{linkedAdrs.length}</span>
          </h3>
          <div class="sub-list column">
            {#each linkedAdrs as adr (adr.id)}
              <button class="adr-ref" onclick={() => jumpTo(adr)}>
                <span class="adr-ref-dot" style="background: {statusColorOf(adr.status)}"></span>
                <span class="adr-ref-name" class:superseded={adr.status === "superseded"}>{adr.label}</span>
                <span class="adr-ref-status">{adr.status}</span>
              </button>
            {/each}
          </div>
        </section>
      {/if}
    {:else}
      <!-- Build plan -->
      {#if node.plan?.description}
        <section class="section">
          <h3 class="section-title">计划</h3>
          <Markdown text={node.plan.description} />
          {#if node.plan.output_to && node.plan.output_to.length > 0}
            <div class="sub-list">
              <span class="sub-label">outputs:</span>
              {#each node.plan.output_to as out}
                <span class="chip">{out.artifact} → {out.node}</span>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <!-- Definition of done -->
      {#if node.expected_outcome?.definition_of_done}
        <section class="section">
          <h3 class="section-title">完成标准</h3>
          <ul class="dod-list">
            {#each node.expected_outcome.definition_of_done as item}
              <li><Markdown inline text={item} /></li>
            {/each}
          </ul>
          {#if node.expected_outcome.quality_gates && node.expected_outcome.quality_gates.length > 0}
            <div class="sub-list">
              <span class="sub-label">quality gates:</span>
              {#each node.expected_outcome.quality_gates as gate}
                <span class="chip">{gate.check} · {gate.method}</span>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <!-- Plan inputs / context -->
      {#if (node.plan?.input_from && node.plan.input_from.length > 0) || (node.plan?.required_context && node.plan.required_context.length > 0)}
        <section class="section">
          <h3 class="section-title">输入与上下文</h3>
          {#if node.plan?.input_from && node.plan.input_from.length > 0}
            <div class="sub-list">
              <span class="sub-label">input from:</span>
              {#each node.plan.input_from as inp}
                <span class="chip">{inp.node} · {inp.artifact}</span>
              {/each}
            </div>
          {/if}
          {#if node.plan?.required_context && node.plan.required_context.length > 0}
            <div class="sub-list">
              <span class="sub-label">context:</span>
              {#each node.plan.required_context as ctx}
                <span class="chip">{ctx.key} ← {ctx.source}</span>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <!-- Checkpoints -->
      {#if node.checkpoints && node.checkpoints.length > 0}
        <section class="section">
          <h3 class="section-title">检查点
            <span class="section-count">
              {node.checkpoints.filter((c: Checkpoint) => c.status === 'passed').length}
              /
              {node.checkpoints.length}
            </span>
          </h3>
          <div class="cp-list">
            {#each node.checkpoints as cp}
              <div class="cp-item">
                <span class="cp-icon {cpClass(cp.status)}">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                    <path d={cpIcon(cp.status)} stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
                <div class="cp-body">
                  <span class="cp-label"><Markdown inline text={cp.label} /></span>
                  <span class="cp-status {cpClass(cp.status)}">{cp.status}</span>
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Execution report（交接单，P4-3）-->
      {#if node.execution_report}
        <section class="section">
          <h3 class="section-title">执行报告</h3>
          <Markdown text={node.execution_report.summary || '(no summary)'} />

          {#if node.execution_report.verification}
            <div class="verdict-row">
              <span
                class="verdict-badge {node.execution_report.verification.verdict}"
              >
                {node.execution_report.verification.verdict}
              </span>
              {#if node.execution_report.verification.note}
                <span class="verdict-note"><Markdown inline text={node.execution_report.verification.note} /></span>
              {/if}
            </div>
          {/if}

          {#if node.execution_report.artifacts && node.execution_report.artifacts.length > 0}
            <div class="sub-list">
              <span class="sub-label">artifacts:</span>
              {#each node.execution_report.artifacts as art}
                <span class="chip">{art}</span>
              {/each}
            </div>
          {/if}
          {#if node.execution_report.blockers && node.execution_report.blockers.length > 0}
            <div class="sub-list">
              <span class="sub-label">blockers:</span>
              {#each node.execution_report.blockers as b}
                <span class="chip chip-warn">{b}</span>
              {/each}
            </div>
          {/if}
          {#if node.execution_report.notes}
            <div class="notes-block">
              <div class="sub-label">notes:</div>
              <Markdown text={node.execution_report.notes} />
            </div>
          {/if}
        </section>
      {/if}

      <!-- 管辖决策：decides 打到本节点/所属 context 的 ADR（可跳转） -->
      {#if linkedAdrs.length > 0}
        <section class="section">
          <h3 class="section-title">管辖决策
            <span class="section-count">{linkedAdrs.length}</span>
          </h3>
          <div class="sub-list column">
            {#each linkedAdrs as adr (adr.id)}
              <button class="adr-ref" onclick={() => jumpTo(adr)}>
                <span class="adr-ref-dot" style="background: {statusColorOf(adr.status)}"></span>
                <span class="adr-ref-name" class:superseded={adr.status === "superseded"}>{adr.label}</span>
                <span class="adr-ref-status">{adr.status}</span>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Footer info（工作流顶点专属：attempts/时间戳对知识顶点无意义） -->
      <div class="footer-info">
        <span>
          <span class="footer-label">attempts:</span>
          {node.attempts}/{node.max_attempts}
        </span>
        {#if node.execution_report?.started_at}
          <span>
            <span class="footer-label">started:</span>
            {new Date(node.execution_report.started_at).toLocaleString()}
          </span>
        {/if}
        {#if node.execution_report?.completed_at}
          <span>
            <span class="footer-label">done:</span>
            {new Date(node.execution_report.completed_at).toLocaleString()}
          </span>
        {/if}
        {#if node.created_at}
          <span>
            <span class="footer-label">created:</span>
            {new Date(node.created_at).toLocaleDateString()}
          </span>
        {/if}
      </div>
    {/if}
  </DetailDrawer>
{/if}

<style>
  /* adr_flags / superseded 警告区（状态红仅用于真实失败语义） */
  .adr-flags {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    margin-bottom: var(--sp-4);
    padding: var(--sp-3);
    background: rgba(229, 80, 79, 0.1);
    border: 1px solid rgba(229, 80, 79, 0.4);
    border-radius: var(--r);
  }

  .adr-flag-item {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    line-height: 1.6;
    color: var(--status-failed);
    margin: 0;
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
  }

  .flag-icon {
    flex-shrink: 0;
    margin-top: 3px;
  }

  /* 接替链跳转链接 */
  .chain-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--status-failed);
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-align: left;
  }

  /* Definition of done list */
  .dod-list {
    margin: 0;
    padding-left: 0;
    list-style: none;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--ink);
    line-height: 1.7;
  }

  .dod-list li {
    margin-bottom: var(--sp-2);
    padding-left: var(--sp-4);
    position: relative;
  }

  .dod-list li::before {
    content: "";
    position: absolute;
    left: 2px;
    top: 0.62em;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--ink-faint);
  }

  /* Checkpoints */
  .cp-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .cp-item {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3);
    background: var(--wash-1);
    border-radius: var(--r);
    border: 1px solid var(--line);
    transition: background 0.13s var(--ease-out-quart), border-color 0.13s var(--ease-out-quart);
  }

  .cp-item:hover {
    background: var(--wash-2);
    border-color: var(--line-strong);
  }

  .cp-icon {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 8px;
  }

  .cp-passed {
    background: rgba(52, 201, 100, 0.12);
    color: var(--status-passed);
  }

  .cp-failed {
    background: rgba(229, 80, 79, 0.12);
    color: var(--status-failed);
  }

  .cp-running {
    background: rgba(240, 167, 58, 0.12);
    color: var(--status-running);
    animation: cp-pulse 2s ease-in-out infinite;
  }

  @keyframes cp-pulse {
    0%, 100% { opacity: 0.7; }
    50% { opacity: 1; }
  }

  .cp-pending {
    background: var(--wash-2);
    color: var(--ink-faint);
  }

  .cp-body {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex: 1;
    min-width: 0;
    gap: var(--sp-3);
  }

  .cp-label {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.4;
  }

  .cp-status {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    padding: 2px 9px;
    border-radius: 999px;
    text-transform: lowercase;
    flex-shrink: 0;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .cp-status.cp-passed {
    background: rgba(52, 201, 100, 0.12);
    color: var(--status-passed);
  }

  .cp-status.cp-failed {
    background: rgba(229, 80, 79, 0.12);
    color: var(--status-failed);
  }

  .cp-status.cp-running {
    background: rgba(240, 167, 58, 0.12);
    color: var(--status-running);
  }

  .cp-status.cp-pending {
    background: var(--wash-2);
    color: var(--ink-faint);
  }

  /* Footer */
  .footer-info {
    margin-top: var(--sp-5);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--sp-1) var(--sp-3);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }

  .footer-label {
    color: var(--ink-faint);
    margin-right: var(--sp-1);
    opacity: 0.8;
  }

  /* Verdict（裁决徽标） */
  .verdict-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    margin-bottom: var(--sp-3);
  }

  .verdict-badge {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--track-caps);
    padding: 3px 10px;
    border-radius: 999px;
  }

  .verdict-badge.passed {
    background: rgba(52, 201, 100, 0.14);
    color: var(--status-passed);
    border: 1px solid rgba(52, 201, 100, 0.4);
  }

  .verdict-badge.failed {
    background: rgba(229, 80, 79, 0.14);
    color: var(--status-failed);
    border: 1px solid rgba(229, 80, 79, 0.4);
  }

  .verdict-badge.pending {
    background: rgba(240, 167, 58, 0.14);
    color: var(--status-running);
    border: 1px solid rgba(240, 167, 58, 0.4);
  }

  .verdict-note {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--ink-muted);
  }

  .chip-warn {
    color: var(--status-failed);
    border-color: rgba(229, 80, 79, 0.4);
  }

  .notes-block {
    margin-top: var(--sp-3);
  }

  .notes-block .sub-label {
    margin-bottom: var(--sp-1);
    display: block;
  }

  /* context glossary（节点即文档） */
  .glossary-list {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .glossary-entry {
    background: var(--wash-1);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: var(--sp-2) var(--sp-3);
  }

  .glossary-term {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink);
    letter-spacing: 0.02em;
    margin: 0 0 var(--sp-1);
  }

  .glossary-def {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    line-height: 1.7;
    color: var(--ink-muted);
    margin: 0;
  }

  /* context 成员清单 */
  .member-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  .member-id {
    color: var(--ink-faint);
    font-size: var(--text-2xs);
  }

  /* 管辖决策引用行（ADR 跳转） */
  .sub-list.column {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    align-items: stretch;
  }

  .adr-ref {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    background: var(--wash-1);
    border: 1px solid var(--line);
    border-radius: var(--r);
    cursor: pointer;
    text-align: left;
    transition: background 0.13s var(--ease-out-quart), border-color 0.13s var(--ease-out-quart);
  }

  .adr-ref:hover {
    background: var(--wash-2);
    border-color: var(--line-strong);
  }

  .adr-ref:focus-visible {
    outline: 2px solid var(--interactive);
    outline-offset: 1px;
  }

  .adr-ref-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .adr-ref-name {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--ink);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .adr-ref-name.superseded {
    text-decoration: line-through;
    color: var(--ink-faint);
  }

  .adr-ref-status {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    flex-shrink: 0;
    text-transform: lowercase;
  }

  @media (prefers-reduced-motion: reduce) {
    .cp-icon.cp-running {
      animation: none;
    }
  }
</style>
