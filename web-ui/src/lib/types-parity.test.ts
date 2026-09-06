import { describe, it, expect } from "vitest";
import { isGraphIndexPayload } from "./api";
import type { GraphIndex, NodeSchema } from "./types";

// C6：手抄 UI 类型以真实后端载荷为金测，不从前端测试导入后端类型。
const backendNodeFixture = {
	id: "task-1",
	type: "task",
	label: "任务",
	level: 1,
	context: "ctx-tooling",
	contracts: [
		{
			to: "ctx-release-ops",
			contract: {
				produces: "构建产物",
				consumed_by: [{ artifact: "产物", used_as: "发布输入" }],
				validation: { required: true, method: "auto" },
			},
		},
	],
	plan: { description: "实现任务" },
	expected_outcome: {
		definition_of_done: ["测试通过"],
		quality_gates: [{ check: "独立复核", method: "cross_review" }],
	},
	checkpoints: [{ id: "cp1", label: "实现", status: "pending", verifier: "auto" }],
	status: "pending",
	attempts: 0,
	max_attempts: 3,
	created_at: "2026-09-05T00:00:00.000Z",
	updated_at: "2026-09-05T00:00:00.000Z",
} satisfies NodeSchema;

const backendGraphFixture = {
	nodes: [backendNodeFixture],
	edges: [],
} satisfies GraphIndex;

describe("C6 后端节点载荷与 Web UI 手抄类型对账", () => {
	it("保留 contracts 与 quality_gates 的后端字段并通过边界校验", () => {
		expect(isGraphIndexPayload(backendGraphFixture)).toBe(true);
		expect(backendNodeFixture.contracts?.[0].contract.produces).toBe("构建产物");
		expect(backendNodeFixture.expected_outcome.quality_gates?.[0].method).toBe("cross_review");
	});
});
