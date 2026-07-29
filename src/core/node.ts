// src/core/node.ts
import { NodeSchema, NodeStatus, NodeType, Checkpoint, NODES_DIR } from "./types.js";
import { readNode, writeNode } from "./parser.js";
import { transition } from "./state-machine.js";
import * as fs from "node:fs";
import * as path from "node:path";

export type CreateNodeParams = {
  id: string;
  type: NodeType;
  label: string;
  level?: number;
  plan_description?: string;
  assigned_to?: string;
  max_attempts?: number;
  checkpoints?: Checkpoint[];
};

export function createNode(rootDir: string, params: CreateNodeParams): NodeSchema {
  const now = new Date().toISOString();
  const node: NodeSchema = {
    id: params.id,
    type: params.type,
    label: params.label,
    level: params.level ?? 1,
    status: NodeStatus.Pending,
    assigned_to: params.assigned_to,
    attempts: 0,
    max_attempts: params.max_attempts ?? 3,
    created_at: now,
    updated_at: now,
    ...(params.checkpoints ? { checkpoints: params.checkpoints } : {}),
  };
  writeNode(rootDir, node);
  return node;
}

export function getNode(rootDir: string, id: string): NodeSchema {
  return readNode(rootDir, id);
}

export function updateNodeStatus(
  rootDir: string,
  id: string,
  to: NodeStatus
): NodeSchema {
  const node = readNode(rootDir, id);
  const updated = transition(node, to);
  writeNode(rootDir, updated);
  return updated;
}

export function updateCheckpoint(
  rootDir: string,
  nodeId: string,
  cpId: string,
  status: Checkpoint["status"]
): NodeSchema {
  const node = readNode(rootDir, nodeId);
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
  return fs.readdirSync(nodesDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => readNode(rootDir, f.replace(/\.yaml$/, "")));
}
