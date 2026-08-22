// tests/core/domain-runtime.test.ts — v0.5 规格 B：ADR 状态机、知识顶点豁免、
// governing_adrs / adr_flags 注入、领域事件
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createNode,
  updateNodeStatus,
  getGoverningAdrs,
} from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { writeNode, readNode } from "../../src/core/parser.js";
import { computeNextActions, resetIndexCache } from "../../src/core/index-service.js";
import { readEvents } from "../../src/core/eventlog.js";
import {
  NodeType,
  NodeStatus,
  AdrStatus,
  EdgeType,
  type NodeSchema,
} from "../../src/core/types.js";
import { governingAdrsFor, adrFlagsFor } from "../../src/core/domain.js";
import { allowedTransitionsFor } from "../../src/core/state-machine.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-v5-"));
  resetIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetIndexCache();
});

function writeNodeFull(node: NodeSchema): NodeSchema {
  writeNode(tmpDir, node);
  return node;
}

function makeAdr(id: string, status: AdrStatus = AdrStatus.Proposed, extra: Partial<NodeSchema> = {}): NodeSchema {
  const now = new Date().toISOString();
  return writeNodeFull({
    id,
    type: NodeType.Adr,
    label: `决策 ${id}`,
    level: 1,
    status,
    attempts: 0,
    max_attempts: 3,
    created_at: now,
    updated_at: now,
    decision: "决策内容",
    ...extra,
  });
}

function makeTask(id: string, extra: Partial<NodeSchema> = {}): NodeSchema {
  const now = new Date().toISOString();
  return writeNodeFull({
    id,
    type: NodeType.Task,
    label: id,
    level: 1,
    status: NodeStatus.Pending,
    attempts: 0,
    max_attempts: 3,
    created_at: now,
    updated_at: now,
    ...extra,
  });
}

function makeContext(id: string, extra: Partial<NodeSchema> = {}): NodeSchema {
  const now = new Date().toISOString();
  return writeNodeFull({
    id,
    type: NodeType.Context,
    label: id,
    level: 1,
    status: NodeStatus.Pending,
    attempts: 0,
    max_attempts: 3,
    created_at: now,
    updated_at: now,
    ...extra,
  });
}

describe("ADR 状态机（知识顶点分支）", () => {
  it("proposed → accepted → superseded 合法链路；事件落 adr_accepted / adr_superseded", () => {
    makeAdr("adr_0001", AdrStatus.Accepted, { superseded_by: "adr_0002" });
    makeAdr("adr_0002", AdrStatus.Accepted);
    const sup = updateNodeStatus(tmpDir, "adr_0001", AdrStatus.Superseded, undefined, {
      actor: "cli",
    });
    expect(sup.status).toBe(AdrStatus.Superseded);
    expect(sup.superseded_by).toBe("adr_0002");

    makeAdr("adr_0003", AdrStatus.Proposed);
    const acc = updateNodeStatus(tmpDir, "adr_0003", AdrStatus.Accepted, undefined, {
      actor: "mcp",
    });
    expect(acc.status).toBe(AdrStatus.Accepted);

    const kinds = readEvents(tmpDir).map((e) => e.kind);
    expect(kinds).toContain("adr_accepted");
    expect(kinds).toContain("adr_superseded");
    const supEvent = readEvents(tmpDir, { kind: "adr_superseded" })[0];
    expect(supEvent.node).toBe("adr_0001");
    expect(supEvent.detail).toContain("superseded_by=adr_0002");
  });

  it("非法 ADR 转换被拒（superseded 缺接替者 / accepted→running / superseded→accepted）", () => {
    makeAdr("adr_0001", AdrStatus.Proposed);
    expect(() => updateNodeStatus(tmpDir, "adr_0001", AdrStatus.Superseded)).toThrow(
      /superseded_by/,
    );

    makeAdr("adr_0002", AdrStatus.Accepted);
    expect(() =>
      updateNodeStatus(tmpDir, "adr_0002", NodeStatus.Running as any),
    ).toThrow(/ADR 状态机仅/);

    makeAdr("adr_0003", AdrStatus.Superseded, { superseded_by: "adr_0002" });
    expect(() => updateNodeStatus(tmpDir, "adr_0003", AdrStatus.Accepted)).toThrow(
      /ADR 状态机仅/,
    );
  });

  it("superseded_by 校验：指向自身 / 不存在节点 / 非 adr 顶点 均拒绝", () => {
    makeAdr("adr_0001", AdrStatus.Accepted, { superseded_by: "adr_0001" });
    expect(() => updateNodeStatus(tmpDir, "adr_0001", AdrStatus.Superseded)).toThrow(
      /不能指向自身/,
    );

    makeAdr("adr_0002", AdrStatus.Accepted, { superseded_by: "adr_9999" });
    expect(() => updateNodeStatus(tmpDir, "adr_0002", AdrStatus.Superseded)).toThrow(
      /不存在/,
    );

    makeTask("t1");
    makeAdr("adr_0003", AdrStatus.Accepted, { superseded_by: "t1" });
    expect(() => updateNodeStatus(tmpDir, "adr_0003", AdrStatus.Superseded)).toThrow(
      /不是 adr 顶点/,
    );
  });

  it("context 顶点拒绝一切状态变更；allowedTransitionsFor 按类型分表", () => {
    makeContext("ctx_1");
    for (const to of [NodeStatus.Ready, NodeStatus.Running, NodeStatus.Passed]) {
      expect(() => updateNodeStatus(tmpDir, "ctx_1", to)).toThrow(/context 顶点/);
    }
    expect(
      allowedTransitionsFor({ type: NodeType.Context, status: NodeStatus.Pending }),
    ).toEqual([]);
    expect(allowedTransitionsFor({ type: NodeType.Adr, status: AdrStatus.Proposed })).toEqual([
      "accepted",
    ]);
    expect(allowedTransitionsFor({ type: NodeType.Adr, status: AdrStatus.Accepted })).toEqual([
      "superseded",
    ]);
    expect(
      allowedTransitionsFor({ type: NodeType.Task, status: NodeStatus.Pending }),
    ).toContain("ready");
  });
});

