// web-ui/src/components/adr-document.test.ts
// AdrDocument 回归：ADR 唯一详情通道——状态横幅三态、五段 Markdown、
// GOVERNS 管辖清单跳转、superseded 接替链、孤儿提示。
import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import AdrDocument from "./AdrDocument.svelte";
import { graphState } from "../lib/store.svelte";
import type { NodeSchema, EdgeSchema, GraphIndex } from "../lib/types";

function adrNode(status: NodeSchema["status"], extra: Partial<NodeSchema> = {}): NodeSchema {
	return {
		id: "adr_0001",
		type: "adr",
		label: "三工具集成采用分别手写维护",
		level: 1,
		status,
		attempts: 0,
		max_attempts: 0,
		created_at: "2026-08-27T08:24:58.332Z",
		updated_at: "2026-08-27T08:24:58.332Z",
		decision: "pi 维持直写；claude/zcode 独立成型。\n\n- 三家 frontmatter 不通用\n- **手工润色优先**",
		background: "重构对齐时曾推荐生成器路线",
		why: "用户明确裁断：不做生成器",
		consequences: "语义变更需人工同步三处，见 `docs/check.md`",
		...extra,
	};
}

function contextNode(id: string): NodeSchema {
	return { ...adrNode("proposed"), id, type: "context", label: `上下文 ${id}`, decision: undefined };
}

function edgeOf(id: string, source: string, target: string): EdgeSchema {
	return { id, source, target, type: "decides" };
}

let app: ReturnType<typeof mount> | null = null;

function mountDoc(graph?: GraphIndex): HTMLElement {
	if (graph) graphState.setGraph(graph);
	const host = document.createElement("div");
	document.body.appendChild(host);
	app = mount(AdrDocument, { target: host });
	return host;
}

afterEach(() => {
	if (app) unmount(app);
	app = null;
	graphState.resetAll();
	document.body.innerHTML = "";
});

describe("AdrDocument 决策文档抽屉", () => {
	it("ADD-01 非 adr 节点选中 → 不渲染（NodeDetail 卫语句的镜像）", () => {
		graphState.selectNode({ ...adrNode("proposed"), id: "t1", type: "task", max_attempts: 3 });
		const host = mountDoc();
		expect(host.querySelector(".adr-doc")).toBeNull();
	});

	it("ADD-02 proposed 横幅：状态类 + 文案 + 虚线样式锚点类名", () => {
		graphState.selectNode(adrNode("proposed"));
		const host = mountDoc();

		const banner = host.querySelector(".status-banner");
		expect(banner?.classList.contains("st-proposed")).toBe(true);
		expect(banner?.textContent).toContain("PROPOSED");
		expect(banner?.textContent).toContain("待裁决");
		expect((banner as HTMLElement).style.getPropertyValue("--adr-color")).toMatch(/^#/);

		expect(host.querySelector(".doc-title")?.textContent).toContain("三工具集成");
	});

	it("ADD-03 五段正文 Markdown 渲染：DECISION 引言块 + 可选段落出节", () => {
		graphState.selectNode(adrNode("accepted"));
		const host = mountDoc();

		// decision 在引言块内渲染 Markdown
		const quote = host.querySelector(".decision-quote .markdown-body");
		expect(quote).not.toBeNull();
		expect(quote!.querySelector("strong")?.textContent).toBe("手工润色优先");
		expect(quote!.querySelectorAll("ul li")).toHaveLength(2);

		// 有内容的段落全部出节（DECISION + background/why/consequences + GOVERNS；
		// considered_options 缺省不出节，顺序保持字段序）
		const titles = [...host.querySelectorAll(".section-title")].map((t) =>
			t.textContent!.trim(),
		);
		expect(titles).toEqual([
			"决策",
			"背景",
			"为何",
			"后果",
			"管辖 0",
		]);
		// why 是纯文本也走 markdown-body 容器
		const bodies = host.querySelectorAll(".section .markdown-body");
		expect(bodies.length).toBeGreaterThanOrEqual(4);
		// 行内代码不被吞
		expect(host.querySelector(".section .markdown-body code")?.textContent).toBe("docs/check.md");
	});

	it("ADD-04 GOVERNS：decides 出边反查管辖清单，点击跳转到被管对象", () => {
		const c1 = contextNode("ctx_shared");
		const t1 = { ...adrNode("proposed"), id: "f12", type: "task" as const, max_attempts: 3 };
		graphState.selectNode(adrNode("proposed"));
		const host = mountDoc({
			name: "g1",
			nodes: [adrNode("proposed"), c1, t1],
			edges: [edgeOf("e1", "adr_0001", "ctx_shared"), edgeOf("e2", "adr_0001", "f12")],
		});

		const chips = host.querySelectorAll(".govern-chip");
		expect(chips).toHaveLength(2);
		expect(chips[0].querySelector(".govern-kind")?.textContent).toBe("ctx");

		(chips[0] as HTMLButtonElement).click();
		expect(graphState.selectedNode?.id).toBe("ctx_shared");
	});

	it("ADD-05 孤儿 ADR → 孤儿提示而非空清单", () => {
		graphState.selectNode(adrNode("proposed"));
		const host = mountDoc({ name: "g1", nodes: [adrNode("proposed")], edges: [] });

		expect(host.querySelectorAll(".govern-chip")).toHaveLength(0);
		expect(host.querySelector(".orphan-note")?.textContent).toContain("孤儿决策");
	});

	it("ADD-06 superseded：接替链入横幅 + 标题划线", () => {
		graphState.selectNode(adrNode("superseded", { superseded_by: "adr_0002" }));
		const host = mountDoc();

		const banner = host.querySelector(".status-banner");
		expect(banner?.classList.contains("st-superseded")).toBe(true);
		expect(banner?.querySelector(".banner-successor code")?.textContent).toBe("adr_0002");
		expect(host.querySelector(".doc-title")?.classList.contains("strike")).toBe(true);
	});
});
