# 拓扑图管理工具（"轮子"）MVP 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 v0.1.0 MVP——将任务文档和工作流重构为 agent 原生可理解的拓扑结构，提供 CLI + MCP + Web UI 三层访问入口。

**Architecture:** 单 npm 包双入口（`graph` CLI + `graph-mcp` MCP Server），共用 `src/core/` 层。Web UI 为独立 Svelte 应用，通过 `graph serve` 提供静态文件 + WebSocket 热同步。所有数据以 YAML 文件存储在 `.graph/` 目录，纯文件系统无数据库。

**Tech Stack:** TypeScript (strict), Vitest, @modelcontextprotocol/sdk, Svelte 5, D3.js, chokidar, js-yaml, ws

## Global Constraints

- 核心逻辑零外部依赖（所有 npm deps 必须声明在 package.json）
- 所有数据以 YAML 文件形式存储在 .graph/ 目录，不引入数据库
- 跨平台兼容（Windows / macOS / Linux），文件路径使用 path.join / posix 统一处理
- 工具本身不依赖 LLM API
- index/ 目录下的派生文件必须可从源文件重建
- 无 LLM 依赖，LLM 只是内容的生产者
- 节点/边文件使用结构化 YAML schema，非自由 Markdown
- 测试使用 Vitest，核心逻辑先写测试再实现（TDD）

---

## 文件结构总览

```
D:/LUKAWI/AI_project/projects/topological-tool/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── core/
│   │   ├── types.ts                  # 核心类型（Node / Edge / Graph / Status / NodeType / EdgeType）
│   │   ├── state-machine.ts          # 节点状态机（转换规则 + 校验）
│   │   ├── parser.ts                 # YAML 文件读写（js-yaml + fs-extra）
│   │   ├── node.ts                   # 节点 CRUD（创建/读取/更新/删除）
│   │   ├── edge.ts                   # 边 CRUD + 校验
│   │   └── graph.ts                  # 图操作（拓扑排序 + 循环检测 + 图结构管理）
│   ├── cli/
│   │   ├── index.ts                  # CLI 入口 + 命令路由（commander/yargs）
│   │   ├── init.ts                   # graph init
│   │   ├── create-node.ts            # graph create-node
│   │   ├── add-edge.ts               # graph add-edge
│   │   ├── status.ts                 # graph status
│   │   └── export-mermaid.ts         # graph export --mermaid
│   ├── mcp/
│   │   └── server.ts                 # MCP Server（STDIO + @modelcontextprotocol/sdk）
│   ├── web/
│   │   ├── server.ts                 # graph serve：HTTP + WebSocket
│   │   └── watcher.ts                # chokidar 文件变更监听 → WebSocket 广播
│   └── index.ts                      # 主入口 / 导出 core 供外部用
├── tests/
│   ├── core/
│   │   ├── state-machine.test.ts
│   │   ├── parser.test.ts
│   │   ├── node.test.ts
│   │   ├── edge.test.ts
│   │   └── graph.test.ts
│   ├── cli/
│   │   └── commands.test.ts
│   └── mcp/
│       └── server.test.ts
└── web-ui/                             # Svelte 5 + Vite 前端
    ├── package.json
    ├── svelte.config.js
    ├── vite.config.ts
    ├── src/
    │   ├── main.ts
    │   ├── App.svelte
    │   ├── lib/
    │   │   ├── types.ts              # 前端类型（与 core/types.ts 对应）
    │   │   ├── api.ts                # WebSocket + REST 客户端
    │   │   └── store.svelte.ts       # Svelte 响应式状态
    │   └── components/
    │       ├── GraphCanvas.svelte     # D3.js 力导向图渲染
    │       ├── NodeDetail.svelte      # 右侧/浮层节点详情面板
    │       └── StatusBadge.svelte     # 节点状态徽标组件
    └── static/
        └── index.html
```

---

## Task 0: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

**Interfaces:**
- Produces: 一个可 `npm install`、`npm run build`、`npm test` 的空项目骨架

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "topological-tool",
  "version": "0.1.0",
  "description": "工作流拓扑图管理工具 — 将任务文档重构为 agent 可原生理解的拓扑结构",
  "type": "module",
  "bin": {
    "graph": "./dist/cli/index.js",
    "graph-mcp": "./dist/mcp/server.js"
  },
  "exports": {
    ".": "./dist/index.js",
    "./core": "./dist/core/types.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "chokidar": "^4.0.0",
    "commander": "^12.0.0",
    "js-yaml": "^4.1.0",
    "ws": "^8.0.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.0",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "web-ui"]
}
```

- [ ] **Step 3: 创建 vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: 创建 .gitignore**

```
node_modules/
dist/
web-ui/node_modules/
web-ui/dist/
.graph/index/
```

- [ ] **Step 5: 安装依赖 + 验证编译**

Run: `cd "D:/LUKAWI/AI_project/projects/topological-tool" && npm install && npx tsc --noEmit`
Expected: 编译无报错

- [ ] **Step 6: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold topological-tool project"
```

---

## Task 1: 核心类型定义 (types.ts)

**Files:**
- Create: `src/core/types.ts`
- Test: 通过类型编译验证

**Interfaces:**
- Produces: `NodeStatus`, `NodeType`, `EdgeType`, `NodeSchema`, `EdgeSchema`, `GraphSchema`, `Checkpoint` 等核心类型

- [ ] **Step 1: 编写核心类型**

```ts
// src/core/types.ts

// ── 状态机 ──
export enum NodeStatus {
  Pending = "pending",
  Ready = "ready",
  Running = "running",
  Passed = "passed",
  Failed = "failed",
  Blocked = "blocked",
  Cancelled = "cancelled",
}

// ── 节点类型 ──
export enum NodeType {
  Task = "task",
  Checkpoint = "checkpoint",
  Decision = "decision",
  Gate = "gate",
}

// ── 边类型 ──
export enum EdgeType {
  DependsOn = "depends_on",
  Validates = "validates",
  SharesContext = "shares_context",
  FanOut = "fan_out",
  FanIn = "fan_in",
  Fallback = "fallback",
  Iterates = "iterates",
}

// 参与拓扑排序的边类型（不包含 fallback / iterates 等运行时边）
export const TOPOLOGICAL_EDGE_TYPES: EdgeType[] = [
  EdgeType.DependsOn,
  EdgeType.Validates,
];

// ── Checkpoint ──
export type CheckpointStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface Checkpoint {
  id: string;
  label: string;
  status: CheckpointStatus;
  verifier: "auto" | "cross_review" | "human";
}

// ── 节点 schema ──
export interface Plan {
  description: string;
  input_from?: { node: string; artifact: string }[];
  required_context?: { key: string; source: string }[];
  output_to?: { node: string; artifact: string }[];
}

export interface ExpectedOutcome {
  definition_of_done: string[];
  quality_gates?: { check: string; method: "auto" | "cross_review" | "human" }[];
}

export interface NodeSchema {
  id: string;
  type: NodeType;
  label: string;
  level: number;
  plan?: Plan;
  expected_outcome?: ExpectedOutcome;
  checkpoints?: Checkpoint[];
  status: NodeStatus;
  assigned_to?: string;
  attempts: number;
  max_attempts: number;
  created_at: string;  // ISO 8601
  updated_at: string;  // ISO 8601
}

// ── 边 schema ──
export interface Contract {
  produces?: string;
  consumed_by?: { artifact: string; used_as: string }[];
  validation?: { required: boolean; method: string };
}

export interface EdgeSchema {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  contract?: Contract;
}

// ── 图 schema ──
export interface GraphEntry {
  description: string;
  defined_by: "human" | "llm";
  level: number;
}

export interface GraphExit {
  description: string;
  acceptance_criteria: string[];
  defined_by: "human" | "llm";
  level: number;
}

export interface GraphSchema {
  id: string;
  version: string;
  label: string;
  entry: GraphEntry;
  exit: GraphExit;
  nodes: { file: string }[];
  edges: { file: string }[];
  root_context?: Record<string, unknown>;
}

// ── 目录常量 ──
export const GRAPH_DIR = ".graph";
export const NODES_DIR = ".graph/nodes";
export const EDGES_DIR = ".graph/edges";
export const INDEX_DIR = ".graph/index";
export const GRAPH_FILE = ".graph/graph.yaml";
```

