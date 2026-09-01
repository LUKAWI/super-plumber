// tests/core/graph-dir.test.ts — v0.5.2 core_layout：图目录解析/迁移/工作区状态/多图隔离
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { NodeType } from "../../src/core/types.js";
import {
  toGraphDir,
  workspaceOf,
  listGraphNames,
  readWorkspaceDefault,
  writeWorkspaceDefault,
  resolveGraphDir,
  migrateLegacyLayout,
  createGraph,
  trashGraph,
  appendWorkspaceEvent,
  readWorkspaceEvents,
  assertValidGraphName,
  didYouMean,
  GRAPH_NAME_RE,
} from "../../src/core/graph-dir.js";
import { createNode, getNode } from "../../src/core/node.js";
import { createEdge } from "../../src/core/edge.js";
import { createSnapshot, listSnapshots } from "../../src/core/snapshot.js";
import { readEvents } from "../../src/core/eventlog.js";
import { resetIndexCache } from "../../src/core/index-service.js";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string; // 工作区根

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-v52-"));
  resetIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetIndexCache();
});

function legacyInit(label = "旧图"): void {
  // v0.5.2 起 CLI init 新仓库必须带名——旧布局兼容基线改为手工构造
  // （.graph/graph.yaml 在根 = default 原地，正是 migrateLegacyLayout 的输入形态）
  fs.mkdirSync(path.join(tmpDir, ".graph", "nodes"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, ".graph", "edges"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, ".graph", "graph.yaml"),
    `id: g_legacy\nlabel: ${label}\nentry:\n  description: ""\n  defined_by: human\n  level: 0\nexit:\n  description: ""\n  acceptance_criteria: []\n  defined_by: human\n  level: 0\nnodes: []\nedges: []\n`,
    "utf-8",
  );
}

describe("toGraphDir 归一化", () => {
  it("旧布局：工作区根 → .graph/ 原地（default），磁盘零变化", () => {
    legacyInit();
    expect(toGraphDir(tmpDir)).toBe(path.join(tmpDir, ".graph"));
    // 传图目录本身 → 原样通过
    expect(toGraphDir(path.join(tmpDir, ".graph"))).toBe(path.join(tmpDir, ".graph"));
  });

  it("未初始化：返回 <ws>/.graph（写入方在此创建 = 旧布局位置）", () => {
    expect(toGraphDir(tmpDir)).toBe(path.join(tmpDir, ".graph"));
  });

  it("多图布局：降入 active 指向的图", () => {
    legacyInit();
    migrateLegacyLayout(tmpDir);
    createGraph(tmpDir, "refactor-auth", "认证重构");
    writeWorkspaceDefault(tmpDir, "refactor-auth");
    expect(toGraphDir(tmpDir)).toBe(path.join(tmpDir, ".graph", "refactor-auth"));
  });

  it("workspaceOf：图目录 → 工作区根", () => {
    expect(workspaceOf(path.join(tmpDir, ".graph"))).toBe(tmpDir);
    expect(workspaceOf(path.join(tmpDir, ".graph", "x"))).toBe(tmpDir);
    expect(workspaceOf(tmpDir)).toBe(tmpDir);
  });
});

describe("图名规则", () => {
  it("合法/非法图名", () => {
    expect(GRAPH_NAME_RE.test("refactor-auth")).toBe(true);
    expect(GRAPH_NAME_RE.test("a")).toBe(true);
    for (const bad of ["Default", "1abc", "has space", "中文图", "x".repeat(40), ""]) {
      expect(() => assertValidGraphName(bad)).toThrow(/非法图名/);
    }
  });

  it("did-you-mean：前缀优先，编辑距离次之", () => {
    expect(didYouMean("refac", ["refactor-auth", "billing"])).toEqual(["refactor-auth"]);
    expect(didYouMean("refactor-atuh", ["refactor-auth", "billing"])).toContain("refactor-auth");
    expect(didYouMean("zzz", ["aaa", "bbb"])).toEqual([]);
  });
});