describe("调度豁免与 adr_flags", () => {
  it("知识顶点不进任何调度桶、不计入 summary；adr_flags 传播到节点与 context 成员", () => {
    makeContext("ctx_1");
    makeAdr("adr_0001", AdrStatus.Superseded, { superseded_by: "adr_0002" });
    makeAdr("adr_0002", AdrStatus.Accepted);

    makeTask("t1");
    makeTask("t2", { context: "ctx_1" });
    makeTask("t3");

    createEdge(tmpDir, { id: "d1", source: "adr_0001", target: "t1", type: EdgeType.Decides });
    createEdge(tmpDir, { id: "d2", source: "adr_0001", target: "ctx_1", type: EdgeType.Decides });
    createEdge(tmpDir, { id: "d3", source: "adr_0002", target: "t3", type: EdgeType.Decides });
    resetIndexCache();

    const next = computeNextActions(tmpDir);
    const allBucketIds = [
      ...next.ready,
      ...next.ready_eligible,
      ...next.blocked,
      ...next.running,
      ...next.stale_running,
    ].map((e) => e.id);
    expect(allBucketIds).not.toContain("ctx_1");
    expect(allBucketIds).not.toContain("adr_0001");
    expect(allBucketIds).not.toContain("adr_0002");
    expect(next.summary.total).toBe(3); // 完成判定只数工作流顶点

    // adr_flags：t1（直接）与 t2（经 context）被打 ⚠️；t3 的管辖 ADR 是 accepted，不打
    const flags = new Map(next.ready_eligible.map((e) => [e.id, e.adr_flags]));
    expect(flags.get("t1")).toBeDefined();
    expect(flags.get("t1")![0]).toContain("adr_0001");
    expect(flags.get("t2")).toBeDefined();
    expect(flags.get("t2")![0]).toContain("决策依据已过时");
    expect(flags.get("t3")).toBeUndefined();
  });
});

describe("governing_adrs 注入", () => {
  it("decides 指向节点或其 context 的 ADR 进入 current；superseded 进入 superseded", () => {
    makeContext("ctx_1");
    makeAdr("adr_0001", AdrStatus.Accepted);
    makeAdr("adr_0003", AdrStatus.Superseded, { superseded_by: "adr_0001" });

    makeTask("t1");
    createEdge(tmpDir, { id: "d1", source: "adr_0001", target: "t1", type: EdgeType.Decides });
    createEdge(tmpDir, { id: "d2", source: "adr_0003", target: "ctx_1", type: EdgeType.Decides });
    makeTask("t2", { context: "ctx_1" }); // adr_0003 经 context 管辖 t2
    resetIndexCache();

    const g1 = getGoverningAdrs(tmpDir, "t1");
    expect(g1.current.map((a) => a.id)).toEqual(["adr_0001"]);
    expect(g1.superseded).toEqual([]);

    const g2 = getGoverningAdrs(tmpDir, "t2");
    expect(g2.superseded.map((a) => a.id)).toEqual(["adr_0003"]);
    expect(g2.superseded[0].superseded_by).toBe("adr_0001");
    expect(g2.current).toEqual([]);

    // 纯函数版边界：不存在的节点 / 空图
    expect(governingAdrsFor([], [], "ghost")).toEqual({ current: [], superseded: [] });
    expect(adrFlagsFor([], [])).toEqual(new Map());
    // readNode 覆盖：makeTask 写盘可读回
    expect(readNode(tmpDir, "t1").id).toBe("t1");
  });
});