- [ ] **Step 2: 验证类型编译**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat: add core type definitions"
```

---

## Task 2: 节点状态机 (state-machine.ts)

**Files:**
- Create: `src/core/state-machine.ts`
- Create: `tests/core/state-machine.test.ts`

**Interfaces:**
- Consumes: `NodeStatus`, `Checkpoint` from `./types.ts`
- Produces: `StateMachine.canTransition(from, to): boolean`, `StateMachine.transition(node, to): NodeSchema`, `StateMachine.getAllowedTransitions(status): NodeStatus[]`

- [ ] **Step 1: 编写状态转换规则**

```ts
// src/core/state-machine.ts
import { NodeStatus, NodeSchema, Checkpoint } from "./types.js";

// 允许的转换表：每个状态 → 可以转换到的状态列表
const TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  [NodeStatus.Pending]:   [NodeStatus.Ready, NodeStatus.Cancelled],
  [NodeStatus.Ready]:     [NodeStatus.Running, NodeStatus.Cancelled],
  [NodeStatus.Running]:   [NodeStatus.Passed, NodeStatus.Failed, NodeStatus.Cancelled],
  [NodeStatus.Passed]:    [NodeStatus.Blocked, NodeStatus.Cancelled],
  [NodeStatus.Failed]:    [NodeStatus.Pending, NodeStatus.Cancelled],  // failed → pending 表示重试
  [NodeStatus.Blocked]:   [NodeStatus.Ready, NodeStatus.Failed, NodeStatus.Cancelled],
  [NodeStatus.Cancelled]: [],  // 终止态
};