describe("旧布局零迁移兼容 + 一次性迁移", () => {
  it("旧布局只读识别为 default，行为不变", () => {
    legacyInit();
    expect(listGraphNames(tmpDir)).toEqual(["default"]);
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" }); // 传工作区根照样工作
    expect(getNode(tmpDir, "t1").id).toBe("t1");
  });

  it("建第二图触发迁移：7 项搬入 .graph/default/，default 可读，事件落审计", () => {
    legacyInit("旧图内容");
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    const dir = createGraph(tmpDir, "billing-v2", "计费v2");
    expect(dir).toBe(path.join(tmpDir, ".graph", "billing-v2"));
    // 迁移后旧图在 .graph/default/，数据无损
    expect(fs.existsSync(path.join(tmpDir, ".graph", "default", "graph.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".graph", "graph.yaml"))).toBe(false);
    expect(getNode(path.join(tmpDir, ".graph", "default"), "t1").id).toBe("t1");
    expect(listGraphNames(tmpDir).sort()).toEqual(["billing-v2", "default"]);
    const events = readWorkspaceEvents(tmpDir, { kind: "migrate" });
    expect(events).toHaveLength(1);
    expect(events[0].detail).toContain("default");
    expect(readWorkspaceEvents(tmpDir, { kind: "init" }).length).toBe(1);
    // 再迁移一次 = 幂等空操作
    expect(migrateLegacyLayout(tmpDir)).toEqual([]);
  });

  it("重名拒绝；旧布局未动时同名 default 也拒绝", () => {
    legacyInit();
    expect(() => createGraph(tmpDir, "default", "x")).toThrow(/已存在/);
  });
});

describe("五级优先级链", () => {
  beforeEach(() => {
    legacyInit();
    migrateLegacyLayout(tmpDir);
    createGraph(tmpDir, "billing-v2", "计费");
    createGraph(tmpDir, "refactor-auth", "认证");
  });

  it("explicit > env > process > active > default", () => {
    writeWorkspaceDefault(tmpDir, "billing-v2");
    expect(resolveGraphDir(tmpDir).name).toBe("billing-v2"); // active
    expect(resolveGraphDir(tmpDir, { env: "refactor-auth" }).source).toBe("env");
    expect(resolveGraphDir(tmpDir, { name: "billing-v2", env: "refactor-auth" }).source).toBe("explicit");
    expect(resolveGraphDir(tmpDir, { processActive: "refactor-auth", env: undefined }).source).toBe("process");
    expect(resolveGraphDir(tmpDir, { processActive: "refactor-auth", env: "billing-v2" }).source).toBe("env");
  });

  it("active 文件缺失/非法 → 兜底 default；多图且无 active 且无任何覆盖也回落 default 目录", () => {
    expect(resolveGraphDir(tmpDir).name).toBe("default"); // 无 active 时兜底
    fs.writeFileSync(path.join(tmpDir, ".graph", "active"), "../../etc", "utf-8");
    expect(readWorkspaceDefault(tmpDir)).toBeNull();
    expect(resolveGraphDir(tmpDir).name).toBe("default");
  });

  it("链上候选不存在 → 报错列全部图 + did-you-mean；绝不静默滑到下一级", () => {
    expect(() => resolveGraphDir(tmpDir, { name: "refactor-atuh" })).toThrow(
      /不存在.*refactor-auth/s,
    );
    expect(() => resolveGraphDir(tmpDir, { env: "ghost" })).toThrow(/可用: /);
  });

  it("图名非法 → 立即报错", () => {
    expect(() => resolveGraphDir(tmpDir, { name: "BadName" })).toThrow(/非法图名/);
  });
});

describe("工作区状态与 .trash", () => {
  it("writeWorkspaceDefault 写 active + switch 事件；非法名拒绝", () => {
    legacyInit();
    migrateLegacyLayout(tmpDir);
    createGraph(tmpDir, "a-b", "AB");
    writeWorkspaceDefault(tmpDir, "a-b", "tester");
    expect(readWorkspaceDefault(tmpDir)).toBe("a-b");
    expect(readWorkspaceEvents(tmpDir, { kind: "switch" })[0].detail).toContain("a-b");
    expect(() => writeWorkspaceDefault(tmpDir, "BAD")).toThrow(/非法图名/);
  });

  it("trashGraph 软删除：移入 .trash/<名>-<ts>/，列表不再包含，事件留痕", () => {
    legacyInit();
    migrateLegacyLayout(tmpDir);
    createGraph(tmpDir, "temp-task", "临时");
    const dest = trashGraph(tmpDir, "temp-task", "tester");
    expect(dest).toContain(path.join(".graph", ".trash"));
    expect(fs.existsSync(path.join(dest, "graph.yaml"))).toBe(true);
    expect(listGraphNames(tmpDir)).toEqual(["default"]);
    expect(readWorkspaceEvents(tmpDir, { kind: "delete" })[0].detail).toContain("temp-task");
    expect(() => trashGraph(tmpDir, "ghost")).toThrow(/不存在/);
  });
});

describe("多图隔离（每图独立锁/索引/事件/快照）", () => {
  it("两图并行操作互不串扰", () => {
    legacyInit();
    migrateLegacyLayout(tmpDir);
    createGraph(tmpDir, "graph-a", "A");
    createGraph(tmpDir, "graph-b", "B");
    const gA = path.join(tmpDir, ".graph", "graph-a");
    const gB = path.join(tmpDir, ".graph", "graph-b");

    // F21 起结构写自带 amend 守卫（自动快照 + graph_amended 事件）——本用例主旨是
    // 多图隔离（锁/索引/事件/快照各图独立），传 skipAmendGuard 保持计数与事件流
    // 断言聚焦既有语义；守卫行为由 tests/core/amend.test.ts 专测。
    createNode(gA, { id: "n1", type: NodeType.Task, label: "A 的节点" }, { skipAmendGuard: true });
    createNode(gB, { id: "n1", type: NodeType.Task, label: "B 的同名节点" }, { skipAmendGuard: true }); // 同 id 不同图互不冲突
    createEdge(gA, { id: "e1", source: "n1", target: "n1", type: "depends_on" }, { skipAmendGuard: true });

    // 事件流独立
    expect(readEvents(gA).some((e) => e.kind === "node_created" && e.node === "n1")).toBe(true);
    expect(readEvents(gB)[0].node).toBe("n1");

    // 快照独立
    createSnapshot(gA, "A 的快照");
    expect(listSnapshots(gA)).toHaveLength(1);
    expect(listSnapshots(gB)).toHaveLength(0);

    // 锁目录独立
    expect(fs.existsSync(path.join(gA, ".locks"))).toBe(true);
    expect(fs.existsSync(path.join(gB, ".locks"))).toBe(true);

    // 内容互不污染
    expect(getNode(gA, "n1").label).toBe("A 的节点");
    expect(getNode(gB, "n1").label).toBe("B 的同名节点");
  });

  it("工作区根直连（归一化路径）操作的是 active 图", () => {
    legacyInit();
    migrateLegacyLayout(tmpDir);
    createGraph(tmpDir, "target", "目标图");
    writeWorkspaceDefault(tmpDir, "target");
    createNode(tmpDir, { id: "ws-n1", type: NodeType.Task, label: "经工作区根写入" }); // toGraphDir 自动降入 target
    expect(getNode(path.join(tmpDir, ".graph", "target"), "ws-n1").id).toBe("ws-n1");
    expect(fs.existsSync(path.join(tmpDir, ".graph", "default", "nodes", "ws-n1.yaml"))).toBe(false);
  });
});

describe("并发迁移锁（cp_cross：无双迁）", () => {
  it("两个进程并发建图 → 旧布局只迁移一次，两图都建成功", async () => {
    legacyInit();
    const { spawn } = await import("node:child_process");
    const cli = path.resolve("dist/cli/index.js");
    const runOne = (name: string) =>
      new Promise<number>((resolve) => {
        const p = spawn(process.execPath, [cli, "init", name, "-l", name], {
          cwd: tmpDir,
          stdio: "ignore",
        });
        p.on("exit", (code) => resolve(code ?? 1));
      });
    const [c1, c2] = await Promise.all([runOne("con-a"), runOne("con-b")]);
    expect(c1).toBe(0);
    expect(c2).toBe(0);
    // 迁移只发生一次（workspace-events migrate 计数 = 1）
    expect(readWorkspaceEvents(tmpDir, { kind: "migrate" })).toHaveLength(1);
    expect(listGraphNames(tmpDir).sort()).toEqual(["con-a", "con-b", "default"]);
    // default 数据无损（迁移进 default/ 后再无二次搬动）
    expect(fs.existsSync(path.join(tmpDir, ".graph", "default", "graph.yaml"))).toBe(true);
  });
});
