// web-ui/src/lib/render-smoke.test.ts
// S0-6 渲染级冒烟回归：jsdom 真实挂载 App 组件。
// 0.5.2 黑屏根因：store getter 在 derived 求值中隐式建桶 → state_unsafe_mutation
// 整树崩溃。store-probe.svelte.ts 覆盖 derived 上下文，本文件补真实组件挂载与
// WS 数据时序：1) 无数据初始挂载不崩（黑屏复现场景）；2) applyFull 后节点标签
// 真实渲染进 DOM。WebSocket 以最小桩替换（jsdom 未实现）——连接不真连，
// 数据注入走与 ws onGraph 处理器完全相同的 graphState.applyFull 路径。
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

// jsdom 缺失的浏览器 API 桩（组件运行所需的最小面）
// - matchMedia：GraphCanvas 实例初始化读取 prefers-reduced-motion
// - ResizeObserver：GraphCanvas 挂载后监听画布容器
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

function miniGraph(): GraphIndex {
	return {
		name: "smoke",
		nodes: [
			{
				id: "smoke-node-1",
				type: "task",
				label: "冒烟节点",
				level: 1,
				status: "pending",
				attempts: 0,
				max_attempts: 3,
				created_at: "2026-08-24T00:00:00.000Z",
				updated_at: "2026-08-24T00:00:00.000Z",
			},
		],
		edges: [],
		adjacency: {},
		reverseAdj: {},
	} as unknown as GraphIndex;
}

function knowledgeOnlyGraph(): GraphIndex {
	return {
		name: "knowledge-only",
		nodes: [
			{
				id: "ctx-boundary",
				type: "context",
				label: "Web 边界",
				level: 0,
				status: "accepted",
				attempts: 0,
				max_attempts: 1,
				created_at: "",
				updated_at: "",
			},
			{
				id: "adr-boundary",
				type: "adr",
				label: "边界契约",
				level: 0,
				status: "accepted",
				attempts: 0,
				max_attempts: 1,
				created_at: "",
				updated_at: "",
			},
		],
		edges: [],
		adjacency: {},
		reverseAdj: {},
	} as unknown as GraphIndex;
}

describe("App 渲染冒烟（S0-6 黑屏回归）", () => {
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

	it("RS-01 无数据初始挂载不崩（0.5.2 黑屏复现场景）", () => {
		expect(() => {
			app = mount(App, { target: document.body });
		}).not.toThrow();
		// 骨架真实渲染：无数据时 App 显示 loading 骨架屏（头部 getter 全部在
		// derived 上下文求值——旧实现在这一步抛 state_unsafe_mutation 整页黑屏）
		expect(document.querySelector(".loading-state .skeleton-graph")).not.toBeNull();
		expect(document.body.textContent).toContain("正在连接拓扑服务");
	});

  it("RS-02 数据到达后节点标签真实渲染（applyFull → DOM 可见）", async () => {
    app = mount(App, { target: document.body });
    // 与 ws onGraph 处理器同路径注入全量数据（首个到达的图成为当前图）
    graphState.applyFull("smoke", miniGraph());
    await vi.waitFor(
      () => {
        const label = document.querySelector("text.node-label");
        expect(label?.textContent).toContain("冒烟节点");
      },
      { timeout: 4000 },
    );
  });

  it("RS-03 前沿一键档：顶栏 chip 渲染前沿计数，点击即过滤（0.8.1 P1-8）", async () => {
    app = mount(App, { target: document.body });
    // pending 无门控入边 = 空门禁自然满足 → 前沿成员
    graphState.applyFull("smoke", miniGraph());
    await vi.waitFor(() => {
      const chip = document.querySelector(".frontier-chip");
      expect(chip).not.toBeNull();
      expect(chip?.getAttribute("aria-pressed")).toBe("false");
      expect(chip?.querySelector(".sb-n")?.textContent).toBe("1");
    });
    // 点击 → 前沿档开启（aria-pressed 翻转；store 桶状态同步）
    document.querySelector<HTMLButtonElement>(".frontier-chip")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector(".frontier-chip")?.getAttribute("aria-pressed")).toBe("true");
      expect(graphState.frontierOnly).toBe(true);
    });
  });

	it("RS-04 同 ID 全量更新重建节点 datum，不残留旧标签/状态", async () => {
		app = mount(App, { target: document.body });
		graphState.applyFull("smoke", miniGraph());
		await vi.waitFor(() => expect(document.querySelector("text.node-label")?.textContent).toContain("冒烟节点"));

		const updated = miniGraph();
		updated.nodes[0] = { ...updated.nodes[0], label: "同 ID 新状态", status: "running" };
		graphState.applyFull("smoke", updated);
		await vi.waitFor(() => {
			expect(document.querySelector("text.node-label")?.textContent).toContain("同 ID 新状态");
			expect(document.querySelector("g.node.st-running")).not.toBeNull();
		});
	});

	it("RS-05 只有 context/ADR 的空知识图显示可恢复空态", async () => {
		app = mount(App, { target: document.body });
		graphState.applyFull("knowledge-only", knowledgeOnlyGraph());
		await vi.waitFor(() => {
			const empty = document.querySelector(".knowledge-empty");
			expect(empty).not.toBeNull();
			expect(empty?.textContent).toContain("空知识图");
		});
		expect(document.querySelector(".lens-empty:not(.knowledge-empty)")).toBeNull();
	});
});
