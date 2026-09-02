// tests/core/claim-nudge.test.ts — arch-c3a：认领提示包 core 单源组装
// buildClaimNudgePackage 的形态学：governing_adrs / adr_flags / review_flag 有无各形态 +
// adr_flags 与调度面（adrFlagsFor）逐字同源 + F06（0.9.1）requires_human 槽位接线后
// 对无 human checkpoint 的票仍恒缺省（带 human checkpoint 的两态见 human-flags.test.ts）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildClaimNudgePackage,
  REVIEW_FLAG_UNREVIEWED,
} from "../../src/core/scheduler.js";
import { resetIndexCache } from "../../src/core/index-service.js";
import { createNode } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import {
  writeNode,
  readNode,
  readEdge,
  writeGraph,
  approveGraph,
} from "../../src/core/parser.js";
import { listEdgeFileNames } from "../../src/core/schema.js";
import { adrFlagsFor } from "../../src/core/domain.js";
import {
  NodeType,
  NodeStatus,
  AdrStatus,
  EdgeType,
  type NodeSchema,
  type EdgeSchema,
} from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-claim-nudge-"));
  resetIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetIndexCache();
});

function skeletonGraph() {
  return {
    id: "g1",
    version: "0.8.0",
    label: "claim-nudge-test",
    entry: { description: "e", defined_by: "human" as const, level: 0 },
    exit: {
      description: "x",
      acceptance_criteria: [],
      defined_by: "human" as const,
      level: 0,
    },
    nodes: [],
    edges: [],
  };
}

function makeAdr(
  id: string,
  status: AdrStatus = AdrStatus.Proposed,
  extra: Partial<NodeSchema> = {},
): NodeSchema {
  const now = new Date().toISOString();
  return writeNode(tmpDir, {
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
  return writeNode(tmpDir, {
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

function makeContext(id: string): NodeSchema {
  const now = new Date().toISOString();
  return writeNode(tmpDir, {
    id,
    type: NodeType.Context,
    label: id,
    level: 1,
    status: NodeStatus.Pending,
    attempts: 0,
    max_attempts: 3,
    created_at: now,
    updated_at: now,
  });
}

/** 小图直读：与索引同源的 nodes/edges 视图（供 adrFlagsFor 对拍） */
function snapshotNodes(ids: string[]): NodeSchema[] {
  return ids.map((id) => readNode(tmpDir, id));
}

function snapshotEdges(): EdgeSchema[] {
  return listEdgeFileNames(tmpDir).map((f) =>
    readEdge(tmpDir, f.replace(/\.yaml$/, "")),
  );
}

describe("buildClaimNudgePackage（认领提示包 core 单源）", () => {
  it("无管辖 ADR：governing_adrs/adr_flags 缺省；无 review 凭据 → 仅 review_flag 定稿文案", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    const pkg = buildClaimNudgePackage(tmpDir, "a");
    expect(pkg.governing_adrs).toBeUndefined();
    expect(pkg.adr_flags).toBeUndefined();
    expect(pkg.review_flag).toBe(REVIEW_FLAG_UNREVIEWED);
    // F06（0.9.1）接线后语义：无 human checkpoint 的票 → requires_human 恒缺省
    expect(pkg.requires_human).toBeUndefined();
    expect(Object.keys(pkg)).toEqual(["review_flag"]);
  });

  it("accepted 管辖 ADR（decides 直达）：current 含标题级指针，adr_flags 缺省", () => {
    makeAdr("adr_0001", AdrStatus.Accepted);
    makeTask("t1");
    createEdge(tmpDir, { id: "d1", source: "adr_0001", target: "t1", type: EdgeType.Decides });
    const pkg = buildClaimNudgePackage(tmpDir, "t1");
    expect(pkg.governing_adrs).toBeDefined();
    expect(pkg.governing_adrs!.current).toEqual([{ id: "adr_0001", title: "决策 adr_0001" }]);
    expect(pkg.governing_adrs!.superseded).toEqual([]);
    expect(pkg.adr_flags).toBeUndefined();
  });

  it("decides 打在 context 上：成员节点的提示包继承管辖 ADR", () => {
    makeContext("ctx_1");
    makeAdr("adr_0001", AdrStatus.Accepted);
    makeTask("t2", { context: "ctx_1" });
    createEdge(tmpDir, { id: "d1", source: "adr_0001", target: "ctx_1", type: EdgeType.Decides });
    const pkg = buildClaimNudgePackage(tmpDir, "t2");
    expect(pkg.governing_adrs!.current.map((a) => a.id)).toEqual(["adr_0001"]);
  });

  it("superseded 管辖 ADR：superseded 指针 + adr_flags 与调度面 adrFlagsFor 逐字同源", () => {
    makeAdr("adr_0001", AdrStatus.Superseded, { superseded_by: "adr_0002" });
    makeAdr("adr_0002", AdrStatus.Accepted);
    makeTask("t1");
    createEdge(tmpDir, { id: "d1", source: "adr_0001", target: "t1", type: EdgeType.Decides });
    createEdge(tmpDir, { id: "d2", source: "adr_0002", target: "t1", type: EdgeType.Decides });

    const pkg = buildClaimNudgePackage(tmpDir, "t1");
    // governing_adrs：current（生效）与 superseded（过时）分列
    expect(pkg.governing_adrs!.current.map((a) => a.id)).toEqual(["adr_0002"]);
    expect(pkg.governing_adrs!.superseded).toEqual([
      { id: "adr_0001", title: "决策 adr_0001", superseded_by: "adr_0002" },
    ]);
    // adr_flags 与调度面（computeNextActions 各桶）同一派生函数 → 逐字相等
    const expected = adrFlagsFor(snapshotNodes(["adr_0001", "adr_0002", "t1"]), snapshotEdges()).get("t1");
    expect(pkg.adr_flags).toEqual(expected);
    expect(pkg.adr_flags![0]).toBe(
      "ADR adr_0001（决策 adr_0001）已 superseded（由 adr_0002 接替）——决策依据已过时，建议重审",
    );
    // 无凭据图：review_flag 与 adr_flags 同包出现
    expect(pkg.review_flag).toBe(REVIEW_FLAG_UNREVIEWED);
    expect(pkg.requires_human).toBeUndefined();
  });

  it("review_flag 形态：有凭据 → 缺省；回置 unreviewed（F21 结构修订）→ 重新亮起", () => {
    writeGraph(tmpDir, skeletonGraph());
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });

    // 无凭据 → 注入定稿文案
    expect(buildClaimNudgePackage(tmpDir, "a").review_flag).toBe(REVIEW_FLAG_UNREVIEWED);

    // 人工审核凭据 → 不注入
    approveGraph(tmpDir, { by: "alice" });
    expect(buildClaimNudgePackage(tmpDir, "a").review_flag).toBeUndefined();

    // 结构修订回置 unreviewed（F21）→ 增量人审提示重新亮起
    const g = JSON.parse(JSON.stringify(skeletonGraph()));
    g.review = { status: "unreviewed", by: "cli", at: new Date().toISOString() };
    writeGraph(tmpDir, g);
    expect(buildClaimNudgePackage(tmpDir, "a").review_flag).toBe(REVIEW_FLAG_UNREVIEWED);
  });
});
