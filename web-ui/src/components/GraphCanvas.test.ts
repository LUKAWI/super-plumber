// GraphCanvas 中键平移回归：只通过组件公开的 SVG/pointer/DOM 行为验证，
// 不读取组件私有状态。每个垂直切片遵循红 → 绿：先证明既有实现不满足规格，
// 再用最小实现让该行为通过。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, unmount } from "svelte";
import GraphCanvas from "./GraphCanvas.svelte";
import { graphState } from "../lib/store.svelte";
import type { GraphIndex } from "../lib/types";

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

// jsdom 不提供 SVG viewBox.baseVal；这是 d3-zoom 在客户端过渡中读取的公开 DOM 面。
Object.defineProperty(SVGSVGElement.prototype, "viewBox", {
	configurable: true,
	get(this: SVGSVGElement) {
		const nums = (this.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
		const [x = 0, y = 0, width = 960, height = 680] = nums;
		return { baseVal: { x, y, width, height } };
	},
});

function canvasGraph(): GraphIndex {
	return {
		name: "canvas-gesture",
		nodes: [
			{
				id: "canvas-node",
				type: "task",
				label: "画布节点",
				level: 1,
				status: "pending",
				attempts: 0,
				max_attempts: 3,
				created_at: "2026-09-05T00:00:00.000Z",
				updated_at: "2026-09-05T00:00:00.000Z",
			},
		],
		edges: [],
		adjacency: {},
		reverseAdj: {},
	} as unknown as GraphIndex;
}

function pointerEvent(
	type: string,
	options: {
		button: number;
		clientX: number;
		clientY: number;
		pointerId: number;
		pointerType?: string;
	},
): PointerEvent {
	const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
	for (const [key, value] of Object.entries({
		...options,
		pointerType: options.pointerType ?? "mouse",
		isPrimary: true,
	})) {
		Object.defineProperty(event, key, { configurable: true, value });
	}
	return event;
}

describe("GraphCanvas 中键平移（公开 pointer/DOM seam）", () => {
	let app: ReturnType<typeof mount> | null = null;

	beforeEach(() => {
		document.body.innerHTML = "";
		graphState.resetAll();
		graphState.setLayoutPinned(true);
	});

	afterEach(() => {
		if (app) unmount(app);
		app = null;
		graphState.resetAll();
	});

	async function mountedCanvas(layoutPinned = true): Promise<SVGSVGElement> {
		graphState.setLayoutPinned(layoutPinned);
		app = mount(GraphCanvas, { target: document.body });
		graphState.applyFull("canvas-gesture", canvasGraph());
		await vi.waitFor(() => {
			expect(document.querySelector("text.node-label")).not.toBeNull();
		});
		return document.querySelector<SVGSVGElement>("svg.graph-canvas")!;
	}

	function zoomTransform(): string {
		return document.querySelector<SVGGElement>("g.zoom-group")?.getAttribute("transform") ?? "";
	}

	it("中键 pointer 移动连续平移并在 pointerup 释放 capture", async () => {
		const svg = await mountedCanvas();
		const setPointerCapture = vi.fn();
		const releasePointerCapture = vi.fn();
		Object.defineProperty(svg, "setPointerCapture", { configurable: true, value: setPointerCapture });
		Object.defineProperty(svg, "hasPointerCapture", {
			configurable: true,
			value: vi.fn(() => true),
		});
		Object.defineProperty(svg, "releasePointerCapture", { configurable: true, value: releasePointerCapture });

		svg.dispatchEvent(pointerEvent("pointerdown", {
			button: 1,
			clientX: 100,
			clientY: 120,
			pointerId: 7,
		}));
		svg.dispatchEvent(pointerEvent("pointermove", {
			button: 1,
			clientX: 132,
			clientY: 151,
			pointerId: 7,
		}));

		expect(setPointerCapture).toHaveBeenCalledWith(7);
		expect(zoomTransform()).toContain("translate(32,31)");

		document.dispatchEvent(pointerEvent("pointerup", {
			button: 1,
			clientX: 132,
			clientY: 151,
			pointerId: 7,
		}));
		expect(releasePointerCapture).toHaveBeenCalledWith(7);

		const node = document.querySelector<SVGGElement>("g.node")!;
		const beforeNodePan = zoomTransform();
		node.dispatchEvent(pointerEvent("pointerdown", {
			button: 1,
			clientX: 200,
			clientY: 210,
			pointerId: 8,
		}));
		node.dispatchEvent(pointerEvent("pointermove", {
			button: 1,
			clientX: 218,
			clientY: 226,
			pointerId: 8,
		}));
		expect(setPointerCapture).toHaveBeenCalledWith(8);
		expect(zoomTransform()).not.toBe(beforeNodePan);
		document.dispatchEvent(pointerEvent("pointerup", {
			button: 1,
			clientX: 218,
			clientY: 226,
			pointerId: 8,
		}));
	});

	it("pointerleave 与 pointercancel 都结束平移，下一次中键可重新 capture", async () => {
		const svg = await mountedCanvas();
		const setPointerCapture = vi.fn();
		const releasePointerCapture = vi.fn();
		Object.defineProperty(svg, "setPointerCapture", { configurable: true, value: setPointerCapture });
		Object.defineProperty(svg, "releasePointerCapture", { configurable: true, value: releasePointerCapture });

		svg.dispatchEvent(pointerEvent("pointerdown", {
			button: 1,
			clientX: 20,
			clientY: 30,
			pointerId: 11,
		}));
		svg.dispatchEvent(pointerEvent("pointermove", {
			button: 1,
			clientX: 25,
			clientY: 35,
			pointerId: 11,
		}));
		svg.dispatchEvent(pointerEvent("pointerleave", {
			button: 1,
			clientX: 25,
			clientY: 35,
			pointerId: 11,
		}));

		svg.dispatchEvent(pointerEvent("pointerdown", {
			button: 1,
			clientX: 30,
			clientY: 40,
			pointerId: 13,
		}));
		svg.dispatchEvent(pointerEvent("lostpointercapture", {
			button: 1,
			clientX: 30,
			clientY: 40,
			pointerId: 13,
		}));

		svg.dispatchEvent(pointerEvent("pointerdown", {
			button: 1,
			clientX: 40,
			clientY: 45,
			pointerId: 12,
		}));
		svg.dispatchEvent(pointerEvent("pointermove", {
			button: 1,
			clientX: 52,
			clientY: 60,
			pointerId: 12,
		}));
		svg.dispatchEvent(pointerEvent("pointercancel", {
			button: 1,
			clientX: 52,
			clientY: 60,
			pointerId: 12,
		}));

		expect(setPointerCapture).toHaveBeenNthCalledWith(1, 11);
		expect(setPointerCapture).toHaveBeenNthCalledWith(2, 13);
		expect(setPointerCapture).toHaveBeenNthCalledWith(3, 12);
		expect(releasePointerCapture).toHaveBeenCalledWith(11);
		expect(releasePointerCapture).toHaveBeenCalledWith(13);
		expect(releasePointerCapture).toHaveBeenCalledWith(12);
		expect(zoomTransform()).toContain("translate(17,20)");
	});

	it("中键平移会接管未钉住布局的自动 fit，不被结算取景覆盖", async () => {
		const svg = await mountedCanvas(false);
		const setPointerCapture = vi.fn();
		const releasePointerCapture = vi.fn();
		Object.defineProperty(svg, "setPointerCapture", { configurable: true, value: setPointerCapture });
		Object.defineProperty(svg, "hasPointerCapture", {
			configurable: true,
			value: vi.fn(() => true),
		});
		Object.defineProperty(svg, "releasePointerCapture", { configurable: true, value: releasePointerCapture });

		svg.dispatchEvent(pointerEvent("pointerdown", {
			button: 1,
			clientX: 100,
			clientY: 120,
			pointerId: 30,
		}));
		svg.dispatchEvent(pointerEvent("pointermove", {
			button: 1,
			clientX: 124,
			clientY: 138,
			pointerId: 30,
		}));
		const afterPan = zoomTransform();
		document.dispatchEvent(pointerEvent("pointerup", {
			button: 1,
			clientX: 124,
			clientY: 138,
			pointerId: 30,
		}));

		await new Promise((resolve) => setTimeout(resolve, 1200));
		expect(zoomTransform()).toBe(afterPan);
		expect(setPointerCapture).toHaveBeenCalledWith(30);
		expect(releasePointerCapture).toHaveBeenCalledWith(30);
	});

	it("左键不平移且仍可选节点，滚轮缩放、右键菜单和触控入口不被中键逻辑拦截", async () => {
		const svg = await mountedCanvas();
		const setPointerCapture = vi.fn();
		Object.defineProperty(svg, "setPointerCapture", { configurable: true, value: setPointerCapture });

		const beforeLeft = zoomTransform();
		svg.dispatchEvent(pointerEvent("pointerdown", {
			button: 0,
			clientX: 100,
			clientY: 100,
			pointerId: 21,
		}));
		svg.dispatchEvent(pointerEvent("pointermove", {
			button: 0,
			clientX: 170,
			clientY: 165,
			pointerId: 21,
		}));
		svg.dispatchEvent(new MouseEvent("mousedown", {
			bubbles: true,
			button: 0,
			clientX: 100,
			clientY: 100,
		}));
		document.dispatchEvent(new MouseEvent("mousemove", {
			bubbles: true,
			clientX: 170,
			clientY: 165,
		}));
		document.dispatchEvent(new MouseEvent("mouseup", {
			bubbles: true,
			button: 0,
			clientX: 170,
			clientY: 165,
		}));
		expect(zoomTransform()).toBe(beforeLeft);
		expect(setPointerCapture).not.toHaveBeenCalled();

		const node = document.querySelector<SVGGElement>("g.node")!;
		node.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
		await vi.waitFor(() => expect(node.classList.contains("is-selected")).toBe(true));

		const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
		svg.dispatchEvent(contextMenu);
		expect(contextMenu.defaultPrevented).toBe(false);

		const beforeWheel = zoomTransform();
		svg.dispatchEvent(new WheelEvent("wheel", {
			bubbles: true,
			cancelable: true,
			deltaY: -120,
			clientX: 200,
			clientY: 180,
		}));
		await vi.waitFor(() => expect(zoomTransform()).not.toBe(beforeWheel));

		const touchBefore = zoomTransform();
		svg.dispatchEvent(pointerEvent("pointerdown", {
			button: 1,
			clientX: 40,
			clientY: 45,
			pointerId: 22,
			pointerType: "touch",
		}));
		svg.dispatchEvent(pointerEvent("pointermove", {
			button: 1,
			clientX: 90,
			clientY: 95,
			pointerId: 22,
			pointerType: "touch",
		}));
		expect(zoomTransform()).toBe(touchBefore);
		expect(setPointerCapture).not.toHaveBeenCalled();
	});
});
