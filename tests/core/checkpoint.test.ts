// tests/core/checkpoint.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  canTransitionCheckpoint,
  assertCheckpointTransition,
} from "../../src/core/checkpoint.js";
import { createNode, updateCheckpoint, getNode } from "../../src/core/node.js";
import { NodeType } from "../../src/core/types.js";

describe("checkpoint state machine", () => {
  it.each([
    ["pending", "running", true],
    ["pending", "passed", true],
    ["pending", "failed", true],
    ["pending", "skipped", true],
    ["running", "passed", true],
    ["running", "failed", true],
    ["failed", "pending", true],
    ["passed", "pending", true], // 重开
    ["skipped", "pending", true],
    ["running", "running", true], // 幂等
    ["passed", "running", false], // 不允许回退到执行中
    ["passed", "failed", false],
    ["skipped", "passed", false],
  ])("%s → %s 允许=%s", (from, to, allowed) => {
    expect(
      canTransitionCheckpoint(from as never, to as never),
    ).toBe(allowed);
  });

  it("非法转换抛出可读错误", () => {
    expect(() =>
      assertCheckpointTransition("cp1", "passed", "running"),
    ).toThrow("Invalid checkpoint transition: cp1 passed → running");
  });
});

describe("updateCheckpoint integration", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-cp-"));
    createNode(tmpDir, {
      id: "n1",
      type: NodeType.Task,
      label: "N",
      checkpoints: [{ id: "cp1", label: "Step", status: "pending", verifier: "auto" }],
    });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pending → running → passed 全链合法", () => {
    updateCheckpoint(tmpDir, "n1", "cp1", "running");
    updateCheckpoint(tmpDir, "n1", "cp1", "passed");
    const n = getNode(tmpDir, "n1");
    expect(n.checkpoints![0].status).toBe("passed");
  });

  it("passed → running 非法（状态机拦截）", () => {
    updateCheckpoint(tmpDir, "n1", "cp1", "passed");
    expect(() => updateCheckpoint(tmpDir, "n1", "cp1", "running")).toThrow(
      "Invalid checkpoint transition",
    );
  });

  it("相同状态重复上报幂等成功（agent 重试友好）", () => {
    updateCheckpoint(tmpDir, "n1", "cp1", "passed");
    expect(() => updateCheckpoint(tmpDir, "n1", "cp1", "passed")).not.toThrow();
  });

  it("failed → pending 重试", () => {
    updateCheckpoint(tmpDir, "n1", "cp1", "failed");
    updateCheckpoint(tmpDir, "n1", "cp1", "pending");
    expect(getNode(tmpDir, "n1").checkpoints![0].status).toBe("pending");
  });
});