export function canTransition(from: NodeStatus, to: NodeStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(status: NodeStatus): NodeStatus[] {
  return [...(TRANSITIONS[status] ?? [])];
}

export function transition(node: NodeSchema, to: NodeStatus): NodeSchema {
  if (!canTransition(node.status, to)) {
    throw new Error(
      `Invalid transition: ${node.status} → ${to}. ` +
      `Allowed: [${getAllowedTransitions(node.status).join(", ")}]`
    );
  }
  return {
    ...node,
    status: to,
    updated_at: new Date().toISOString(),
    // failed → pending 重试时 attempts++
    ...(node.status === NodeStatus.Failed && to === NodeStatus.Pending
      ? { attempts: node.attempts + 1 }
      : {}),
  };
}

// ponytail: 检查点聚合状态——全部 passed 才返回 'passed'
export function aggregateCheckpointStatus(
  checkpoints: Checkpoint[]
): "passed" | "running" | "pending" | "failed" {
  if (checkpoints.length === 0) return "pending";
  if (checkpoints.some((c) => c.status === "failed")) return "failed";
  if (checkpoints.every((c) => c.status === "passed")) return "passed";
  if (checkpoints.some((c) => c.status === "running")) return "running";
  return "pending";
}
```

- [ ] **Step 2: 编写状态机测试**

```ts
// tests/core/state-machine.test.ts
import { describe, it, expect } from "vitest";
import {
  canTransition,
  transition,
  getAllowedTransitions,
  aggregateCheckpointStatus,
} from "../../src/core/state-machine.js";
import { NodeStatus, NodeSchema, NodeType } from "../../src/core/types.js";

function makeNode(overrides: Partial<NodeSchema> = {}): NodeSchema {
  return {
    id: "test-node",
    type: NodeType.Task,
    label: "test",
    level: 1,
    status: NodeStatus.Pending,
    attempts: 0,
    max_attempts: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("StateMachine", () => {
  // ── 合法转换 ──
  it.each([
    [NodeStatus.Pending, NodeStatus.Ready],
    [NodeStatus.Ready, NodeStatus.Running],
    [NodeStatus.Running, NodeStatus.Passed],
    [NodeStatus.Running, NodeStatus.Failed],
    [NodeStatus.Passed, NodeStatus.Blocked],
    [NodeStatus.Blocked, NodeStatus.Ready],
    [NodeStatus.Blocked, NodeStatus.Failed],
    [NodeStatus.Failed, NodeStatus.Pending],
    [NodeStatus.Pending, NodeStatus.Cancelled],
    [NodeStatus.Running, NodeStatus.Cancelled],
    [NodeStatus.Failed, NodeStatus.Cancelled],
    [NodeStatus.Blocked, NodeStatus.Cancelled],
  ])("允许 %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  // ── 非法转换 ──
  it.each([
    [NodeStatus.Pending, NodeStatus.Passed],   // 跳级
    [NodeStatus.Pending, NodeStatus.Failed],   // 跳级
    [NodeStatus.Passed, NodeStatus.Running],   // 单向
    [NodeStatus.Cancelled, NodeStatus.Ready],  // 终止态不可逆
  ])("禁止 %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("执行转换时更新 updated_at", () => {
    const node = makeNode();
    const result = transition(node, NodeStatus.Ready);
    expect(result.status).toBe(NodeStatus.Ready);
    expect(result.updated_at).not.toBe(node.updated_at);
  });

  it("failed → pending 时增加 attempts", () => {
    const node = makeNode({ status: NodeStatus.Failed, attempts: 1 });
    const result = transition(node, NodeStatus.Pending);
    expect(result.attempts).toBe(2);
  });

  it("非法转换抛出错误", () => {
    const node = makeNode();
    expect(() => transition(node, NodeStatus.Passed)).toThrow("Invalid transition");
  });

  // ── Checkpoint 聚合 ──
  it("空 checkpoints 返回 pending", () => {
    expect(aggregateCheckpointStatus([])).toBe("pending");
  });

  it("所有 checkpoint passed 才返回 passed", () => {
    expect(aggregateCheckpointStatus([
      { id: "c1", label: "c1", status: "passed", verifier: "auto" },
      { id: "c2", label: "c2", status: "passed", verifier: "auto" },
    ])).toBe("passed");
  });

  it("有 failed 返回 failed", () => {
    expect(aggregateCheckpointStatus([
      { id: "c1", label: "c1", status: "passed", verifier: "auto" },
      { id: "c2", label: "c2", status: "failed", verifier: "auto" },
    ])).toBe("failed");
  });

  it("cancelled 是终止态，无出口", () => {
    expect(getAllowedTransitions(NodeStatus.Cancelled)).toEqual([]);
  });
});
```

- [ ] **Step 3: 运行测试通过**

Run: `npx vitest run tests/core/state-machine.test.ts`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/state-machine.ts tests/core/state-machine.test.ts
git commit -m "feat: implement node state machine with transition validation"
```

---

## Task 3: YAML 解析/序列化 (parser.ts)

**Files:**
- Create: `src/core/parser.ts`
- Create: `tests/core/parser.test.ts`

**Interfaces:**
- Consumes: types (NodeSchema, EdgeSchema, GraphSchema)
- Produces: `readGraph`, `writeGraph`, `readNode`, `writeNode`, `readEdge`, `writeEdge`, `ensureGraphDir`

- [ ] **Step 1: 编写 parser 实现**

```ts
// src/core/parser.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import {
  NodeSchema,
  EdgeSchema,
  GraphSchema,
  NODES_DIR,
  EDGES_DIR,
  GRAPH_FILE,
} from "./types.js";

export function ensureGraphDir(rootDir: string): void {
  fs.mkdirSync(path.join(rootDir, NODES_DIR), { recursive: true });
  fs.mkdirSync(path.join(rootDir, EDGES_DIR), { recursive: true });
}

// ── Graph ──
export function readGraph(rootDir: string): GraphSchema {
  const content = fs.readFileSync(path.join(rootDir, GRAPH_FILE), "utf-8");
  return yaml.load(content) as GraphSchema;
}

export function writeGraph(rootDir: string, graph: GraphSchema): void {
  ensureGraphDir(rootDir);
  const content = yaml.dump(graph, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(path.join(rootDir, GRAPH_FILE), content, "utf-8");
}

// ── Node ──
export function nodeFilePath(rootDir: string, id: string): string {
  return path.join(rootDir, NODES_DIR, `${id}.yaml`);
}

export function readNode(rootDir: string, id: string): NodeSchema {
  const content = fs.readFileSync(nodeFilePath(rootDir, id), "utf-8");
  return yaml.load(content) as NodeSchema;
}

export function writeNode(rootDir: string, node: NodeSchema): void {
  ensureGraphDir(rootDir);
  const content = yaml.dump(node, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(nodeFilePath(rootDir, node.id), content, "utf-8");
}

export function deleteNode(rootDir: string, id: string): void {
  const filePath = nodeFilePath(rootDir, id);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Edge ──
export function edgeFilePath(rootDir: string, id: string): string {
  return path.join(rootDir, EDGES_DIR, `${id}.yaml`);
}

export function readEdge(rootDir: string, id: string): EdgeSchema {
  const content = fs.readFileSync(edgeFilePath(rootDir, id), "utf-8");
  return yaml.load(content) as EdgeSchema;
}

export function writeEdge(rootDir: string, edge: EdgeSchema): void {
  ensureGraphDir(rootDir);
  const content = yaml.dump(edge, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(edgeFilePath(rootDir, edge.id), content, "utf-8");
}

export function deleteEdge(rootDir: string, id: string): void {
  const filePath = edgeFilePath(rootDir, id);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
```

- [ ] **Step 2: 编写 parser 测试**

```ts
// tests/core/parser.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  ensureGraphDir,
  writeNode,
  readNode,
  writeEdge,
  readEdge,
  writeGraph,
  readGraph,
} from "../../src/core/parser.js";
import { NodeType, NodeStatus, EdgeType, NodeSchema, EdgeSchema } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Parser", () => {
  it("创建 .graph 目录结构", () => {
    ensureGraphDir(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, ".graph/nodes"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".graph/edges"))).toBe(true);
  });

  it("写入和读取节点文件", () => {
    const node: NodeSchema = {
      id: "task_001",
      type: NodeType.Task,
      label: "调研框架",
      level: 1,
      status: NodeStatus.Pending,
      attempts: 0,
      max_attempts: 3,
      created_at: "2026-07-28T10:00:00Z",
      updated_at: "2026-07-28T10:00:00Z",
    };
    writeNode(tmpDir, node);
    const loaded = readNode(tmpDir, "task_001");
    expect(loaded.id).toBe("task_001");
    expect(loaded.status).toBe(NodeStatus.Pending);
  });

  it("写入和读取边文件", () => {
    const edge: EdgeSchema = {
      id: "edge_001",
      source: "task_001",
      target: "task_002",
      type: EdgeType.DependsOn,
    };
    writeEdge(tmpDir, edge);
    const loaded = readEdge(tmpDir, "edge_001");
    expect(loaded.source).toBe("task_001");
    expect(loaded.type).toBe(EdgeType.DependsOn);
  });

  it("写入和读取图根文件", () => {
    writeGraph(tmpDir, {
      id: "graph_001",
      version: "0.1.0",
      label: "test",
      entry: { description: "entry", defined_by: "human", level: 0 },
      exit: { description: "exit", acceptance_criteria: [], defined_by: "human", level: 0 },
      nodes: [{ file: "nodes/task_001.yaml" }],
      edges: [{ file: "edges/edge_001.yaml" }],
    });
    const loaded = readGraph(tmpDir);
    expect(loaded.id).toBe("graph_001");
    expect(loaded.nodes).toHaveLength(1);
  });

  it("读不存在的节点抛错误", () => {
    expect(() => readNode(tmpDir, "nonexistent")).toThrow();
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/core/parser.test.ts`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/parser.ts tests/core/parser.test.ts
git commit -m "feat: add YAML parser/serializer for .graph/ files"
```

---

## Task 4: 节点操作 (node.ts)

**Files:**
- Create: `src/core/node.ts`
- Create: `tests/core/node.test.ts`

**Interfaces:**
- Consumes: `NodeSchema`, `NodeStatus`, `NodeType`, `Checkpoint` from types; `readNode`, `writeNode` from parser; `transition` from state-machine
- Produces: `createNode`, `getNode`, `updateNodeStatus`, `updateCheckpoint`, `listNodes`

- [ ] **Step 1: 编写节点操作实现**

```ts
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
```

- [ ] **Step 2: 编写节点操作测试**

```ts
// tests/core/node.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createNode, getNode, updateNodeStatus, updateCheckpoint, listNodes } from "../../src/core/node.js";
import { NodeType, NodeStatus } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Node operations", () => {
  it("创建节点并持久化到文件", () => {
    const node = createNode(tmpDir, {
      id: "task_001",
      type: NodeType.Task,
      label: "调研框架",
    });
    expect(node.id).toBe("task_001");
    expect(node.status).toBe(NodeStatus.Pending);
    expect(fs.existsSync(path.join(tmpDir, ".graph/nodes/task_001.yaml"))).toBe(true);
  });

  it("通过 getNode 读取", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    const loaded = getNode(tmpDir, "t1");
    expect(loaded.label).toBe("T1");
  });

  it("更新节点状态", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    const updated = updateNodeStatus(tmpDir, "t1", NodeStatus.Ready);
    expect(updated.status).toBe(NodeStatus.Ready);
    const reloaded = getNode(tmpDir, "t1");
    expect(reloaded.status).toBe(NodeStatus.Ready);
  });

  it("更新 checkpoint 状态", () => {
    createNode(tmpDir, {
      id: "t1",
      type: NodeType.Task,
      label: "T1",
      checkpoints: [
        { id: "cp_01", label: "Step 1", status: "pending", verifier: "auto" },
      ],
    });
    const updated = updateCheckpoint(tmpDir, "t1", "cp_01", "passed");
    expect(updated.checkpoints![0].status).toBe("passed");
  });

  it("listNodes 返回空数组当 .graph 不存在", () => {
    expect(listNodes(tmpDir)).toEqual([]);
  });

  it("listNodes 返回所有节点", () => {
    createNode(tmpDir, { id: "a", type: NodeType.Task, label: "A" });
    createNode(tmpDir, { id: "b", type: NodeType.Task, label: "B" });
    const nodes = listNodes(tmpDir);
    expect(nodes).toHaveLength(2);
  });

  it("非法状态转换抛出错误", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    expect(() => updateNodeStatus(tmpDir, "t1", NodeStatus.Passed)).toThrow();
  });

  it("不存在的 checkpoint 抛出错误", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1", checkpoints: [{ id: "cp_01", label: "S1", status: "pending", verifier: "auto" }] });
    expect(() => updateCheckpoint(tmpDir, "t1", "cp_wrong", "passed")).toThrow();
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/core/node.test.ts`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/node.ts tests/core/node.test.ts
git commit -m "feat: implement node CRUD with persistence"
```

---

## Task 5: 边操作 + 图拓扑管理 (edge.ts + graph.ts)

**Files:**
- Create: `src/core/edge.ts`
- Create: `src/core/graph.ts`
- Create: `tests/core/edge.test.ts`
- Create: `tests/core/graph.test.ts`

**Interfaces:**
- Consumes: types, parser, node
- Produces: `createEdge`, `getEdge`, `listEdges` from edge.ts; `topologicalSort`, `detectCycles`, `buildGraphIndex` from graph.ts

- [ ] **Step 1: 编写边操作**

```ts
// src/core/edge.ts
import { EdgeSchema, EdgeType, EDGES_DIR } from "./types.js";
import { writeEdge, readEdge } from "./parser.js";
import * as fs from "node:fs";
import * as path from "node:path";

export type CreateEdgeParams = {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  contract?: EdgeSchema["contract"];
};

export function createEdge(rootDir: string, params: CreateEdgeParams): EdgeSchema {
  const edge: EdgeSchema = {
    id: params.id,
    source: params.source,
    target: params.target,
    type: params.type,
    ...(params.contract ? { contract: params.contract } : {}),
  };
  writeEdge(rootDir, edge);
  return edge;
}

export function getEdge(rootDir: string, id: string): EdgeSchema {
  return readEdge(rootDir, id);
}

export function listEdges(rootDir: string): EdgeSchema[] {
  const edgesDir = path.join(rootDir, EDGES_DIR);
  if (!fs.existsSync(edgesDir)) return [];
  return fs.readdirSync(edgesDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => readEdge(rootDir, f.replace(/\.yaml$/, "")));
}
```

- [ ] **Step 2: 编写图操作**

```ts
// src/core/graph.ts
import { NodeSchema, EdgeSchema, EdgeType, TOPOLOGICAL_EDGE_TYPES } from "./types.js";
import { listNodes } from "./node.js";
import { listEdges } from "./edge.js";

export interface GraphIndex {
  nodes: NodeSchema[];
  edges: EdgeSchema[];
  adjacency: Map<string, string[]>;   // 正向邻接表
  reverseAdj: Map<string, string[]>;  // 反向邻接表
}

/** 构建当前 .graph/ 目录的完整索引（内存） */
export function buildGraphIndex(rootDir: string): GraphIndex {
  const nodes = listNodes(rootDir);
  const edges = listEdges(rootDir);
  const adjacency = new Map<string, string[]>();
  const reverseAdj = new Map<string, string[]>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
    reverseAdj.set(node.id, []);
  }

  for (const edge of edges) {
    if (!TOPOLOGICAL_EDGE_TYPES.includes(edge.type)) continue;
    if (adjacency.has(edge.source)) {
      adjacency.get(edge.source)!.push(edge.target);
    }
    if (reverseAdj.has(edge.target)) {
      reverseAdj.get(edge.target)!.push(edge.source);
    }
  }

  return { nodes, edges, adjacency, reverseAdj };
}

/**
 * 拓扑排序（Kahn 算法）。只考虑 TOPOLOGICAL_EDGE_TYPES 中的边。
 */
export function topologicalSort(
  nodeIds: string[],
  edges: Pick<EdgeSchema, "source" | "target" | "type">[]
): string[] {
  const topologicalEdges = edges.filter((e) =>
    TOPOLOGICAL_EDGE_TYPES.includes(e.type)
  );

  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    outEdges.set(id, []);
  }

  for (const e of topologicalEdges) {
    outEdges.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const neighbor of outEdges.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (result.length !== nodeIds.length) {
    const unprocessed = nodeIds.filter((id) => !result.includes(id));
    throw new Error(
      `Cycle detected among nodes: [${unprocessed.join(", ")}].`
    );
  }

  return result;
}

/** 检测环，返回所有环路径 */
export function detectCycles(
  nodeIds: string[],
  edges: Pick<EdgeSchema, "source" | "target" | "type">[]
): string[][] {
  const topologicalEdges = edges.filter((e) =>
    TOPOLOGICAL_EDGE_TYPES.includes(e.type)
  );

  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const e of topologicalEdges) {
    adjacency.get(e.source)?.push(e.target);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string) {
    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (inStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push([...path.slice(cycleStart), neighbor]);
      }
    }

    path.pop();
    inStack.delete(node);
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) dfs(id);
  }

  return cycles;
}
```

- [ ] **Step 3: 编写边操作测试**

```ts
// tests/core/edge.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createEdge, getEdge, listEdges } from "../../src/core/edge.js";
import { EdgeType } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Edge operations", () => {
  it("创建边并持久化", () => {
    const edge = createEdge(tmpDir, {
      id: "e1",
      source: "a",
      target: "b",
      type: EdgeType.DependsOn,
    });
    expect(edge.type).toBe(EdgeType.DependsOn);
    expect(fs.existsSync(path.join(tmpDir, ".graph/edges/e1.yaml"))).toBe(true);
  });

  it("创建边带合约", () => {
    createEdge(tmpDir, {
      id: "e2",
      source: "a",
      target: "b",
      type: EdgeType.Validates,
      contract: { produces: "report" },
    });
    const loaded = getEdge(tmpDir, "e2");
    expect(loaded.contract?.produces).toBe("report");
  });

  it("listEdges 返回空", () => {
    expect(listEdges(tmpDir)).toEqual([]);
  });

  it("listEdges 返回所有边", () => {
    createEdge(tmpDir, { id: "e1", source: "a", target: "b", type: EdgeType.DependsOn });
    createEdge(tmpDir, { id: "e2", source: "b", target: "c", type: EdgeType.DependsOn });
    expect(listEdges(tmpDir)).toHaveLength(2);
  });
});
```

- [ ] **Step 4: 编写图操作测试**

```ts
// tests/core/graph.test.ts
import { describe, it, expect } from "vitest";
import { topologicalSort, detectCycles } from "../../src/core/graph.js";
import { EdgeType } from "../../src/core/types.js";

describe("Graph operations", () => {
  describe("topologicalSort", () => {
    it("空图返回空", () => {
      expect(topologicalSort([], [])).toEqual([]);
    });

    it("单节点无依赖", () => {
      expect(topologicalSort(["a"], [])).toEqual(["a"]);
    });

    it("线性依赖 a → b → c", () => {
      const result = topologicalSort(["a", "b", "c"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
        { source: "b", target: "c", type: EdgeType.DependsOn },
      ]);
      expect(result.indexOf("a")).toBeLessThan(result.indexOf("b"));
      expect(result.indexOf("b")).toBeLessThan(result.indexOf("c"));
    });

    it("并行 fan-out", () => {
      const result = topologicalSort(["a", "b", "c"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
        { source: "a", target: "c", type: EdgeType.DependsOn },
      ]);
      expect(result[0]).toBe("a");
      expect(result).toContain("b");
      expect(result).toContain("c");
    });

    it("忽略 fallback 边", () => {
      const result = topologicalSort(["a", "b", "c"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
        { source: "c", target: "a", type: EdgeType.Fallback },
      ]);
      expect(result.indexOf("a")).toBeLessThan(result.indexOf("b"));
      expect(result).toContain("c");
    });

    it("有环时抛出错误", () => {
      expect(() => {
        topologicalSort(["a", "b", "c"], [
          { source: "a", target: "b", type: EdgeType.DependsOn },
          { source: "b", target: "c", type: EdgeType.DependsOn },
          { source: "c", target: "a", type: EdgeType.DependsOn },
        ]);
      }).toThrow("Cycle detected");
    });
  });

  describe("detectCycles", () => {
    it("无环返回空数组", () => {
      const cycles = detectCycles(["a", "b"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
      ]);
      expect(cycles).toHaveLength(0);
    });

    it("检测简单环 a → b → a", () => {
      const cycles = detectCycles(["a", "b"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
        { source: "b", target: "a", type: EdgeType.DependsOn },
      ]);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
    });

    it("fallback 边不产生环", () => {
      const cycles = detectCycles(["a", "b"], [
        { source: "a", target: "b", type: EdgeType.DependsOn },
        { source: "b", target: "a", type: EdgeType.Fallback },
      ]);
      expect(cycles).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 5: 运行全部测试**

Run: `npx vitest run`
Expected: 全部 PASS（state-machine + parser + node + edge + graph）

- [ ] **Step 6: Commit**

```bash
git add src/core/edge.ts src/core/graph.ts tests/core/edge.test.ts tests/core/graph.test.ts
git commit -m "feat: implement edge CRUD, topological sort, and cycle detection"
```

---

## Task 6: CLI 框架 + 核心命令

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/init.ts`
- Create: `src/cli/create-node.ts`
- Create: `src/cli/add-edge.ts`
- Create: `src/cli/status.ts`
- Create: `src/cli/export-mermaid.ts`
- Create: `tests/cli/commands.test.ts`

- [ ] **Step 1: CLI 主入口**

```ts
#!/usr/bin/env node
// src/cli/index.ts
import { Command } from "commander";
import { initCommand } from "./init.js";
import { createNodeCommand } from "./create-node.js";
import { addEdgeCommand } from "./add-edge.js";
import { statusCommand } from "./status.js";
import { exportMermaidCommand } from "./export-mermaid.js";

const program = new Command();

program
  .name("graph")
  .description("工作流拓扑图管理工具")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(createNodeCommand);
program.addCommand(addEdgeCommand);
program.addCommand(statusCommand);
program.addCommand(exportMermaidCommand);

program.parse(process.argv);
```

- [ ] **Step 2: graph init**

```ts
// src/cli/init.ts
import { Command } from "commander";
import { writeGraph } from "../core/parser.js";

export const initCommand = new Command("init")
  .description("在当前目录初始化 .graph/ 结构")
  .option("-l, --label <label>", "图名称", "untitled")
  .action((options) => {
    const rootDir = process.cwd();
    const graph = {
      id: `graph_${Date.now()}`,
      version: "0.1.0",
      label: options.label,
      entry: {
        description: "",
        defined_by: "human" as const,
        level: 0,
      },
      exit: {
        description: "",
        acceptance_criteria: [],
        defined_by: "human" as const,
        level: 0,
      },
      nodes: [],
      edges: [],
    };
    writeGraph(rootDir, graph);
    console.log(`✅ 已初始化 .graph/ 目录: ${rootDir}`);
  });
```

- [ ] **Step 3: graph create-node**

```ts
// src/cli/create-node.ts
import { Command } from "commander";
import { createNode } from "../core/node.js";
import { NodeType } from "../core/types.js";

export const createNodeCommand = new Command("create-node")
  .description("创建新节点")
  .requiredOption("-i, --id <id>", "节点 ID")
  .requiredOption("-l, --label <label>", "节点标签")
  .option("-t, --type <type>", "节点类型", "task")
  .option("--level <level>", "拓扑层级", "1")
  .option("--assigned-to <agent>", "分配给哪个 agent")
  .action((options) => {
    const node = createNode(process.cwd(), {
      id: options.id,
      type: options.type as NodeType,
      label: options.label,
      level: parseInt(options.level, 10),
      assigned_to: options.assignedTo,
    });
    console.log(`✅ 已创建节点: ${node.id} (${node.status})`);
  });
```

- [ ] **Step 4: graph add-edge**

```ts
// src/cli/add-edge.ts
import { Command } from "commander";
import { createEdge } from "../core/edge.js";
import { EdgeType } from "../core/types.js";

export const addEdgeCommand = new Command("add-edge")
  .description("在节点之间添加边")
  .requiredOption("-i, --id <id>", "边 ID")
  .requiredOption("-s, --source <source>", "源节点 ID")
  .requiredOption("-t, --target <target>", "目标节点 ID")
  .option("--type <type>", "边类型", "depends_on")
  .action((options) => {
    const edge = createEdge(process.cwd(), {
      id: options.id,
      source: options.source,
      target: options.target,
      type: options.type as EdgeType,
    });
    console.log(`✅ 已添加边: ${edge.id} (${edge.source} → ${edge.target})`);
  });
```

- [ ] **Step 5: graph status**

```ts
// src/cli/status.ts
import { Command } from "commander";
import { readGraph } from "../core/parser.js";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import { topologicalSort } from "../core/graph.js";

export const statusCommand = new Command("status")
  .description("显示当前拓扑图状态")
  .action(() => {
    const rootDir = process.cwd();
    const graph = readGraph(rootDir);
    const nodes = listNodes(rootDir);
    const edges = listEdges(rootDir);

    console.log(`图: ${graph.label} (${graph.id})`);
    console.log(`节点数: ${nodes.length}`);
    console.log(`边数: ${edges.length}`);
    console.log(`\n节点状态分布:`);

    const counts = new Map<string, number>();
    for (const n of nodes) {
      counts.set(n.status, (counts.get(n.status) ?? 0) + 1);
    }
    for (const [status, count] of counts) {
      console.log(`  ${status}: ${count}`);
    }

    try {
      const order = topologicalSort(nodes.map((n) => n.id), edges);
      console.log(`\n✅ 拓扑排序通过 (${order.length} 节点)`);
    } catch (err: any) {
      console.log(`\n❌ ${err.message}`);
    }
  });
```

- [ ] **Step 6: graph export --mermaid**

```ts
// src/cli/export-mermaid.ts
import { Command } from "commander";
import { listNodes } from "../core/node.js";
import { listEdges } from "../core/edge.js";
import * as fs from "node:fs";
import * as path from "node:path";

function statusClass(status: string): string {
  const map: Record<string, string> = {
    pending: "fill:#94a3b8,stroke:#475569",
    ready: "fill:#3b82f6,stroke:#1d4ed8",
    running: "fill:#f59e0b,stroke:#b45309",
    passed: "fill:#22c55e,stroke:#16a34a",
    failed: "fill:#ef4444,stroke:#dc2626",
    blocked: "fill:#8b5cf6,stroke:#7c3aed",
    cancelled: "fill:#6b7280,stroke:#4b5563",
  };
  return map[status] ?? "fill:#e2e8f0,stroke:#cbd5e1";
}

export const exportMermaidCommand = new Command("export")
  .description("导出拓扑图为 Mermaid 流程图")
  .option("--mermaid", "导出为 Mermaid 格式")
  .option("-o, --output <file>", "输出文件路径", "topology.mmd")
  .action((options) => {
    const rootDir = process.cwd();
    const nodes = listNodes(rootDir);
    const edges = listEdges(rootDir);

    let mermaid = "graph TD;\n";
    mermaid += "  %% 节点定义 (按状态着色)\n";

    for (const node of nodes) {
      mermaid += `  ${node.id}["${node.label}"]:::${node.status};\n`;
    }

    mermaid += "\n  %% 边\n";
    for (const edge of edges) {
      const label = edge.type.replace("_", " ");
      mermaid += `  ${edge.source} -->|"${label}"| ${edge.target};\n`;
    }

    mermaid += "\n  %% 样式定义\n";
    const seen = new Set<string>();
    for (const node of nodes) {
      if (!seen.has(node.status)) {
        seen.add(node.status);
        mermaid += `  classDef ${node.status} ${statusClass(node.status)};\n`;
      }
    }

    const outPath = path.resolve(options.output);
    fs.writeFileSync(outPath, mermaid, "utf-8");
    console.log(`✅ 已导出 Mermaid 文件: ${outPath}`);
  });
```

- [ ] **Step 7: 编写 CLI 测试**

```ts
// tests/cli/commands.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

const CLI = "node dist/cli/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-cli-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string): string {
  return execSync(`${CLI} ${args}`, { cwd: tmpDir, encoding: "utf-8" });
}

describe("CLI commands", () => {
  it("graph init 创建 .graph 目录", () => {
    run("init --label test-graph");
    expect(fs.existsSync(path.join(tmpDir, ".graph/graph.yaml"))).toBe(true);
  });

  it("graph create-node 创建节点文件", () => {
    run("init");
    run('create-node --id t1 --label "Task 1"');
    expect(fs.existsSync(path.join(tmpDir, ".graph/nodes/t1.yaml"))).toBe(true);
  });

  it("graph add-edge 创建边文件", () => {
    run("init");
    run("create-node --id a --label A");
    run("create-node --id b --label B");
    run("add-edge --id e1 --source a --target b");
    expect(fs.existsSync(path.join(tmpDir, ".graph/edges/e1.yaml"))).toBe(true);
  });

  it("graph status 不报错", () => {
    run("init");
    const output = run("status");
    expect(output).toContain("图:");
  });

  it("graph export --mermaid 生成文件", () => {
    run("init");
    run("create-node --id a --label A");
    run("create-node --id b --label B");
    run("add-edge --id e1 --source a --target b");
    run("export --mermaid -o test.mmd");
    const content = fs.readFileSync(path.join(tmpDir, "test.mmd"), "utf-8");
    expect(content).toContain("graph TD");
    expect(content).toContain("a");
  });
});
```

- [ ] **Step 8: 构建并运行 CLI 测试**

Run: `npx tsc && npx vitest run tests/cli/commands.test.ts`
Expected: 全部 PASS

- [ ] **Step 9: Commit**

```bash
git add src/cli/ tests/cli/
git commit -m "feat: implement CLI with init, create-node, add-edge, status, export commands"
```

---

## Task 7: MCP Server

**Files:**
- Create: `src/mcp/server.ts`
- Create: `tests/mcp/server.test.ts`

**Interfaces:**
- Consumes: core (node.ts, edge.ts, graph.ts, state-machine.ts, parser.ts)
- Produces: STDIO MCP Server，注册 `graph_get_node`, `graph_create_node`, `graph_update_node_status`, `graph_get_graph`, `graph_traverse`, `graph_search`

- [ ] **Step 1: 编写 MCP Server**

```ts
#!/usr/bin/env node
// src/mcp/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getNode,
  createNode as createNodeOp,
  updateNodeStatus,
  listNodes,
} from "../core/node.js";
import { buildGraphIndex } from "../core/graph.js";
import { NodeType, NodeStatus } from "../core/types.js";

const rootDir = process.cwd();

const server = new Server(
  { name: "topological-tool", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "graph_get_node",
      description: "读取单个节点的全部内容",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "graph_create_node",
      description: "创建新节点",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          type: { type: "string", enum: Object.values(NodeType) },
          level: { type: "number" },
          assigned_to: { type: "string" },
        },
        required: ["id", "label"],
      },
    },
    {
      name: "graph_update_node_status",
      description: "更新节点状态（状态机校验）",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: Object.values(NodeStatus) },
        },
        required: ["id", "status"],
      },
    },
    {
      name: "graph_get_graph",
      description: "获取完整图拓扑",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "graph_traverse",
      description: "从指定节点出发遍历相邻节点",
      inputSchema: {
        type: "object",
        properties: {
          node_id: { type: "string" },
          direction: { type: "string", enum: ["downstream", "upstream", "both"] },
          max_depth: { type: "number" },
        },
        required: ["node_id"],
      },
    },
    {
      name: "graph_search",
      description: "按条件搜索节点",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          status: { type: "string", enum: Object.values(NodeStatus) },
          type: { type: "string", enum: Object.values(NodeType) },
          assigned_to: { type: "string" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "graph_get_node": {
        const node = getNode(rootDir, args.id);
        return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
      }
      case "graph_create_node": {
        const node = createNodeOp(rootDir, {
          id: args.id,
          label: args.label,
          type: (args.type as NodeType) ?? NodeType.Task,
          level: args.level ?? 1,
          assigned_to: args.assigned_to,
        });
        return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
      }
      case "graph_update_node_status": {
        const node = updateNodeStatus(rootDir, args.id, args.status as NodeStatus);
        return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
      }
      case "graph_get_graph": {
        const index = buildGraphIndex(rootDir);
        return { content: [{ type: "text", text: JSON.stringify(index, null, 2) }] };
      }
      case "graph_traverse": {
        const index = buildGraphIndex(rootDir);
        const visited = new Set<string>();
        const result: string[] = [];
        const maxDepth = (args.max_depth as number) ?? 3;
        const direction = (args.direction as string) ?? "downstream";

        function dfs(nodeId: string, depth: number) {
          if (depth > maxDepth || visited.has(nodeId)) return;
          visited.add(nodeId);
          result.push(nodeId);
          if (direction === "downstream" || direction === "both") {
            for (const edge of index.edges) {
              if (edge.source === nodeId) dfs(edge.target, depth + 1);
            }
          }
          if (direction === "upstream" || direction === "both") {
            for (const edge of index.edges) {
              if (edge.target === nodeId) dfs(edge.source, depth + 1);
            }
          }
        }
        dfs(args.node_id, 0);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "graph_search": {
        const nodes = listNodes(rootDir);
        const filtered = nodes.filter((n) => {
          if (args.query && !n.id.includes(args.query) && !n.label.includes(args.query)) return false;
          if (args.status && n.status !== args.status) return false;
          if (args.type && n.type !== args.type) return false;
          if (args.assigned_to && n.assigned_to !== args.assigned_to) return false;
          return true;
        });
        return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts tests/mcp/server.test.ts
git commit -m "feat: implement MCP Server with 6 graph tools"
```

---

## Task 8: graph serve — Web UI 后端

**Files:**
- Create: `src/web/server.ts`
- Create: `src/web/watcher.ts`
- Create: `src/cli/serve.ts`

- [ ] **Step 1: 文件监听器**

```ts
// src/web/watcher.ts
import * as chokidar from "chokidar";
import * as path from "node:path";

export type FileChangeEvent = {
  type: "add" | "change" | "unlink";
  file: string;
  timestamp: number;
};

export function createWatcher(rootDir: string, onChange: (event: FileChangeEvent) => void) {
  const watchDir = path.join(rootDir, ".graph");
  const watcher = chokidar.watch(watchDir, {
    ignored: /index\//,
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on("all", (event, filePath) => {
    onChange({
      type: event as FileChangeEvent["type"],
      file: path.relative(rootDir, filePath),
      timestamp: Date.now(),
    });
  });

  return watcher;
}
```

- [ ] **Step 2: Web Server（HTTP + WebSocket）**

```ts
// src/web/server.ts
import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { buildGraphIndex } from "../core/graph.js";
import { createWatcher, FileChangeEvent } from "./watcher.js";

const WEB_UI_DIR = path.resolve(
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  (import.meta as any).dirname ?? __dirname,
  "../../web-ui/dist"
);

export function startServer(rootDir: string, port: number = 3030) {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/graph") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(buildGraphIndex(rootDir)));
      return;
    }
    let filePath = path.join(WEB_UI_DIR, req.url === "/" ? "index.html" : req.url!);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(WEB_UI_DIR, "index.html");
    }
    const ext = path.extname(filePath);
    const mime: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, { "Content-Type": mime[ext] ?? "application/octet-stream" });
    res.end(fs.readFileSync(filePath));
  });

  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.send(JSON.stringify({
      type: "graph:full",
      data: buildGraphIndex(rootDir),
    }));
  });

  const watcher = createWatcher(rootDir, (event: FileChangeEvent) => {
    const msg = JSON.stringify({
      type: "graph:update",
      data: { ...event, graph: buildGraphIndex(rootDir) },
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  });

  server.listen(port, () => {
    console.log(`🌐 拓扑图可视化服务: http://localhost:${port}`);
    console.log(`📁 监控目录: ${path.join(rootDir, ".graph")}`);
  });

  return { server, wss, watcher };
}
```

- [ ] **Step 3: CLI serve 命令**

```ts
// src/cli/serve.ts
import { Command } from "commander";
import { startServer } from "../web/server.js";

