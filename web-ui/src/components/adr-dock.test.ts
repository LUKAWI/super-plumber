// web-ui/src/components/adr-dock.test.ts
// AdrDock 回归：左下角 ADR 座按图渲染菱形芯片（三态样式 / 点击选中 / 空图不渲染 / 折叠）。
import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount, tick } from "svelte";
import AdrDock from "./AdrDock.svelte";
import { graphState } from "../lib/store.svelte";
import type { NodeSchema, EdgeSchema, GraphIndex } from "../lib/types";

function adrNode(id: string, status: NodeSchema["status"], extra: Partial<NodeSchema> = {}): NodeSchema {
	return {
		id,
		type: "adr",
		label: `决策 ${id}`,
		level: 1,
		status,
		attempts: 0,
		max_attempts: 0,
		created_at: "2026-08-27T00:00:00.000Z",
		updated_at: "2026-08-27T00:00:00.000Z",
		...extra,
	};
}

function taskNode(id: string): NodeSchema {
	return { ...adrNode(id, "pending"), type: "task", max_attempts: 3 };
}

function edgeOf(id: string, source: string, target: string): EdgeSchema {
	return { id, source, target, type: "decides" };
}

function graphWith(nodes: NodeSchema[], edges: EdgeSchema[]): GraphIndex {
	return { name: "g1", nodes, edges };
}

let app: ReturnType<typeof mount> | null = null;

function mountDock(): HTMLElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	app = mount(AdrDock, { target: host });
	return host;
}

afterEach(() => {
	if (app) unmount(app);
	app = null;
	graphState.resetAll();
	document.body.innerHTML = "";
});

describe("AdrDock 左下角 ADR 座", () => {
	it("AD-01 无 ADR 的图 → 整座不渲染", () => {
		graphState.setGraph(graphWith([taskNode("t1")], []));
		const host = mountDock();
		expect(host.querySelector(".adr-dock")).toBeNull();
	});

	it("AD-02 每 ADR 一枚芯片，状态类与 --adr-color 随三态着色", () => {
		graphState.setGraph(
			graphWith(
				[
					taskNode("t1"),
					adrNode("adr_0002", "accepted"),
					adrNode("adr_0001", "proposed"),
					adrNode("adr_0003", "superseded", { superseded_by: "adr_0002" }),
				],
				[],
			),
		);
		const host = mountDock();

		const chips = host.querySelectorAll(".adr-chip");
		expect(chips).toHaveLength(3);
		expect(chips[0].classList.contains("st-proposed")).toBe(true);
		expect(chips[1].classList.contains("st-accepted")).toBe(true);
		expect(chips[2].classList.contains("st-superseded")).toBe(true);

		// 状态符号（SVG）+ 状态色随三态着色（v0.7：色彩移到 glyph stroke，
		// 不再经 --adr-color 内联变量注入彩色边条）
		for (const chip of chips) {
			const glyph = chip.querySelector(".diamond");
			expect(glyph).not.toBeNull();
			expect(glyph!.getAttribute("stroke")).toMatch(/^var\(--status-|^#/);
		}

		// superseded：标题划线 + 接替者提示
		const sup = chips[2];
		expect(sup.querySelector(".chip-title")?.classList.contains("strike")).toBe(true);
		expect(sup.querySelector(".chip-superseded")?.textContent).toContain("adr_0002");
	});

	it("AD-03 点击芯片 → selectNode 选中原节点对象（路由进决策文档）", async () => {
		const a1 = adrNode("adr_0001", "proposed");
		graphState.setGraph(graphWith([taskNode("t1"), a1], [edgeOf("e1", "adr_0001", "t1")]));
		const host = mountDock();

		(host.querySelector(".adr-chip") as HTMLButtonElement).click();
		expect(graphState.selectedNode?.id).toBe("adr_0001");
		expect(graphState.selectedNode?.type).toBe("adr");

		// 打开的芯片获得 active 高亮（响应式刷新在微任务里落地）
		await tick();
		expect(host.querySelector(".adr-chip.active")).not.toBeNull();
	});

	it("AD-04 折叠：芯片堆收起只剩目录头计数，再点展开", async () => {
		graphState.setGraph(graphWith([adrNode("adr_0001", "proposed")], []));
		const host = mountDock();

		(host.querySelector(".dock-toggle") as HTMLButtonElement).click();
		await tick();
		expect(host.querySelector(".dock-stack")).toBeNull();
		// 计数固定显示在目录头，折叠后仍可见
		expect(host.querySelector(".dock-count")!.textContent).toContain("1");

		(host.querySelector(".dock-toggle") as HTMLButtonElement).click();
		await tick();
		expect(host.querySelector(".dock-stack")).not.toBeNull();
	});
});
