// tests/web/graph-routing.test.ts — v0.5.2 多图事件路由（纯函数单测）
// routeGraphEvent 把 .graph/ 下的文件事件按路径前缀分类到所属图：
// - 旧布局（.graph/graph.yaml 原地）：全部图内事件归 default；
// - 多图布局：.graph/<图名>/… 路由到该图；
// - 工作区级文件（active/schema.yaml/workspace-events.jsonl）与 .trash/ 不入图事件流；
// - 图集合变化（建图/删图/迁移/active 切换）→ rescan。
import { describe, it, expect } from "vitest";
import { routeGraphEvent } from "../../src/web/server.js";

const MULTI: { names: string[]; legacy: boolean } = { names: ["alpha", "beta"], legacy: false };
const LEGACY: { names: string[]; legacy: boolean } = { names: ["default"], legacy: true };

describe("routeGraphEvent — 多图布局", () => {
  it("节点/边/图文件按一级目录路由到所属图", () => {
    expect(routeGraphEvent({ type: "change", file: ".graph/alpha/nodes/a.yaml" }, MULTI)).toEqual({
      rescan: false,
      graph: "alpha",
      kind: "node",
    });
    expect(routeGraphEvent({ type: "change", file: ".graph/beta/edges/e1.yaml" }, MULTI)).toEqual({
      rescan: false,
      graph: "beta",
      kind: "edge",
    });
    expect(routeGraphEvent({ type: "change", file: ".graph/alpha/graph.yaml" }, MULTI)).toEqual({
      rescan: false,
      graph: "alpha",
      kind: "graph",
    });
  });

  it("Windows 反斜杠路径归一后同样路由", () => {
    expect(routeGraphEvent({ type: "change", file: ".graph\\alpha\\nodes\\a.yaml" }, MULTI)).toEqual({
      rescan: false,
      graph: "alpha",
      kind: "node",
    });
  });

  it("工作区级文件不入图事件流（schema.yaml / workspace-events.jsonl）", () => {
    expect(routeGraphEvent({ type: "change", file: ".graph/schema.yaml" }, MULTI)).toBeNull();
    expect(
      routeGraphEvent({ type: "change", file: ".graph/workspace-events.jsonl" }, MULTI),
    ).toBeNull();
  });

  it("active 文件变化 → rescan（刷新图列表 active 标记）", () => {
    expect(routeGraphEvent({ type: "change", file: ".graph/active" }, MULTI)).toEqual({ rescan: true });
  });

  it(".trash/ 内的任何事件忽略（软删除回收站）", () => {
    expect(routeGraphEvent({ type: "add", file: ".graph/.trash/alpha-123/nodes/a.yaml" }, MULTI)).toBeNull();
    expect(routeGraphEvent({ type: "addDir", file: ".graph/.trash" }, MULTI)).toBeNull();
  });

  it("新图落地（graph.yaml add）→ rescan；未知一级目录 → rescan", () => {
    expect(routeGraphEvent({ type: "add", file: ".graph/gamma/graph.yaml" }, MULTI)).toEqual({
      rescan: true,
    });
    expect(routeGraphEvent({ type: "add", file: ".graph/gamma/nodes/x.yaml" }, MULTI)).toEqual({
      rescan: true,
    });
  });

  it("图被删（graph.yaml unlink）→ rescan", () => {
    expect(routeGraphEvent({ type: "unlink", file: ".graph/beta/graph.yaml" }, MULTI)).toEqual({
      rescan: true,
    });
  });

  it("图内非派生文件（other）仍路由到该图（全量兜底）", () => {
    expect(routeGraphEvent({ type: "add", file: ".graph/alpha/some-note.txt" }, MULTI)).toEqual({
      rescan: false,
      graph: "alpha",
      kind: "other",
    });
  });

  it(".graph/ 之外的路径忽略", () => {
    expect(routeGraphEvent({ type: "change", file: "src/index.ts" }, MULTI)).toBeNull();
  });
});

describe("routeGraphEvent — 旧布局（.graph/graph.yaml 原地）", () => {
  it("图内事件全部归 default（含裸 nodes/edges 路径）", () => {
    expect(routeGraphEvent({ type: "change", file: ".graph/nodes/a.yaml" }, LEGACY)).toEqual({
      rescan: false,
      graph: "default",
      kind: "node",
    });
    expect(routeGraphEvent({ type: "change", file: ".graph/edges/e1.yaml" }, LEGACY)).toEqual({
      rescan: false,
      graph: "default",
      kind: "edge",
    });
    expect(routeGraphEvent({ type: "change", file: ".graph/graph.yaml" }, LEGACY)).toEqual({
      rescan: false,
      graph: "default",
      kind: "graph",
    });
  });

  it("工作区级文件忽略；active 变化 rescan", () => {
    expect(routeGraphEvent({ type: "change", file: ".graph/schema.yaml" }, LEGACY)).toBeNull();
    expect(
      routeGraphEvent({ type: "change", file: ".graph/workspace-events.jsonl" }, LEGACY),
    ).toBeNull();
    expect(routeGraphEvent({ type: "change", file: ".graph/active" }, LEGACY)).toEqual({
      rescan: true,
    });
  });

  it("根 graph.yaml unlink（迁移/删除）→ rescan；未知一级目录（迁移产生的 default/）→ rescan", () => {
    expect(routeGraphEvent({ type: "unlink", file: ".graph/graph.yaml" }, LEGACY)).toEqual({
      rescan: true,
    });
    expect(routeGraphEvent({ type: "add", file: ".graph/default/graph.yaml" }, LEGACY)).toEqual({
      rescan: true,
    });
  });

  it("点开头目录（.trash/.locks）忽略", () => {
    expect(routeGraphEvent({ type: "add", file: ".graph/.trash/x.yaml" }, LEGACY)).toBeNull();
  });
});