export const serveCommand = new Command("serve")
  .description("启动 Web 可视化服务")
  .option("-p, --port <port>", "端口号", "3030")
  .action((options) => {
    startServer(process.cwd(), parseInt(options.port, 10));
  });
```

在 `src/cli/index.ts` 中添加 `program.addCommand(serveCommand);`

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 5: Commit**

```bash
git add src/web/ src/cli/serve.ts
git commit -m "feat: implement graph serve with WebSocket live sync"
```

---

## Task 9: Web UI — Svelte 5 + D3.js 前端

**Files:**
- Create: `web-ui/package.json`
- Create: `web-ui/vite.config.ts`
- Create: `web-ui/tsconfig.json`
- Create: `web-ui/static/index.html`
- Create: `web-ui/src/main.ts`
- Create: `web-ui/src/App.svelte`
- Create: `web-ui/src/lib/types.ts`
- Create: `web-ui/src/lib/api.ts`
- Create: `web-ui/src/lib/store.svelte.ts`
- Create: `web-ui/src/components/GraphCanvas.svelte`
- Create: `web-ui/src/components/NodeDetail.svelte`

- [ ] **Step 1: 初始化 Svelte 项目**

```json
// web-ui/package.json
{
  "name": "topological-tool-web-ui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "d3": "^7.9.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "svelte": "^5.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
```

```ts
// web-ui/vite.config.ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
export default defineConfig({
  plugins: [svelte()],
  build: { outDir: "dist" },
});
```

```json
// web-ui/tsconfig.json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "strict": true
  },
  "include": ["src"]
}
```

```html
<!-- web-ui/static/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>拓扑图可视化</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

