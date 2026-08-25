// tests/core/eventlog.test.ts — FIX-C1：append-only 事件日志
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { appendEvent, readEvents, eventsFilePath } from "../../src/core/eventlog.js";
import { createNode, updateNodeStatus } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { EdgeType, NodeType } from "../../src/core/types.js";
import { writeGraph } from "../../src/core/parser.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-eventlog-"));
  writeGraph(tmpDir, {
    id: "g1",
    version: "0.4.0",
    label: "eventlog-test",
    entry: { description: "e", defined_by: "human", level: 0 },
    exit: { description: "x", acceptance_criteria: [], defined_by: "human", level: 0 },
    nodes: [],
    edges: [],
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("eventlog", () => {
  it("append + read 往返，顺序保持", () => {
    appendEvent(tmpDir, { actor: "cli", kind: "node_created", node: "a", to: "pending" });
    appendEvent(tmpDir, { actor: "mcp", kind: "node_status", node: "a", from: "pending", to: "ready" });
    const events = readEvents(tmpDir);
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("node_created");
    expect(events[0].actor).toBe("cli");
    expect(events[0].ts).toBeTruthy();
    expect(events[1].from).toBe("pending");
    expect(events[1].to).toBe("ready");
  });

  it("按 node / kind 过滤", () => {
    appendEvent(tmpDir, { actor: "cli", kind: "node_created", node: "a" });
    appendEvent(tmpDir, { actor: "cli", kind: "node_status", node: "a", from: "ready", to: "running" });
    appendEvent(tmpDir, { actor: "cli", kind: "node_created", node: "b" });
    expect(readEvents(tmpDir, { node: "a" })).toHaveLength(2);
    expect(readEvents(tmpDir, { kind: "node_created" })).toHaveLength(2);
    expect(readEvents(tmpDir, { node: "b", kind: "node_created" })).toHaveLength(1);
  });

  it("无日志文件时返回空数组", () => {
    expect(readEvents(tmpDir)).toEqual([]);
  });

  it("撕裂行被跳过，不毒化整个日志读取", () => {
    appendEvent(tmpDir, { actor: "cli", kind: "node_created", node: "a" });
    // 模拟撕裂：半行 JSON 独占一行（自带换行，不与后续行粘连）
    fs.appendFileSync(eventsFilePath(tmpDir), "{\"torn\": \n", "utf-8");
    appendEvent(tmpDir, { actor: "cli", kind: "node_status", node: "a" });
    const events = readEvents(tmpDir);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.kind !== undefined)).toBe(true);
  });

  it("集成：createNode / updateNodeStatus 自动落事件（actor 透传）", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" }, { actor: "cli" });
    updateNodeStatus(tmpDir, "t1", "ready", undefined, { actor: "cli" });
    updateNodeStatus(tmpDir, "t1", "running", "agent-x", { actor: "cli" });
    const events = readEvents(tmpDir, { node: "t1" });
    expect(events.map((e) => e.kind)).toEqual([
      "node_created",
      "node_status",
      "node_status",
    ]);
    const claim = events[2];
    expect(claim.from).toBe("ready");
    expect(claim.to).toBe("running");
    expect(claim.detail).toBe("claim by agent-x");
  });

  it("集成：force 越权单独留痕 force_override", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" }, { actor: "cli" });
    createNode(tmpDir, { id: "t2", type: NodeType.Task, label: "T2" }, { actor: "cli" });
    createEdge(tmpDir, { id: "e1", source: "t2", target: "t1", type: EdgeType.DependsOn }, { actor: "cli" });
    // t1 的门控前驱 t2 未 passed，进 ready 应被门禁拦截——force 绕过（状态转换表本身合法）
    updateNodeStatus(tmpDir, "t1", "ready", undefined, { force: true, actor: "cli" });
    const kinds = readEvents(tmpDir, { node: "t1" }).map((e) => e.kind);
    expect(kinds).toContain("force_override");
    expect(kinds).toContain("node_status");
  });

  it("连续追加均持久化（无覆盖/丢失）", () => {
    for (let i = 0; i < 20; i++) {
      appendEvent(tmpDir, { actor: "cli", kind: "node_status", node: `n${i}` });
    }
    expect(readEvents(tmpDir)).toHaveLength(20);
    // 每行都是完整 JSON（文件以换行结尾、无半行）
    const raw = fs.readFileSync(eventsFilePath(tmpDir), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    for (const line of raw.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
