// 渲染安全回归探针（仅测试使用）。
// Svelte 5 的模板表达式（{#if graphState.graph} 等）编译为 derived 信号：
// 在 derived 求值期间读取 store getter，若 getter 隐式建桶（变更 $state）
// 即抛 state_unsafe_mutation——0.5.2 线上黑屏的根因。此处用模块级 $derived
// 等价模拟该求值上下文，供 store-readonly.test.ts 断言"读取不建桶"。
import { graphState } from "./store.svelte";

const graphProbe = $derived(graphState.graph);
const queryProbe = $derived(graphState.query);

export function readGraphProbe() {
	return graphProbe;
}

export function readQueryProbe() {
	return queryProbe;
}