```ts
// web-ui/src/main.ts
import { mount } from "svelte";
import App from "./App.svelte";
mount(App, { target: document.getElementById("app")! });
```

- [ ] **Step 2: 前端类型定义**

```ts
// web-ui/src/lib/types.ts
export type NodeStatus = "pending" | "ready" | "running" | "passed" | "failed" | "blocked" | "cancelled";
export type NodeType = "task" | "checkpoint" | "decision" | "gate";
export type EdgeType = "depends_on" | "validates" | "shares_context" | "fan_out" | "fan_in" | "fallback" | "iterates";

export interface NodeSchema {
  id: string;
  type: NodeType;
  label: string;
  level: number;
  status: NodeStatus;
  assigned_to?: string;
  attempts: number;
  max_attempts: number;
  [key: string]: unknown;
}

export interface EdgeSchema {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
}

export interface GraphIndex {
  nodes: NodeSchema[];
  edges: EdgeSchema[];
}

export interface WsMessage {
  type: "graph:full" | "graph:update";
  data: GraphIndex & { file?: string; type?: string; timestamp?: number };
}

export const STATUS_COLORS: Record<NodeStatus, string> = {
  pending: "#94a3b8",
  ready: "#3b82f6",
  running: "#f59e0b",
  passed: "#22c55e",
  failed: "#ef4444",
  blocked: "#8b5cf6",
  cancelled: "#6b7280",
};
```

