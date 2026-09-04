// tests/core/coded-errors.test.ts
// arch-c1（C1）：核心错误机器可读 code 最小集六枚的落地锁定。
// 此前 CLI 靠 message 字符串嗅探分类错误（isNodeNotFound 三副本）、ENOENT 提示
// 六份手写——本文件锁死六枚 code 的挂点，防止回归为无 code 的裸 Error。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getNode } from "../../src/core/node.js";
import { readGraph, writeGraph } from "../../src/core/graph-io.js";
import { transition } from "../../src/core/state-machine.js";
import {
  GraphError,
  ErrorCode,
  isNodeNotFound,
  isWorkspaceNotInitialized,
} from "../../src/core/errors.js";
import { createNode, updateNodeStatus, updateCheckpoint } from "../../src/core/node.js";
import { NodeType, NodeStatus } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-coded-err-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("arch-c1 核心错误码六枚", () => {
  it("ERR-1 getNode 不存在节点 → NODE_NOT_FOUND（含 entityId）", () => {
    try {
      getNode(tmpDir, "ghost");
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.NodeNotFound);
      expect(err.entityId).toBe("ghost");
      expect(err.message).toBe("Node ghost not found"); // message 面向后兼容逐字不变
      expect(err instanceof GraphError).toBe(true);
      expect(isNodeNotFound(err)).toBe(true);
      // message 嗅探通道已移除：Edge/Snapshot 的 not found 不得误判为节点缺失
      expect(isNodeNotFound(new Error("Edge x not found"))).toBe(false);
    }
  });

  it("ERR-2 readGraph 未初始化 → WORKSPACE_NOT_INITIALIZED（单源友好提示）", () => {
    try {
      readGraph(path.join(tmpDir, ".graph", "none"));
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.WorkspaceNotInitialized);
      expect(err.message).toContain("请先运行 graph init");
      expect(isWorkspaceNotInitialized(err)).toBe(true);
    }
  });

  it("ERR-3 非法状态转换 → INVALID_TRANSITION（工作流七态机）", () => {
    const node = createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    expect(() => transition(node, NodeStatus.Passed)).toThrowError(GraphError);
    try {
      transition(node, NodeStatus.Passed);
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.InvalidTransition);
      expect(err.message).toContain("Invalid transition: pending → passed");
    }
  });

  it("ERR-4 passed 硬门禁未满足 → GATE_NOT_SATISFIED", () => {
    createNode(tmpDir, { id: "g", type: NodeType.Task, label: "G" });
    // running（无报告）→ passed：先合法进入 running
    updateNodeStatus(tmpDir, "g", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "g", NodeStatus.Running, "tester");
    try {
      updateNodeStatus(tmpDir, "g", NodeStatus.Passed);
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.GateNotSatisfied);
      expect(err.message).toContain("不能标记 passed");
    }
  });

  it("ERR-5 重试预算耗尽 → ATTEMPTS_EXHAUSTED", () => {
    createNode(tmpDir, { id: "r", type: NodeType.Task, label: "R", max_attempts: 1 });
    updateNodeStatus(tmpDir, "r", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "r", NodeStatus.Running, "tester");
    updateNodeStatus(tmpDir, "r", NodeStatus.Failed);
    // 第一次 failed → pending 重试成功（attempts 0→1），随后耗尽
    updateNodeStatus(tmpDir, "r", NodeStatus.Pending);
    updateNodeStatus(tmpDir, "r", NodeStatus.Ready);
    updateNodeStatus(tmpDir, "r", NodeStatus.Running, "tester");
    const failed = updateNodeStatus(tmpDir, "r", NodeStatus.Failed);
    expect(failed.attempts).toBe(1);
    try {
      transition(failed, NodeStatus.Pending);
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.AttemptsExhausted);
      expect(err.message).toContain("最大重试次数");
    }
  });

  it("ERR-6 schema 校验失败 → VALIDATION_FAILED", () => {
    try {
      writeGraph(tmpDir, { id: "bad" } as any);
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.ValidationFailed);
      expect(err.message).toContain("写前校验失败");
    }
  });

  it("ERR-7 checkpoint 非法转换同属 INVALID_TRANSITION 族", () => {
    createNode(tmpDir, {
      id: "cp",
      type: NodeType.Task,
      label: "CP",
      checkpoints: [{ id: "c1", label: "C1", status: "pending" }],
    });
    updateCheckpoint(tmpDir, "cp", "c1", "passed");
    try {
      updateCheckpoint(tmpDir, "cp", "c1", "running");
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.InvalidTransition);
      expect(err.message).toContain("Invalid checkpoint transition");
    }
  });
});
