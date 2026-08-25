// web-ui/src/lib/components/markdown.test.ts
// Markdown 组件回归：plan 板块的 Markdown 渲染。
// 1) 结构渲染——标题/列表/代码/引用/表格/任务清单真实进 DOM；
// 2) 排版语义——单换行 = 视觉换行（breaks:true，LLM 书写习惯）；
// 3) XSS 防线——源文本不可信（手编 YAML/LLM 输出），script/事件处理器/
//    javascript: 协议链接必须被 DOMPurify 剥除；
// 4) 链接安全——外链一律 target=_blank + rel=noopener noreferrer。
import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import Markdown from "./Markdown.svelte";

function render(text: string): HTMLElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	mount(Markdown, { target: host, props: { text } });
	return host;
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("Markdown 渲染（plan 板块）", () => {
	it("MD-01 标题/加粗/行内代码/列表/引用/分隔线进 DOM", () => {
		const host = render(
			"# 一级标题\n\n## 二级标题\n\n**加粗** 与 `code`\n\n- 甲\n- 乙\n\n1. 一\n2. 二\n\n> 引用行\n\n---",
		);
		expect(host.querySelector("h1")?.textContent).toBe("一级标题");
		expect(host.querySelector("h2")?.textContent).toBe("二级标题");
		expect(host.querySelector("strong")?.textContent).toBe("加粗");
		expect(host.querySelector("code")?.textContent).toBe("code");
		expect(host.querySelectorAll("ul li")).toHaveLength(2);
		expect(host.querySelectorAll("ol li")).toHaveLength(2);
		expect(host.querySelector("blockquote")?.textContent).toContain("引用行");
		expect(host.querySelector("hr")).not.toBeNull();
	});

	it("MD-02 围栏代码块保留原文与换行", () => {
		const host = render("```ts\nconst a = 1;\n```");
		const pre = host.querySelector("pre");
		expect(pre).not.toBeNull();
		expect(pre!.textContent).toContain("const a = 1;");
	});

	it("MD-03 单换行渲染为视觉换行（LLM 书写习惯：硬换行分段）", () => {
		const host = render("第一行\n第二行");
		expect(host.querySelector("br")).not.toBeNull();
		expect(host.querySelector(".markdown-body")?.textContent).toContain("第一行");
		expect(host.querySelector(".markdown-body")?.textContent).toContain("第二行");
	});

	it("MD-04 GFM：表格与任务清单", () => {
		const host = render(
			"| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] 完成\n- [ ] 待办",
		);
		expect(host.querySelectorAll("table th")).toHaveLength(2);
		expect(host.querySelector("table td")?.textContent).toBe("1");
		const boxes = host.querySelectorAll("input[type=checkbox]");
		expect(boxes).toHaveLength(2);
		expect((boxes[0] as HTMLInputElement).checked).toBe(true);
	});

	it("MD-05 XSS：script 标签被剥除", () => {
		const host = render("正文<script>window.__pwned = true</script>尾");
		expect(host.querySelector("script")).toBeNull();
		expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
		expect(host.textContent).toContain("正文");
	});

	it("MD-06 XSS：事件处理器属性被剥除", () => {
		const host = render('<img src="x" onerror="window.__pwned = true">');
		const img = host.querySelector("img");
		expect(img).not.toBeNull();
		expect(img!.getAttribute("onerror")).toBeNull();
	});

	it("MD-07 XSS：javascript: 协议链接被中和", () => {
		const host = render("[点我](javascript:alert(1))");
		const a = host.querySelector("a");
		expect(a).not.toBeNull();
		const href = a!.getAttribute("href") ?? "";
		expect(href).not.toMatch(/^javascript:/i);
	});

	it("MD-08 合法外链加 target=_blank + rel=noopener", () => {
		const host = render("[文档](https://example.com/doc)");
		const a = host.querySelector("a");
		expect(a?.getAttribute("href")).toBe("https://example.com/doc");
		expect(a?.getAttribute("target")).toBe("_blank");
		expect(a?.getAttribute("rel")).toContain("noopener");
	});

	it("MD-09 排版命名空间隔离：样式类仅作用于 .markdown-body 内", () => {
		const host = render("普通文字");
		expect(host.querySelector(".markdown-body")).not.toBeNull();
		// 空文本不产出空白段落
		const empty = render("");
		expect(empty.querySelector(".markdown-body")?.textContent).toBe("");
	});

	it("MD-10 inline 模式：只渲染行内语法，不产生块级包裹", () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		mount(Markdown, {
			target: host,
			props: { text: "**加粗** 与 `code` 与 [链接](https://a.b)", inline: true },
		});
		expect(host.querySelector("p")).toBeNull(); // 无段落包裹
		expect(host.querySelector("h1")).toBeNull();
		expect(host.querySelector("strong")?.textContent).toBe("加粗");
		expect(host.querySelector("code")?.textContent).toBe("code");
		const a = host.querySelector("a");
		expect(a?.getAttribute("href")).toBe("https://a.b");
		expect(a?.getAttribute("target")).toBe("_blank");
		// 容器为行内 span（可嵌 li/label 等结构化容器）
		const body = host.querySelector(".markdown-inline");
		expect(body?.tagName).toBe("SPAN");
	});

	it("MD-11 inline 模式同样消毒：javascript: 协议与标签被中和", () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		mount(Markdown, {
			target: host,
			props: { text: '<img src=x onerror="window.__pwned=true">[x](javascript:alert(1))', inline: true },
		});
		const img = host.querySelector("img");
		expect(img === null || img.getAttribute("onerror") === null).toBe(true);
		const a = host.querySelector("a");
		expect(a === null || !(a.getAttribute("href") ?? "").match(/^javascript:/i)).toBe(true);
	});
});
