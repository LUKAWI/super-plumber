import { describe, it, expect, beforeEach } from "vitest";
import { graphState } from "./store.svelte";
import { DEFAULT_ACTIVE_MAPS } from "./maps";
import { readGraphProbe, readQueryProbe } from "./store-probe.svelte";

// 回归：0.5.2 已发布包前端整页黑屏——Svelte state_unsafe_mutation。
// 根因：store getter 经 cur()→bucketOf() 在桶未命中时 _buckets[name]=newBucket()，
// 该写操作发生在模板表达式（derived）求值期间。修复后读路径返回冻结空桶兜底，
// 建桶只发生在事件/异步上下文（selectGraph/applyFull 等）。
describe("store getter 渲染安全（derived 求值中禁止隐式建桶）", () => {
	beforeEach(() => {
		graphState.resetAll();
	});

	it("derived 求值中读取 getter 不抛 state_unsafe_mutation（旧实现在此崩溃）", () => {
		expect(() => readGraphProbe()).not.toThrow();
		expect(readGraphProbe()).toBeNull();
		expect(() => readQueryProbe()).not.toThrow();
		expect(readQueryProbe()).toBe("");
	});

	it("空桶兜底：resetAll 后各 getter 返回与 newBucket 一致的缺省值", () => {
		expect(graphState.graph).toBeNull();
		expect(graphState.selectedNode).toBeNull();
		expect(graphState.selectedEdge).toBeNull();
		expect(graphState.lastPatched).toBeNull();
		expect(graphState.levelFilter).toBeNull();
		expect(graphState.query).toBe("");
		expect(graphState.diff).toBeNull();
		expect(graphState.snapshots).toBeNull();
		expect(graphState.snapshotsLoading).toBe(false);
		expect(graphState.activeMaps).toEqual(DEFAULT_ACTIVE_MAPS);
	});

	it("真实桶落地后 getter 恢复读取实桶（applyFull 事件上下文建桶）", () => {
		const empty: never[] = [];
		graphState.applyFull("probe-graph", {
			nodes: [],
			edges: [],
			adjacency: {},
			reverseAdj: {},
		} as never);
		graphState.selectGraph("probe-graph");
		expect(graphState.graph).not.toBeNull();
		expect(graphState.graph!.nodes).toEqual(empty);
	});
});
