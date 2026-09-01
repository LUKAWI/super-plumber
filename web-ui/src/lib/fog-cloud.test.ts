// web-ui/src/lib/fog-cloud.test.ts
// 090-fogui 雾区云团回归：星空对图级 fog 字段的呈现（adr_0007 呈现面）。
// 数据面：fog 挂在 /api/graph 与 ws graph:full/graph:update 载荷顶层（serializeGraphIndex），
// 前端经 graphState.applyFull 落桶——本文件以同路径注入，覆盖三种场景：
// 1) 有 fog → 虚线云团真实渲染进 DOM（云体/标签/tooltip，且置于最底层不遮星体）；
// 2) 无 fog → 零渲染零 DOM 残留；
// 3) 毕业（fog_graduated 后 /api/graph 刷新，载荷不再带 fog）→ 云团自动消失。
// 组件挂载与桩（WebSocket/matchMedia/ResizeObserver）与 render-smoke.test.ts 同款。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, unmount } from "svelte";
import App from "../App.svelte";
import { graphState } from "./store.svelte";
import type { GraphIndex } from "./types";

class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((e: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(public url: string) {
		FakeWebSocket.instances.push(this);
	}
	send(): void {}
	close(): void {
		this.onclose?.();
	}
}
vi.stubGlobal("WebSocket", FakeWebSocket);

vi.stubGlobal(
	"matchMedia",
	(query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	}) as unknown as typeof window.matchMedia,
);
vi.stubGlobal(
	"ResizeObserver",
	class ResizeObserver {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	},
);

// jsdom 未实现 SVGSVGElement.viewBox 属性对象：autoFit 的 zoom 过渡（d3-zoom
// defaultExtent 读 viewBox.baseVal）计时器可能在组件卸载后冲刷 → 未处理异常。
// 桩一个按 viewBox 属性解析的最小实现（d3-zoom 只读 baseVal 的 x/y/width/height）。
Object.defineProperty(SVGSVGElement.prototype, "viewBox", {
	configurable: true,
	get(this: SVGSVGElement) {
		const nums = (this.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
		const [x = 0, y = 0, width = 960, height = 680] = nums;
		return { baseVal: { x, y, width, height } };
	},
});

const FOG = {
	id: "release-automation",
	description: "发布自动化的验收口径还没想清楚",
	graduation: "验收清单评审通过并落成节点",
	ignited: ["r1"],
};

function fogGraph(withFog: boolean): GraphIndex {
	return {
		name: "foggy",
		label: "雾图",
		...(withFog ? { fog: { ...FOG, ignited: [...FOG.ignited] } } : {}),
		nodes: [
			{
				id: "f-1",
				type: "task",
				label: "雾图节点一",
				level: 1,
				status: "pending",
				attempts: 0,
				max_attempts: 3,
				created_at: "2026-09-01T00:00:00.000Z",
				updated_at: "2026-09-01T00:00:00.000Z",
			},
			{
				id: "f-2",
				type: "task",
				label: "雾图节点二",
				level: 1,
				status: "pending",
				attempts: 0,
				max_attempts: 3,
				created_at: "2026-09-01T00:00:00.000Z",
				updated_at: "2026-09-01T00:00:00.000Z",
			},
		],
		edges: [],
		adjacency: {},
		reverseAdj: {},
	};
}

describe("雾区云团（090-fogui：星空呈现图级 fog 字段）", () => {
	let app: ReturnType<typeof mount> | null = null;

	beforeEach(() => {
		document.body.innerHTML = "";
		graphState.resetAll();
		FakeWebSocket.instances.length = 0;
	});

	afterEach(() => {
		if (app) unmount(app);
		app = null;
	});

	it("FC-01 有 fog：虚线云团渲染（云体/标签/最底层不遮星体，hover 出 id+描述 tooltip）", async () => {
		app = mount(App, { target: document.body });
		// 与 ws onGraph 处理器同路径注入全量数据
		graphState.applyFull("foggy", fogGraph(true));
		await vi.waitFor(() => {
			expect(document.querySelector("g.fog-cloud")).not.toBeNull();
		});
		// 云体：SVG 虚线描边椭圆（径向渐变雾芯）
		const body = document.querySelector("ellipse.fog-body");
		expect(body).not.toBeNull();
		expect(body?.getAttribute("stroke-dasharray")).toBe("6 5");
		expect(body?.getAttribute("fill")).toBe("url(#fog-grad)");
		expect(document.querySelector("#fog-grad")).not.toBeNull();
		// 云上标签：雾 id
		const label = document.querySelector("text.fog-label");
		expect(label?.textContent).toContain("release-automation");
		// 分层：云团插在 zoomGroup 最底层（hulls/edges/nodes 之前），即便相交也压不到星体
		const zoom = document.querySelector(".graph-canvas .zoom-group");
		expect(zoom?.firstElementChild?.classList.contains("fog-cloud")).toBe(true);
		// hover 命中域 → tooltip 展示雾 id + 描述 + 毕业条件
		const hit = document.querySelector("ellipse.fog-hit");
		expect(hit?.getAttribute("aria-label")).toContain(FOG.description);
		hit?.dispatchEvent(
			new MouseEvent("mouseenter", { bubbles: true, clientX: 40, clientY: 40 }),
		);
		const tip = document.querySelector(".node-tooltip");
		expect(tip?.getAttribute("style")).toContain("block");
		expect(tip?.textContent).toContain(FOG.id);
		expect(tip?.textContent).toContain(FOG.description);
		expect(tip?.textContent).toContain(`毕业：${FOG.graduation}`);
		hit?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
		expect(tip?.getAttribute("style")).not.toContain("block");
	});

	it("FC-02 无 fog：零渲染零 DOM 残留", async () => {
		app = mount(App, { target: document.body });
		graphState.applyFull("foggy", fogGraph(false));
		// 先等星体真实渲染（证明画布渲染管线已跑完），再断言无云团
		await vi.waitFor(() => {
			expect(document.querySelector("text.node-label")).not.toBeNull();
		});
		expect(document.querySelector("g.fog-cloud")).toBeNull();
		expect(document.querySelector("ellipse.fog-body")).toBeNull();
		expect(document.querySelector("ellipse.fog-hit")).toBeNull();
		expect(document.querySelector("text.fog-label")).toBeNull();
		expect(document.querySelector("#fog-grad")).toBeNull();
	});

	it("FC-03 毕业联动：数据刷新（载荷不再带 fog）后云团自动消失", async () => {
		app = mount(App, { target: document.body });
		graphState.applyFull("foggy", fogGraph(true));
		await vi.waitFor(() => {
			expect(document.querySelector("g.fog-cloud")).not.toBeNull();
		});
		// fog_graduated 后 /api/graph 刷新：同图同节点集、顶层 fog 字段消失
		// → 走 syncEdges 增量路径，云团连渐变 defs 一并移除
		graphState.applyFull("foggy", fogGraph(false));
		await vi.waitFor(() => {
			expect(document.querySelector("g.fog-cloud")).toBeNull();
		});
		expect(document.querySelector("ellipse.fog-body")).toBeNull();
		expect(document.querySelector("text.fog-label")).toBeNull();
		expect(document.querySelector("#fog-grad")).toBeNull();
		// 星体不受影响（毕业后视图其余部分原样）
		expect(document.querySelector("text.node-label")).not.toBeNull();
	});
});
