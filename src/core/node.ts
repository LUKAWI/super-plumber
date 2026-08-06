// src/core/node.ts
import {
  type NodeSchema,
  NodeStatus,
  type NodeType,
  type Checkpoint,
  NODES_DIR,
} from "./types.js";
import { readNode, writeNode, nodeFilePath, addGraphRef } from "./parser.js";
import { transition } from "./state-machine.js";
import * as fs from "node:fs";
import * as path from "node:path";

export type CreateNodeParams = {
  id: string;
  type: NodeType;
  label: string;
  level?: number;
  plan_description?: string;
  definition_of_done?: string[];
  assigned_to?: string;
  max_attempts?: number;
  checkpoints?: Checkpoint[];
};

export function createNode(
  rootDir: string,
  params: CreateNodeParams,
): NodeSchema {
  // 重复 id 检查：不静默覆盖已有节点
  if (fs.existsSync(nodeFilePath(rootDir, params.id))) {
    throw new Error(`Node ${params.id} already exists`);
  }
  const now = new Date().toISOString();
  const node: NodeSchema = {
    id: params.id,
    type: params.type,
    label: params.label,
    level: params.level ?? 1,
    status: NodeStatus.Pending,
    plan: params.plan_description
      ? { description: params.plan_description }
      : undefined,
    expected_outcome: params.definition_of_done
      ? { definition_of_done: params.definition_of_done }
      : undefined,
    assigned_to: params.assigned_to,
    attempts: 0,
    max_attempts: params.max_attempts ?? 3,
    created_at: now,
    updated_at: now,
    ...(params.checkpoints ? { checkpoints: params.checkpoints } : {}),
  };
  writeNode(rootDir, node);
  addGraphRef(rootDir, "node", node.id);
  return node;
}

export function getNode(rootDir: string, id: string): NodeSchema {
  try {
    return readNode(rootDir, id);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`Node ${id} not found`);
    }
    throw err;
  }
}

export function updateNodeStatus(
  rootDir: string,
  id: string,
  to: NodeStatus,
  claimBy?: string, // claim 语义：ready→running 时记录执行者
): NodeSchema {
  const node = getNode(rootDir, id);
  const updated = transition(node, to);

  // claim：ready → running，记录 assigned_to + started_at
  if (to === NodeStatus.Running && claimBy) {
    updated.assigned_to = claimBy;
    updated.execution_report = {
      ...(updated.execution_report ?? {}),
      summary: updated.execution_report?.summary ?? "",
      started_at:
        updated.execution_report?.started_at ?? new Date().toISOString(),
    };
  }

  // 节点完成时记录 completed_at
  if (
    (to === NodeStatus.Passed || to === NodeStatus.Failed) &&
    updated.execution_report
  ) {
    updated.execution_report = {
      ...updated.execution_report,
      completed_at: new Date().toISOString(),
    };
  }

  writeNode(rootDir, updated);
  return updated;
}

export function updateExecutionReport(
  rootDir: string,
  id: string,
  report: Partial<NonNullable<NodeSchema["execution_report"]>>,
): NodeSchema {
  const node = getNode(rootDir, id);
  const merged: NodeSchema = {
    ...node,
    execution_report: {
      ...(node.execution_report ?? { summary: "" }),
      ...report,
    },
    updated_at: new Date().toISOString(),
  };
  writeNode(rootDir, merged);
  return merged;
}

export function updateNodeContent(
  rootDir: string,
  id: string,
  updates: Partial<
    Pick<
      NodeSchema,
      | "plan"
      | "expected_outcome"
      | "checkpoints"
      | "assigned_to"
      | "label"
      | "max_attempts"
      | "execution_report"
    >
  >,
): NodeSchema {
  const node = getNode(rootDir, id);
  const updated: NodeSchema = {
    ...node,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  writeNode(rootDir, updated);
  return updated;
}

export function updateCheckpoint(
  rootDir: string,
  nodeId: string,
  cpId: string,
  status: Checkpoint["status"],
): NodeSchema {
  // 运行时校验：TS 类型只保护编译期，脚本/手工调用可绕过，必须显式拦截
  const CP_STATUSES: Checkpoint["status"][] = [
    "pending",
    "running",
    "passed",
    "failed",
    "skipped",
  ];
  if (!CP_STATUSES.includes(status as Checkpoint["status"])) {
    throw new Error(
      `非法 checkpoint 状态: ${status}。允许的值: ${CP_STATUSES.join(", ")}`,
    );
  }
  const node = getNode(rootDir, nodeId);
  if (!node.checkpoints) throw new Error(`Node ${nodeId} has no checkpoints`);
  const cp = node.checkpoints.find((c) => c.id === cpId);
  if (!cp) throw new Error(`Checkpoint ${cpId} not found in node ${nodeId}`);
  cp.status = status;
  node.updated_at = new Date().toISOString();
  writeNode(rootDir, node);
  return node;
}

export function listNodes(rootDir: string): NodeSchema[] {
  const nodesDir = path.join(rootDir, NODES_DIR);
  if (!fs.existsSync(nodesDir)) return [];
  return fs
    .readdirSync(nodesDir)
    .filter((f) => f.endsWith(".yaml") && !f.includes(".deleted"))
    .map((f) => readNode(rootDir, f.replace(/\.yaml$/, "")));
}
