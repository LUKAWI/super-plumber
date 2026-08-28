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

  // v0.5：context 顶点以文档形态呈现；adr 一律走 AdrDocument 抽屉（根卫语句拦截）
  const isContext = $derived(graphState.selectedNode?.type === "context");

  // adr_flags：superseded ADR 沿 decides 边传播的"决策依据已过时"警告（客户端预计算，纯只读展示）
  const adrFlags = $derived.by(() => {
    const g = graphState.graph;
    const n = graphState.selectedNode;
    if (!g || !n) return [] as string[];
    return adrFlagsFor(g.nodes, g.edges).get(n.id) ?? [];
  });

  // context 成员（归属该上下文的工作流节点）
  const contextMembers = $derived.by(() => {
    const g = graphState.graph;
    const n = graphState.selectedNode;
    if (!g || !n || n.type !== "context") return [] as NodeSchema[];
    return g.nodes.filter((m) => m.context === n.id && !isKnowledgeType(m.type));
  });
</script>

{#if graphState.selectedNode && graphState.selectedNode.type !== "adr"}
  <div class="detail-panel" class:visible>
    <div class="panel-header">
      <span class="panel-title">{isContext ? "上下文详情" : "节点详情"}</span>
      <span class="panel-kbd">Esc 关闭</span>
      <button class="close-btn" onclick={() => graphState.selectNode(null)} aria-label="关闭">
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M3.5 3.5l8 8M11.5 3.5l-8 8" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div class="panel-body">
      <h2 class="node-label">{graphState.selectedNode.label}</h2>

      <!-- Meta tags -->
      <div class="meta-grid">
        <span class="meta-tag id-tag">{graphState.selectedNode.id}</span>
        <span class="meta-tag type-tag">{graphState.selectedNode.type}</span>
        <span class="meta-tag level-tag">L{graphState.selectedNode.level}</span>
        <span class="meta-tag status-tag"
          style="border-color: {statusColorOf(graphState.selectedNode.status)}">
          <span class="status-dot" style="background: {statusColorOf(graphState.selectedNode.status)}"></span>
          {graphState.selectedNode.status}
        </span>
        {#if graphState.selectedNode.assigned_to}
          <span class="meta-tag assign-tag">{graphState.selectedNode.assigned_to}</span>
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

      <!-- context 顶点：节点即文档（boundary 全文 + glossary 全部术语 + 成员清单） -->
      {#if isContext}
        {#if graphState.selectedNode.boundary}
          <section class="section">
            <h3 class="section-title">边界
              <span class="section-count">boundary</span>
            </h3>
            <p class="plan-desc">{graphState.selectedNode.boundary}</p>
          </section>
        {/if}
        {#if graphState.selectedNode.glossary && graphState.selectedNode.glossary.length > 0}
          <section class="section">
            <h3 class="section-title">术语表
              <span class="section-count">{graphState.selectedNode.glossary.length}</span>
            </h3>
            <dl class="glossary-list">
              {#each graphState.selectedNode.glossary as entry}
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
                <span class="chip member-chip">{m.label} <span class="member-id">{m.id}</span></span>
              {/each}
            </div>
          {:else}
            <p class="plan-desc">暂无成员——用节点的 context 字段挂接到此上下文</p>
          {/if}
        </section>
      {/if}

      <!-- adr 顶点不在此呈现：选中即路由到 AdrDocument 决策文档抽屉 -->

      <!-- Build plan -->
      {#if graphState.selectedNode.plan?.description}
        <section class="section">
          <h3 class="section-title">计划</h3>
          <Markdown text={graphState.selectedNode.plan.description} />
          {#if graphState.selectedNode.plan.output_to && graphState.selectedNode.plan.output_to.length > 0}
            <div class="sub-list">
              <span class="sub-label">outputs:</span>
              {#each graphState.selectedNode.plan.output_to as out}
                <span class="chip">{out.artifact} → {out.node}</span>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <!-- Definition of done -->
      {#if graphState.selectedNode.expected_outcome?.definition_of_done}
        <section class="section">
          <h3 class="section-title">完成标准</h3>
          <ul class="dod-list">
            {#each graphState.selectedNode.expected_outcome.definition_of_done as item}
              <li><Markdown inline text={item} /></li>
            {/each}
          </ul>
          {#if graphState.selectedNode.expected_outcome.quality_gates && graphState.selectedNode.expected_outcome.quality_gates.length > 0}
            <div class="sub-list">
              <span class="sub-label">quality gates:</span>
              {#each graphState.selectedNode.expected_outcome.quality_gates as gate}
                <span class="chip">{gate.check} · {gate.method}</span>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <!-- Plan inputs / context -->
      {#if (graphState.selectedNode.plan?.input_from && graphState.selectedNode.plan.input_from.length > 0) || (graphState.selectedNode.plan?.required_context && graphState.selectedNode.plan.required_context.length > 0)}
        <section class="section">
          <h3 class="section-title">输入与上下文</h3>
          {#if graphState.selectedNode.plan?.input_from && graphState.selectedNode.plan.input_from.length > 0}
            <div class="sub-list">
              <span class="sub-label">input from:</span>
              {#each graphState.selectedNode.plan.input_from as inp}
                <span class="chip">{inp.node} · {inp.artifact}</span>
              {/each}
            </div>
          {/if}
          {#if graphState.selectedNode.plan?.required_context && graphState.selectedNode.plan.required_context.length > 0}
            <div class="sub-list">
              <span class="sub-label">context:</span>
              {#each graphState.selectedNode.plan.required_context as ctx}
                <span class="chip">{ctx.key} ← {ctx.source}</span>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <!-- Checkpoints -->
      {#if graphState.selectedNode.checkpoints && graphState.selectedNode.checkpoints.length > 0}
        <section class="section">
          <h3 class="section-title">检查点
            <span class="section-count">
              {graphState.selectedNode.checkpoints.filter((c: Checkpoint) => c.status === 'passed').length}
              /
              {graphState.selectedNode.checkpoints.length}
            </span>
          </h3>
          <div class="cp-list">
            {#each graphState.selectedNode.checkpoints as cp}
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
      {#if graphState.selectedNode.execution_report}
        <section class="section">
          <h3 class="section-title">执行报告</h3>
          <Markdown text={graphState.selectedNode.execution_report.summary || '(no summary)'} />

          {#if graphState.selectedNode.execution_report.verification}
            <div class="verdict-row">
              <span
                class="verdict-badge {graphState.selectedNode.execution_report.verification.verdict}"
              >
                {graphState.selectedNode.execution_report.verification.verdict}
              </span>
              {#if graphState.selectedNode.execution_report.verification.note}
                <span class="verdict-note"><Markdown inline text={graphState.selectedNode.execution_report.verification.note} /></span>
              {/if}
            </div>
          {/if}

          {#if graphState.selectedNode.execution_report.artifacts && graphState.selectedNode.execution_report.artifacts.length > 0}
            <div class="sub-list">
              <span class="sub-label">artifacts:</span>
              {#each graphState.selectedNode.execution_report.artifacts as art}
                <span class="chip">{art}</span>
              {/each}
            </div>
          {/if}
          {#if graphState.selectedNode.execution_report.blockers && graphState.selectedNode.execution_report.blockers.length > 0}
            <div class="sub-list">
              <span class="sub-label">blockers:</span>
              {#each graphState.selectedNode.execution_report.blockers as b}
                <span class="chip chip-warn">{b}</span>
              {/each}
            </div>
          {/if}
          {#if graphState.selectedNode.execution_report.notes}
            <div class="notes-block">
              <div class="sub-label">notes:</div>
              <Markdown text={graphState.selectedNode.execution_report.notes} />
            </div>
          {/if}
        </section>
      {/if}

      <!-- Footer info（工作流顶点专属：attempts/时间戳对知识顶点无意义） -->
      {#if !isContext}
      <div class="footer-info">
        <span>
          <span class="footer-label">attempts:</span>
          {graphState.selectedNode.attempts}/{graphState.selectedNode.max_attempts}
        </span>
        {#if graphState.selectedNode.execution_report?.started_at}
          <span>
            <span class="footer-label">started:</span>
            {new Date(graphState.selectedNode.execution_report.started_at).toLocaleString()}
          </span>
        {/if}
        {#if graphState.selectedNode.execution_report?.completed_at}
          <span>
            <span class="footer-label">done:</span>
            {new Date(graphState.selectedNode.execution_report.completed_at).toLocaleString()}
          </span>
        {/if}
        {#if graphState.selectedNode.created_at}
          <span>
            <span class="footer-label">created:</span>
            {new Date(graphState.selectedNode.created_at).toLocaleDateString()}
          </span>
        {/if}
      </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .detail-panel {
    position: fixed;
    right: 0;
    top: var(--header-h);
    bottom: 0;
    width: 380px;
    background: var(--surface-1);
    border-left: 1px solid var(--line);
    color: var(--ink);
    display: flex;
    flex-direction: column;
    z-index: var(--z-panel);
    transform: translateX(100%);
    transition: transform 0.22s var(--ease-out-quint);
  }

  .detail-panel.visible {
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

  .close-btn:active {
    background: var(--surface-3);
  }

  .panel-body {
    padding: var(--sp-5);
    overflow-y: auto;
    flex: 1;
  }

  .node-label {
    font-family: var(--font-sans);
    font-size: var(--text-xl);
    font-weight: 700;
    margin: 0 0 var(--sp-4);
    color: var(--ink);
    line-height: 1.25;
    letter-spacing: var(--track-tight);
    text-wrap: balance;
  }

  /* Meta tags */
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
    letter-spacing: 0.02em;
  }

  .id-tag {
    color: var(--ink);
    border-color: var(--line-strong);
    background: var(--surface-2);
  }

  .status-tag {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    text-transform: lowercase;
    color: var(--ink);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* Sections（sans 中文小节标题，废除 ▸ mono 大写 eyebrow）*/
  .section {
    margin-bottom: var(--sp-5);
    padding-top: var(--sp-3);
    border-top: 1px solid var(--line);
  }

  .section-title {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 650;
    margin: 0 0 var(--sp-3);
    color: var(--ink);
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
  }

  .section-count {
    margin-left: auto;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }

  .plan-desc {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: 1.7;
    color: var(--ink-muted);
    margin: 0;
  }

  .sub-list {
    margin-top: var(--sp-3);
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
    align-items: center;
  }

  .notes-block {
    margin-top: var(--sp-3);
  }

  .notes-block .sub-label {
    margin-bottom: var(--sp-1);
    display: block;
  }

  .sub-label {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
  }

  .chip {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    background: var(--surface-2);
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--r-sm);
    color: var(--ink-muted);
    border: 1px solid var(--line);
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
    background: var(--surface-2);
    border-radius: var(--r);
    border: 1px solid var(--line);
    transition: background 0.13s var(--ease-out-quart), border-color 0.13s var(--ease-out-quart);
  }

  .cp-item:hover {
    background: var(--surface-2);
    border-color: var(--line-strong);
  }

  .cp-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: var(--r-sm);
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
    background: var(--surface-2);
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
    padding: 2px var(--sp-2);
    border-radius: var(--r-sm);
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
    background: var(--surface-2);
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
    padding: 3px var(--sp-2);
    border-radius: var(--r-sm);
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

  /* adr_flags 警告区 */
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

  /* context glossary（节点即文档） */
  .glossary-list {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .glossary-entry {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
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

  .member-chip {
    display: inline-flex;
    align-items: baseline;
    gap: var(--sp-1);
  }

  .member-id {
    color: var(--ink-faint);
    font-size: var(--text-2xs);
  }

  /* Responsive */
  @media (max-width: 768px) {
    .detail-panel {
      width: 100%;
      max-width: 100%;
      top: 0;
    }
    .footer-info {
      flex-direction: column;
      gap: var(--sp-1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .detail-panel {
      transition: none;
    }
  }
</style>