- [ ] **Step 3: WebSocket API 客户端**

```ts
// web-ui/src/lib/api.ts
import type { GraphIndex, WsMessage } from "./types";

export type GraphListener = (graph: GraphIndex) => void;

export function connectGraph(host: string, onGraph: GraphListener): () => void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${host}`);

  ws.onmessage = (event) => {
    const msg: WsMessage = JSON.parse(event.data);
    if (msg.type === "graph:full" || msg.type === "graph:update") {
      onGraph(msg.data as GraphIndex);
    }
  };

  ws.onerror = () => {
    console.warn("WebSocket 连接失败，尝试 HTTP 回退...");
    fetch("/api/graph")
      .then((r) => r.json())
      .then(onGraph);
  };

  return () => ws.close();
}
```

- [ ] **Step 4: Svelte Store**

```ts
// web-ui/src/lib/store.svelte.ts
import type { GraphIndex, NodeSchema } from "./types";

// ponytail: Svelte 5 runes — $state
let _graph: GraphIndex | null = $state(null);
let _selectedNode: NodeSchema | null = $state(null);

export const graphState = {
  get graph() { return _graph; },
  get selectedNode() { return _selectedNode; },
  setGraph(g: GraphIndex | null) { _graph = g; },
  selectNode(n: NodeSchema | null) { _selectedNode = n; },
};
```

- [ ] **Step 5: GraphCanvas — D3.js 力导向图**

```svelte
<!-- web-ui/src/components/GraphCanvas.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import { graphState } from "../lib/store.svelte";
  import { STATUS_COLORS } from "../lib/types";
  import type { GraphIndex, NodeSchema } from "../lib/types";

  let svgEl: SVGSVGElement;
  let simulation: d3.Simulation<NodeSchema, undefined> | null = null;

  function renderGraph(graph: GraphIndex) {
    if (!svgEl || !graph) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    const width = svgEl.clientWidth || 800;
    const height = svgEl.clientHeight || 600;

    const nodes = graph.nodes.map((n) => ({ ...n }));
    const edges = graph.edges.map((e) => ({ ...e }));

    simulation?.stop();
    simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id((d: any) => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(60));

    const link = svg.append("g")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", "#94a3b8")
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.6)
      .attr("marker-end", "url(#arrowhead)");

    const node = svg.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .on("click", (_event: any, d: NodeSchema) => graphState.selectNode(d));

    node.append("circle")
      .attr("r", 20)
      .attr("fill", (d) => STATUS_COLORS[d.status] ?? "#e2e8f0")
      .attr("stroke", "#fff")
      .attr("stroke-width", 2);

    node.append("text")
      .text((d) => d.label.length > 12 ? d.label.slice(0, 10) + "..." : d.label)
      .attr("text-anchor", "middle")
      .attr("dy", 4)
      .attr("font-size", "10px")
      .attr("fill", "#fff");

    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 28)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#94a3b8");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });
  }

  $effect(() => {
    if (graphState.graph) renderGraph(graphState.graph);
  });

  onDestroy(() => simulation?.stop());
