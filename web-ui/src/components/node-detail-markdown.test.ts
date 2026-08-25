// web-ui/src/components/node-detail-markdown.test.ts
// NodeDetail 集成回归：PLAN 板块以 Markdown 渲染（标题/列表真实进 DOM），
// 而非此前的裸 <p> 纯文本。选中节点注入 store（graphState.selectNode）。
import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import NodeDetail from "./NodeDetail.svelte";
import { graphState } from "../lib/store.svelte";
import type { NodeSchema } from "../lib/types";

function taskNode(planDescription: string): NodeSchema {
	return {
		id: "md-node",
		type: "task",
		label: "Markdown 节点",
		level: 1,
		status: "running",
		attempts: 0,
		max_attempts: 3,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		plan: { description: planDescription },
	};
}

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (app) unmount(app);
	app = null;
	graphState.selectNode(null);
	document.body.innerHTML = "";
});

describe("NodeDetail PLAN 板块 Markdown 集成", () => {
	it("NDM-01 plan 含 Markdown 时渲染出标题与列表（非纯文本段落）", () => {
		graphState.selectNode(
			taskNode("# 修复方案\n\n- 步骤一\n- 步骤二\n\n**注意** 细节见 `docs/`"),
		);
		const host = document.createElement("div");
		document.body.appendChild(host);
		app = mount(NodeDetail, { target: host });

		expect(host.querySelector(".markdown-body h1")?.textContent).toBe("修复方案");
		expect(host.querySelectorAll(".markdown-body ul li")).toHaveLength(2);
		expect(host.querySelector(".markdown-body strong")?.textContent).toBe("注意");
		// 旧的裸 <p class="plan-desc"> 已不存在于 PLAN 板块
		expect(host.querySelector("p.plan-desc")).toBeNull();
	});

	it("NDM-02 纯文本 plan 照常显示（无 Markdown 语法时不引入噪音）", () => {
		graphState.selectNode(taskNode("简单的单行计划描述"));
		const host = document.createElement("div");
		document.body.appendChild(host);
		app = mount(NodeDetail, { target: host });

		const body = host.querySelector(".markdown-body");
		expect(body).not.toBeNull();
		expect(body!.textContent).toContain("简单的单行计划描述");
		expect(body!.querySelector("h1")).toBeNull();
	});

	it("NDM-03 plan 为空时无空板块（既有条件渲染不回归）", () => {
		const node = taskNode("");
		delete node.plan;
		graphState.selectNode(node);
		const host = document.createElement("div");
		document.body.appendChild(host);
		app = mount(NodeDetail, { target: host });

		expect(host.querySelector(".markdown-body")).toBeNull();
	});

	function fullNode(): NodeSchema {
		return {
			...taskNode("plan 描述"),
			expected_outcome: {
				definition_of_done: [
					"**全部测试**通过且 `tsc` 零错误",
					"快照与写路径互斥（见 `tests/core/concurrency-hardening`）",
				],
			},
			checkpoints: [
				{ id: "cp1", label: "写前校验 `assertWritable`", status: "passed", verifier: "auto" },
				{ id: "cp2", label: "普通标签无语法", status: "pending", verifier: "auto" },
			],
			execution_report: {
				summary: "# 交接摘要\n\n- 完成一\n- 完成二\n\n**结论** 通过",
				notes: "补充说明见 `docs/note.md`",
				verification: { verdict: "passed", note: "经 **r1** 复核 `ok`" },
				artifacts: ["tests/core/a_b.test.ts"],
			},
		};
	}

	it("NDM-04 DONE CRITERIA / CHECKPOINTS / EXECUTION REPORT 全部 Markdown 适配", () => {
		graphState.selectNode(fullNode());
		const host = document.createElement("div");
		document.body.appendChild(host);
		app = mount(NodeDetail, { target: host });

		// DoD 条目：行内语法渲染于 li 内
		const dodItems = host.querySelectorAll(".dod-list li");
		expect(dodItems).toHaveLength(2);
		expect(dodItems[0].querySelector("strong")?.textContent).toBe("全部测试");
		expect(dodItems[0].querySelector("code")?.textContent).toBe("tsc");

		// Checkpoint 标签：行内代码渲染，状态徽标不受影响
		const cpItems = host.querySelectorAll(".cp-item");
		expect(cpItems).toHaveLength(2);
		expect(cpItems[0].querySelector(".cp-label code")?.textContent).toBe("assertWritable");
		expect(cpItems[0].querySelector(".cp-status")?.textContent).toBe("passed");
		expect(cpItems[1].querySelector(".cp-label")?.textContent).toBe("普通标签无语法");

		// Execution report summary：完整 Markdown（标题/列表/加粗）
		const reportSection = host.querySelectorAll(".section")[3];
		expect(reportSection.querySelector(".markdown-body h1")?.textContent).toBe("交接摘要");
		expect(reportSection.querySelectorAll(".markdown-body ul li")).toHaveLength(2);
		expect(reportSection.querySelector(".markdown-body strong")?.textContent).toBe("结论");

		// verdict note：行内 Markdown
		expect(reportSection.querySelector(".verdict-note strong")?.textContent).toBe("r1");
		expect(reportSection.querySelector(".verdict-note code")?.textContent).toBe("ok");

		// notes：完整 Markdown
		expect(reportSection.querySelector(".notes-block code")?.textContent).toBe("docs/note.md");

		// artifacts 保持 chip 纯文本：路径下划线不被误转斜体
		const chip = Array.from(reportSection.querySelectorAll(".chip")).find(
			(c) => c.textContent === "tests/core/a_b.test.ts",
		);
		expect(chip).toBeDefined();
		expect(chip!.querySelector("em")).toBeNull();
	});

	it("NDM-05 旧纯文本板块零残留（plan-desc 不再用于任何 Markdown 适配区）", () => {
		graphState.selectNode(fullNode());
		const host = document.createElement("div");
		document.body.appendChild(host);
		app = mount(NodeDetail, { target: host });
		expect(host.querySelector("p.plan-desc")).toBeNull();
		expect(host.querySelector("span.plan-desc")).toBeNull();
	});
});
