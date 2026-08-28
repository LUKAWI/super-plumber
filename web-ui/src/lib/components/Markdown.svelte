<script lang="ts">
	// Markdown.svelte — 节点文案（plan/decision 等 LLM 或人类书写的自由文本）
	// 的 Markdown 渲染：marked 解析 + DOMPurify 消毒（源文本不可信——手编 YAML/
	// LLM 输出都可能携带 HTML/脚本），渲染结果注入 {@html}。
	// 排版走设计 token（terminal 单色系），与面板其余部分同风格。
	import { marked } from "marked";
	import DOMPurify from "dompurify";

	interface Props {
		/** 源文本（支持 Markdown/GFM：标题、列表、代码、引用、表格、任务清单） */
		text: string;
		/** 行内模式：只渲染行内语法（加粗/斜体/行内代码/链接），不产生块级包裹——
		 * 用于列表条目、checkpoint 标签等已身处结构化容器内的文案 */
		inline?: boolean;
	}

	let { text, inline = false }: Props = $props();

	// 链接一律新窗口 + noopener：面板内跳转会吞掉当前 SPA 视图，且防反链攻击。
	// hook 注册于模块作用域；幂等性由 DOMPurify 自身保证（同名钩子多次注册仅执行
	// 一次的逻辑不成立——实际是追加，但 hook 内操作幂等，重复执行无副作用）。
	DOMPurify.addHook("afterSanitizeAttributes", (node) => {
		if (node.tagName === "A") {
			node.setAttribute("target", "_blank");
			node.setAttribute("rel", "noopener noreferrer");
		}
	});

	// breaks: true —— LLM 书写的 plan 常以单换行分段（非双换行段落），
	// 关闭会把硬换行折进同一行；开启后源换行即视觉换行，与书写者意图一致。
	// inline 模式走 parseInline：无 <p> 包裹，产物直接嵌进行内容器。
	const html = $derived(
		DOMPurify.sanitize(
			inline
				? marked.parseInline(text, { async: false })
				: marked.parse(text, { async: false, breaks: true }),
		),
	);
</script>

{#if inline}
	<span class="markdown-body markdown-inline">{@html html}</span>
{:else}
	<div class="markdown-body">
		{@html html}
	</div>
{/if}

<style>
	/* {@html} 注入的内容不带 Svelte 作用域类，样式须 :global 锚定在
	 .markdown-body 命名空间下，避免泄漏到面板其他文案。 */
	:global(.markdown-body) {
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		line-height: 1.7;
		color: var(--ink);
		overflow-wrap: break-word;
	}

	:global(.markdown-body > *:first-child) {
		margin-top: 0;
	}
	:global(.markdown-body > *:last-child) {
		margin-bottom: 0;
	}

	/* 行内模式：嵌在列表条目/标签等结构化容器内，只做行内元素渲染 */
	:global(.markdown-inline) {
		display: inline;
	}
	:global(.markdown-inline > *) {
		display: inline;
		margin: 0;
	}

	:global(.markdown-body h1),
	:global(.markdown-body h2),
	:global(.markdown-body h3),
	:global(.markdown-body h4),
	:global(.markdown-body h5),
	:global(.markdown-body h6) {
		font-family: var(--font-sans);
		font-weight: 600;
		letter-spacing: var(--track-tight);
		color: var(--ink);
		margin: var(--sp-4) 0 var(--sp-2);
	}
	:global(.markdown-body h1) {
		font-size: var(--text-lg);
		padding-bottom: var(--sp-2);
		border-bottom: 1px solid var(--line);
	}
	:global(.markdown-body h2) {
		font-size: var(--text-md);
	}
	:global(.markdown-body h3),
	:global(.markdown-body h4),
	:global(.markdown-body h5),
	:global(.markdown-body h6) {
		font-size: var(--text-base);
		color: var(--ink-muted);
	}

	:global(.markdown-body p) {
		margin: 0 0 var(--sp-2);
	}

	:global(.markdown-body ul),
	:global(.markdown-body ol) {
		margin: 0 0 var(--sp-3);
		padding-left: var(--sp-5);
	}
	:global(.markdown-body ul) {
		list-style: disc;
	}
	:global(.markdown-body ol) {
		list-style: decimal;
	}
	:global(.markdown-body li) {
		margin: var(--sp-1) 0;
	}
	:global(.markdown-body li > ul),
	:global(.markdown-body li > ol) {
		margin-bottom: 0;
	}
	/* GFM 任务清单：checkbox 与文字基线对齐 */
	:global(.markdown-body li:has(> input[type="checkbox"])) {
		list-style: none;
		margin-left: calc(-1 * var(--sp-4));
	}
	:global(.markdown-body input[type="checkbox"]) {
		margin-right: var(--sp-2);
		accent-color: var(--ink-muted);
		vertical-align: -2px;
	}

	:global(.markdown-body strong) {
		font-weight: 650;
		color: var(--ink);
	}
	:global(.markdown-body em) {
		font-style: italic;
		color: var(--ink-muted);
	}

	:global(.markdown-body code) {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		background: var(--surface-2);
		color: var(--ink);
		padding: 1px var(--sp-1);
		border-radius: var(--r-sm);
		border: 1px solid var(--line);
	}
	:global(.markdown-body pre) {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.6;
		background: var(--surface-1);
		border: 1px solid var(--line);
		border-radius: var(--r);
		padding: var(--sp-3);
		margin: 0 0 var(--sp-3);
		overflow-x: auto;
	}
	:global(.markdown-body pre code) {
		background: none;
		border: none;
		padding: 0;
		font-size: inherit;
		color: var(--ink);
	}

	:global(.markdown-body blockquote) {
		margin: 0 0 var(--sp-3);
		padding: var(--sp-1) 0 var(--sp-1) var(--sp-3);
		border-left: 2px solid var(--line-strong);
		color: var(--ink-muted);
	}
	:global(.markdown-body blockquote p:last-child) {
		margin-bottom: 0;
	}

	:global(.markdown-body a) {
		color: var(--status-ready);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	:global(.markdown-body a:hover) {
		color: var(--ink);
	}

	:global(.markdown-body hr) {
		border: none;
		border-top: 1px solid var(--line);
		margin: var(--sp-4) 0;
	}

	:global(.markdown-body table) {
		border-collapse: collapse;
		width: 100%;
		margin: 0 0 var(--sp-3);
		font-size: var(--text-xs);
	}
	:global(.markdown-body th),
	:global(.markdown-body td) {
		border: 1px solid var(--line);
		padding: var(--sp-1) var(--sp-2);
		text-align: left;
	}
	:global(.markdown-body th) {
		color: var(--ink-muted);
		background: var(--surface-2);
		font-weight: 600;
	}

	:global(.markdown-body del) {
		color: var(--ink-faint);
	}

	:global(.markdown-body img) {
		max-width: 100%;
		border-radius: var(--r);
	}
</style>