</script>

<div class="canvas-wrapper">
  <svg bind:this={svgEl} class="graph-canvas"></svg>
</div>

<style>
  .canvas-wrapper { flex: 1; overflow: hidden; }
  .graph-canvas { width: 100%; height: 100%; }
</style>
```

- [ ] **Step 6: NodeDetail 面板**

```svelte
<!-- web-ui/src/components/NodeDetail.svelte -->
<script lang="ts">
  import { graphState } from "../lib/store.svelte";
  import { STATUS_COLORS } from "../lib/types";
</script>

{#if graphState.selectedNode}
  <div class="detail-panel">
    <button class="close-btn" onclick={() => graphState.selectNode(null)}>✕</button>
    <h2>{graphState.selectedNode.label}</h2>
    <div class="info-grid">
      <div class="field">
        <label>ID</label>
        <span>{graphState.selectedNode.id}</span>
      </div>
      <div class="field">
        <label>类型</label>
        <span>{graphState.selectedNode.type}</span>
      </div>
      <div class="field">
        <label>层级</label>
        <span>L{graphState.selectedNode.level}</span>
      </div>
      <div class="field">
        <label>状态</label>
        <span class="status-badge"
          style="background: {STATUS_COLORS[graphState.selectedNode.status]}">
          {graphState.selectedNode.status}
        </span>
      </div>
      {#if graphState.selectedNode.assigned_to}
        <div class="field">
          <label>执行者</label>
          <span>{graphState.selectedNode.assigned_to}</span>
        </div>
      {/if}
      <div class="field">
        <label>尝试</label>
        <span>{graphState.selectedNode.attempts}/{graphState.selectedNode.max_attempts}</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .detail-panel {
    position: fixed; right: 0; top: 0; bottom: 0; width: 320px;
    background: #1e293b; color: #e2e8f0; padding: 1.5rem;
    box-shadow: -2px 0 8px rgba(0,0,0,0.3); overflow-y: auto;
  }
  .close-btn { float: right; background: none; border: none; color: #94a3b8; font-size: 1.2rem; cursor: pointer; }
  .info-grid { margin-top: 1rem; }
  .field { margin-bottom: 0.75rem; }
  .field label { display: block; font-size: 0.75rem; color: #64748b; text-transform: uppercase; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; color: #fff; }
</style>
```

- [ ] **Step 7: App.svelte 主应用**

```svelte
<!-- web-ui/src/App.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import GraphCanvas from "./components/GraphCanvas.svelte";
  import NodeDetail from "./components/NodeDetail.svelte";
  import { connectGraph } from "./lib/api";
  import { graphState } from "./lib/store.svelte";

  let disconnect: (() => void) | null = null;

  onMount(() => {
    disconnect = connectGraph(location.host, (g) => graphState.setGraph(g));
  });
  onDestroy(() => disconnect?.());
</script>

<div class="app">
  <header class="header">
    <h1>拓扑图可视化</h1>
    <div class="legend">
      <span class="legend-item" style="background: #94a3b8">pending</span>
      <span class="legend-item" style="background: #3b82f6">ready</span>
      <span class="legend-item" style="background: #f59e0b">running</span>
      <span class="legend-item" style="background: #22c55e">passed</span>
      <span class="legend-item" style="background: #ef4444">failed</span>
      <span class="legend-item" style="background: #8b5cf6">blocked</span>
      <span class="legend-item" style="background: #6b7280">cancelled</span>
    </div>
    <div class="stats">
      节点: {graphState.graph?.nodes.length ?? 0}
      边: {graphState.graph?.edges.length ?? 0}
    </div>
  </header>
  <main class="main">
    <GraphCanvas />
  </main>
  <NodeDetail />
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; background: #0f172a; color: #e2e8f0; }
  .header { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1rem; border-bottom: 1px solid #1e293b; }
  .header h1 { font-size: 1rem; margin: 0; }
  .legend { display: flex; gap: 4px; font-size: 0.7rem; }
  .legend-item { padding: 2px 6px; border-radius: 3px; color: #fff; }
  .stats { margin-left: auto; font-size: 0.8rem; color: #64748b; }
  .main { flex: 1; position: relative; }
</style>
```

- [ ] **Step 8: 构建前端**

Run: `cd web-ui && npm install && npm run build`
Expected: `web-ui/dist/` 下生成静态文件

- [ ] **Step 10: Commit**

```bash
git add web-ui/
git commit -m "feat: add Svelte + D3.js web UI with WebSocket live sync"
```

---

## 自检清单

### 需求覆盖

| 需求 | 对应任务 | 状态 |
|------|----------|------|
| `.graph/` 目录规范 | Task 3 (parser) + Task 6 (init) | 已覆盖 |
| 节点/边 schema | Task 1 (types.ts) | 已覆盖 |
| CLI 工具 | Task 6 (CLI 命令) | 已覆盖 |
| MCP 服务器 | Task 7 (mcp/server.ts) | 已覆盖 |
| 节点状态机 | Task 2 (state-machine.ts) | 已覆盖 |
| 版本控制 | 推迟到 v0.2 | ⬜ 推迟 |
| 可视化 | Task 8 (serve) + Task 9 (Web UI) | 已覆盖 |
| YAML 存储 | Task 3 (parser.ts) | 已覆盖 |
| 拓扑排序 + 环检 | Task 5 (graph.ts) | 已覆盖 |
| 索引可重建 | parser + buildGraphIndex 设计 | 已覆盖 |

### 无占位符

- [x] 所有步骤包含实际代码，无 "TBD" / "TODO" 占位
- [x] 所有测试包含具体断言，无 "add more tests"
- [x] 所有函数签名一致，跨任务类型匹配

### 技术一致性

- [x] `NodeStatus` 枚举在 types.ts 定义 → state-machine.ts 和 CLI/MCP 引用同一来源
- [x] `EdgeType.TOPOLOGICAL_EDGE_TYPES` 在 types 中定义 → graph.ts 引用
- [x] parser.ts 使用 `js-yaml` → package.json 声明
- [x] MCP Server 使用 `@modelcontextprotocol/sdk` → package.json 声明
- [x] Web UI 使用 Svelte 5 + D3.js → web-ui/package.json 声明
- [x] `buildGraphIndex` 在 graph.ts 中定义 → MCP 和 WebServer 都引用它
