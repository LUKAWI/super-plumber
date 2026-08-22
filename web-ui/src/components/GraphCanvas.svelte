<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import { graphState } from "../lib/store.svelte";
  import { computeFitTransform } from "../lib/layout";
  import {
    STATUS_COLORS,
    EDGE_TYPE_COLORS,
    EDGE_TYPE_LABELS,
    statusColorOf,
    type GraphIndex,
    type NodeSchema,
    type EdgeSchema,
    type EdgeType,
  } from "../lib/types";
  import {
    adrBadgesFor,
    contextColors,
    contextHullGroups,
    isContractEdge,
    isEdgeVisibleInMaps,
    isNodeVisibleInMaps,
    type AdrBadge,
  } from "../lib/maps";

  // Extend NodeSchema with D3 simulation properties
  type SimNode = NodeSchema & d3.SimulationNodeDatum;
  type SimEdge = EdgeSchema & { source: SimNode | string; target: SimNode | string };

  let svgEl: SVGSVGElement;
  let wrapperEl: HTMLDivElement;
  let tooltipEl: HTMLDivElement;
  let simulation: d3.Simulation<SimNode, undefined> | null = null;
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let zoomGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

  // 布局持久化：全量重渲染时复用节点坐标（P4-2：加一条边不再全图重抖）
  const positions = new Map<string, { x: number; y: number }>();
  let currentNodes: SimNode[] = [];
  let currentEdges: SimEdge[] = [];
  let pinned = $state(false);

  // v0.5 map 透镜渲染上下文（renderGraph 时重建）
  let currentGraph: GraphIndex | null = null;
  let byIdCache: Map<string, NodeSchema> = new Map();
  let currentContextColors: Map<string, string> = new Map();

  interface HullRender {
    contextId: string;
    label: string;
    color: string;
    members: SimNode[];
    ctxNode?: SimNode;
  }
  let currentHulls: HullRender[] = [];

  interface BadgeRender extends AdrBadge {
    stack: number;
  }
  let currentBadges: BadgeRender[] = [];

  const prefersReducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const ENTER_DURATION = prefersReducedMotion ? 0 : 400;
  const HOVER_DURATION = prefersReducedMotion ? 0 : 150;
  const NODE_R = 20;
  const CONTEXT_R = 26; // context 顶点（领域视图）：虚线大圆
  const HULL_PAD = NODE_R + 14; // hull 外扩半径

  function nodeR(d: SimNode): number {
    return d.type === "context" ? CONTEXT_R : NODE_R;
  }

  function getContainerSize() {
    return { w: wrapperEl?.clientWidth || 960, h: wrapperEl?.clientHeight || 680 };
  }

  const isOverlay = $derived(graphState.activeMaps.workflow && graphState.activeMaps.domain);

  /** 当前透镜下可见顶点数（两个 map 都关 = 0 → 空视图提示） */
  const lensVisibleCount = $derived.by(() => {
    const g = graphState.graph;
    const m = graphState.activeMaps;
    if (!g) return 0;
    return g.nodes.filter((n) => isNodeVisibleInMaps(n, m)).length;
  });

  // ── 过滤（map 透镜 + 层级 + 搜索）与 diff 着色的命中判断 ──

  /** 顶点在当前透镜下是否以节点圆呈现：
   *  workflow/domain 单独视图 → 所属 map 勾选即可见；
   *  叠加视图 → context 由 hull 簇壳替代，节点圆隐藏（模拟仍参与以锚定 relates） */
  function nodeRendered(n: NodeSchema): boolean {
    if (!isNodeVisibleInMaps(n, graphState.activeMaps)) return false;
    if (isOverlay && n.type === "context") return false;
    return true;
  }

  function nodeMatchesFilters(n: NodeSchema): boolean {
    const levels = graphState.levelFilter;
    if (levels !== null && !levels.includes(n.level)) return false;
    const q = graphState.query.trim().toLowerCase();
    if (q && !n.id.toLowerCase().includes(q) && !n.label.toLowerCase().includes(q)) return false;
    return true;
  }

  function edgeEndId(v: SimNode | string): string {
    return typeof v === "object" ? (v as SimNode).id : v;
  }

  /** 边可见性规则：两端顶点所属 map 全部勾选（decides 边已在渲染前剔除） */
  function edgeRendered(e: SimEdge): boolean {
    const sid = edgeEndId(e.source);
    const tid = edgeEndId(e.target);
    return isEdgeVisibleInMaps(
      { id: e.id, source: sid, target: tid, type: e.type },
      byIdCache,
      graphState.activeMaps,
    );
  }

  /** 契约边（叠加视图）：非知识边 + 两端分属不同 context */
  function edgeIsContract(e: SimEdge): boolean {
    if (!isOverlay) return false;
    return isContractEdge(
      { id: e.id, source: edgeEndId(e.source), target: edgeEndId(e.target), type: e.type },
      byIdCache,
    );
  }

  function diffClassOf(kind: "node" | "edge", id: string): string | null {
    const d = graphState.diff;
    if (!d) return null;
    const prefix = kind === "node" ? `nodes/${id}.yaml` : `edges/${id}.yaml`;
    if (d.added.includes(prefix)) return "diff-added";
    if (d.removed.includes(prefix)) return "diff-removed";
    if (d.modified.includes(prefix)) return "diff-modified";
    return null;
  }

  // 边视觉基线（契约边高亮 = 提高不透明度/线宽 + 虚线；hover 恢复时回到此基线）
  function edgeBaseOpacity(e: EdgeSchema): number {
    return edgeIsContract(e as SimEdge) ? 0.6 : 0.28;
  }
  function edgeBaseWidth(e: EdgeSchema): number {
    return edgeIsContract(e as SimEdge) ? 2.2 : 1.5;
  }

  function edgeLabelOf(e: EdgeSchema): string {
    if (e.type === "relates") return e.rel_kind || EDGE_TYPE_LABELS.relates;
    return EDGE_TYPE_LABELS[e.type] ?? e.type;
  }

  function applyFiltersAndDiff() {
    if (!svgEl || !zoomGroup) return;
    const nodeSel = zoomGroup.selectAll<SVGGElement, SimNode>(".nodes > g.node");
    nodeSel
      .classed("map-hidden", (d: SimNode) => !nodeRendered(d))
      .classed("dimmed", (d: SimNode) => !nodeMatchesFilters(d));
    const diffMap = new Map<string, string | null>();
    for (const n of currentNodes) diffMap.set(n.id, diffClassOf("node", n.id));
    nodeSel
      .classed("diff-added", (d: SimNode) => diffMap.get(d.id) === "diff-added")
      .classed("diff-removed", (d: SimNode) => diffMap.get(d.id) === "diff-removed")
      .classed("diff-modified", (d: SimNode) => diffMap.get(d.id) === "diff-modified");

    const edgeSel = zoomGroup.selectAll<SVGGElement, SimEdge>(".edges .edge-group");
    edgeSel
      .classed("map-hidden", (d: SimEdge) => !edgeRendered(d))
      .classed("contract-edge", (d: SimEdge) => edgeIsContract(d));
    const edgeDiff = new Map<string, string | null>();
    for (const e of currentEdges) edgeDiff.set(e.id, diffClassOf("edge", e.id));
    edgeSel
      .classed("diff-added", (d: SimEdge) => edgeDiff.get(d.id) === "diff-added")
      .classed("diff-removed", (d: SimEdge) => edgeDiff.get(d.id) === "diff-removed")
      .classed("diff-modified", (d: SimEdge) => edgeDiff.get(d.id) === "diff-modified");
    // 契约边高亮（属性级，hover 恢复用 edgeBase* 基线）
    edgeSel.select<SVGLineElement>(".edge-line")
      .attr("stroke-opacity", (d: SimEdge) => edgeBaseOpacity(d))
      .attr("stroke-width", (d: SimEdge) => edgeBaseWidth(d))
      .attr("stroke-dasharray", (d: SimEdge) => (edgeIsContract(d) ? "7 4" : null));
  }

  // ── 叠加视图装饰：hull 簇壳 + ADR 徽章 ──

  /** 从模拟节点重建 hull 分组与徽章（渲染/数据变化时调用） */
  function refreshOverlayDecorations() {
    if (!zoomGroup) return;
    if (!isOverlay) {
      zoomGroup.selectAll(".hulls,.adr-badges").remove();
      currentHulls = [];
      currentBadges = [];
      return;
    }
    // hull：context id → 成员工作流节点
    currentHulls = [...contextHullGroups(currentNodes as NodeSchema[])]
      .map(([contextId, members]) => ({
        contextId,
        label: byIdCache.get(contextId)?.label ?? contextId,
        color: currentContextColors.get(contextId) ?? "#8a8f98",
        members: members as SimNode[],
        ...(currentNodes.find((n) => n.id === contextId) ? { ctxNode: currentNodes.find((n) => n.id === contextId) } : {}),
      }));

    // 徽章：decides 边 → ADR 附着（同锚点堆叠）
    const badges = currentGraph ? adrBadgesFor(currentGraph.nodes, currentGraph.edges) : [];
    const stackCount = new Map<string, number>();
    currentBadges = badges.map((b) => {
      const stack = stackCount.get(b.anchorNodeId) ?? 0;
      stackCount.set(b.anchorNodeId, stack + 1);
      return { ...b, stack };
    });

    renderHullLayer();
    renderBadgeLayer();
    updateHullsAndBadges();
  }

  /** hull 平滑路径：顶点外扩 + Catmull-Rom 闭合曲线；<3 点时以质心合成圆环 */
  function hullGeometry(members: SimNode[], pad: number): { d: string; cx: number; topY: number } | null {
    const pts: [number, number][] = [];
    for (const m of members) {
      if (Number.isFinite(m.x) && Number.isFinite(m.y)) pts.push([m.x as number, m.y as number]);
    }
    if (pts.length === 0) return null;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
    }
    cx /= pts.length;
    cy /= pts.length;
    let base: [number, number][];
    if (pts.length < 3) {
      let r = pad;
      for (const p of pts) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy) + pad);
      base = Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
      });
    } else {
      const hull = d3.polygonHull(pts);
      if (!hull) return null;
      base = hull.map((p) => {
        const dx = p[0] - cx;
        const dy = p[1] - cy;
        const len = Math.hypot(dx, dy) || 1;
        return [p[0] + (dx / len) * pad, p[1] + (dy / len) * pad] as [number, number];
      });
    }
    let minY = Infinity;
    let sumX = 0;
    for (const p of base) {
      minY = Math.min(minY, p[1]);
      sumX += p[0];
    }
    const line = d3.line<[number, number]>()
      .x((p) => p[0])
      .y((p) => p[1])
      .curve(d3.curveCatmullRomClosed.alpha(0.8));
    const d = line(base);
    if (!d) return null;
    return { d, cx: sumX / base.length, topY: minY };
  }

  function renderHullLayer() {
    if (!zoomGroup) return;
    let hullG = zoomGroup.select<SVGGElement>("g.hulls");
    if (hullG.empty()) {
      // 插到最底层（edges/nodes 之前）
      hullG = zoomGroup.insert<SVGGElement>("g", ":first-child").attr("class", "hulls");
    }
    const sel = hullG
      .selectAll<SVGGElement, HullRender>("g.hull")
      .data(currentHulls, (h) => h.contextId);
    sel.exit().remove();
    const enter = sel.enter().append("g").attr("class", "hull");
    enter.append("path").attr("class", "hull-path");
    enter.append("text").attr("class", "hull-label");
    const all = enter.merge(sel);
    all.select(".hull-path")
      .attr("fill", (h) => h.color)
      .attr("fill-opacity", 0.07)
      .attr("stroke", (h) => h.color)
      .attr("stroke-opacity", 0.45)
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "6 4")
      .style("cursor", "pointer")
      .on("click", (_event: MouseEvent, h: HullRender) => {
        const full = currentGraph?.nodes.find((n) => n.id === h.contextId);
        if (full) graphState.selectNode(full);
      });
    all.select(".hull-label")
      .text((h) => `${h.label} · ${h.members.length}`)
      .attr("text-anchor", "middle")
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", "10px")
      .attr("font-weight", "600")
      .attr("fill", (h) => h.color)
      .attr("paint-order", "stroke")
      .attr("stroke", "#000000")
      .attr("stroke-width", "3px")
      .attr("stroke-linejoin", "round")
      .style("pointer-events", "none")
      .style("user-select", "none");
  }

  function renderBadgeLayer() {
    if (!zoomGroup) return;
    let badgeG = zoomGroup.select<SVGGElement>("g.adr-badges");
    if (badgeG.empty()) badgeG = zoomGroup.append("g").attr("class", "adr-badges");
    const sel = badgeG
      .selectAll<SVGGElement, BadgeRender>("g.adr-badge")
      .data(currentBadges, (b) => `${b.adrId}:${b.anchorNodeId}`);
    sel.exit().remove();
    const enter = sel.enter().append("g").attr("class", "adr-badge");
    enter.append("rect").attr("class", "adr-badge-box");
    enter.append("text").attr("class", "adr-badge-text");
    const all = enter.merge(sel);
    all.select(".adr-badge-box")
      .attr("rx", 3)
      .attr("height", 14)
      .attr("fill", "#14161a")
      .attr("fill-opacity", 0.92)
      .attr("stroke", (b) => statusColorOf(b.status))
      .attr("stroke-width", (b) => (b.status === "superseded" ? 1.5 : 1))
      .attr("stroke-dasharray", (b) => (b.status === "proposed" ? "3 2" : null));
    all.select(".adr-badge-text")
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", "8.5px")
      .attr("font-weight", "600")
      .attr("dominant-baseline", "central")
      .attr("fill", (b) => statusColorOf(b.status))
      .attr("paint-order", "stroke")
      .attr("stroke", "#000000")
      .attr("stroke-width", "2.5px")
      .attr("stroke-linejoin", "round")
      .style("user-select", "none")
      .text((b) => {
        const mark = b.status === "superseded" ? "⊘" : b.status === "accepted" ? "●" : "○";
        const t = b.title.length > 12 ? `${b.title.slice(0, 11)}…` : b.title;
        return `${mark} ${t}`;
      });
    all
      .attr("cursor", "pointer")
      .on("click", (event: MouseEvent, b: BadgeRender) => {
        event.stopPropagation();
        const full = currentGraph?.nodes.find((n) => n.id === b.adrId);
        if (full) graphState.selectNode(full);
      });
    all.select<SVGRectElement>(".adr-badge-box").each(function (this: SVGRectElement, b: BadgeRender) {
      const text = this.parentElement?.querySelector(".adr-badge-text") as SVGTextElement | null;
      const w = 12 + (text?.getComputedTextLength?.() ?? b.title.length * 5);
      d3.select(this)
        .attr("width", Math.max(30, w))
        .attr("x", -2)
        .attr("y", -14);
    });
    all.select(".adr-badge-text").attr("x", 4).attr("y", -7);
  }

  /** 每 tick 更新 hull 路径 / 标签 / 徽章锚点 */
  function updateHullsAndBadges() {
    if (!zoomGroup || !isOverlay) return;
    const hullGeom = new Map<string, { d: string; cx: number; topY: number } | null>();
    zoomGroup.selectAll<SVGGElement, HullRender>(".hulls g.hull").each(function (this: SVGGElement, h: HullRender) {
      const geom = hullGeometry(h.members, HULL_PAD);
      hullGeom.set(h.contextId, geom);
      const g = d3.select(this);
      if (!geom) {
        g.attr("display", "none");
        return;
      }
      g.attr("display", null);
      g.select(".hull-path").attr("d", geom.d);
      g.select(".hull-label").attr("x", geom.cx).attr("y", geom.topY + 15);
    });
    zoomGroup.selectAll<SVGGElement, BadgeRender>(".adr-badges g.adr-badge").each(function (this: SVGGElement, b: BadgeRender) {
      const g = d3.select(this);
      let x: number | null = null;
      let y: number | null = null;
      if (b.anchorIsContext) {
        const geom = hullGeom.get(b.anchorNodeId);
        if (geom) {
          x = geom.cx;
          y = geom.topY - 12 - b.stack * 17;
        }
      } else {
        const node = currentNodes.find((n) => n.id === b.anchorNodeId);
        if (node && Number.isFinite(node.x) && Number.isFinite(node.y)) {
          x = (node.x as number) + nodeR(node) + 6;
          y = (node.y as number) - nodeR(node) - 6 - b.stack * 17;
        }
      }
      if (x === null || y === null) {
        g.attr("display", "none");
        return;
      }
      g.attr("display", null).attr("transform", `translate(${x},${y})`);
    });
  }

  // ── 边层渲染（全量/增量共用）──
  function renderEdgeLayer(
    parent: d3.Selection<SVGGElement, unknown, null, undefined>,
    edges: SimEdge[],
  ) {
    let linkG = parent.select<SVGGElement>(".edges");
    if (linkG.empty()) linkG = parent.append("g").attr("class", "edges");

    const link = linkG
      .selectAll<SVGGElement, SimEdge>("g.edge-group")
      .data(edges, (d) => d.id);

    link.exit().remove();

    const enter = link
      .enter()
      .append("g")
      .attr("class", "edge-group")
      .style("cursor", "pointer");

    enter.append("line").attr("class", "edge-line");
    enter.append("text").attr("class", "edge-label");

    const all = enter.merge(link);

    all
      .select(".edge-line")
      .attr("stroke", (d: SimEdge) => EDGE_TYPE_COLORS[d.type] ?? "#ffffff")
      .attr("stroke-opacity", edgeBaseOpacity)
      .attr("stroke-width", edgeBaseWidth)
      .attr("marker-end", "url(#arrowhead)");

    all
      .select(".edge-label")
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("font-family", "var(--font-mono)")
      .attr("fill", (d: SimEdge) => EDGE_TYPE_COLORS[d.type] ?? "#fff")
      .attr("paint-order", "stroke")
      .attr("stroke", "#000000")
      .attr("stroke-width", "3px")
      .attr("stroke-linejoin", "round")
      .attr("opacity", 0)
      .text(edgeLabelOf);

    // hover 高亮 + 点击选中（边详情）
    all
      .on("mouseenter", function (this: SVGGElement) {
        const group = d3.select(this);
        group.select(".edge-line")
          .attr("stroke-opacity", 0.9)
          .attr("stroke-width", 2.5);
        group.select(".edge-label").attr("opacity", 1);
        const d = group.datum() as SimEdge;
        const srcId = edgeEndId(d.source);
        const tgtId = edgeEndId(d.target);
        const nodeSel = parent.selectAll<SVGGElement, SimNode>(".nodes > g.node");
        nodeSel
          .filter((n: SimNode) => n.id === srcId || n.id === tgtId)
          .select(".node-circle")
          .attr("stroke", "rgba(255, 255, 255, 0.9)")
          .attr("stroke-width", 2.5);
      })
      .on("mouseleave", function (this: SVGGElement) {
        const group = d3.select(this);
        const d = group.datum() as SimEdge;
        group.select(".edge-line")
          .attr("stroke-opacity", edgeBaseOpacity(d))
          .attr("stroke-width", edgeBaseWidth(d));
        group.select(".edge-label").attr("opacity", 0);
        const srcId = edgeEndId(d.source);
        const tgtId = edgeEndId(d.target);
        const selected = graphState.selectedNode?.id;
        const nodeSel = parent.selectAll<SVGGElement, SimNode>(".nodes > g.node");
        nodeSel
          .filter((n: SimNode) => n.id === srcId || n.id === tgtId)
          .select(".node-circle")
          .attr("stroke", (n: SimNode) => (n.id === selected ? "var(--ink)" : defaultNodeStroke(n)))
          .attr("stroke-width", (n: SimNode) => (n.id === selected ? 3 : defaultNodeStrokeWidth(n)));
      })
      .on("click", function (this: SVGGElement) {
        const group = d3.select(this);
        const d = group.datum() as SimEdge;
        graphState.selectEdge({
          id: d.id,
          source: edgeEndId(d.source),
          target: edgeEndId(d.target),
          type: d.type,
          ...(d.contract ? { contract: d.contract } : {}),
          ...(d.rel_kind ? { rel_kind: d.rel_kind } : {}),
        });
      });

    return { linkG, all };
  }

  // ── 节点视觉基线（context 顶点用 hull 色 + 虚线，选中/悬停恢复时回此基线）──
  function defaultNodeStroke(d: SimNode): string {
    if (d.type === "context") return currentContextColors.get(d.id) ?? "rgba(255, 255, 255, 0.6)";
    return d.status === "running" ? STATUS_COLORS.running : "rgba(255, 255, 255, 0.6)";
  }
  function defaultNodeStrokeWidth(d: SimNode): number {
    if (d.type === "context") return 2;
    return d.status === "running" ? 2.5 : 1.5;
  }

  // ── 节点层渲染 ──
  function renderNodeLayer(parent: d3.Selection<SVGGElement, unknown, null, undefined>, nodes: SimNode[]) {
    let nodeG = parent.select<SVGGElement>(".nodes");
    if (nodeG.empty()) nodeG = parent.append("g").attr("class", "nodes");

    const node = nodeG
      .selectAll<SVGGElement, SimNode>("g.node")
      .data(nodes, (d: SimNode) => d.id);

    node.exit().remove();

    const enter = node.enter().append("g").attr("class", "node").style("cursor", "pointer");

    enter.append("circle").attr("class", "node-circle");
    enter.append("circle").attr("class", "status-ring");
    enter.append("text").attr("class", "node-label");
    enter.append("rect").attr("class", "cp-track");
    enter.append("rect").attr("class", "cp-fill");
    enter.append("text").attr("class", "assign-label");

    const all = enter.merge(node);

    // Node circles: context 顶点 = 虚线大圆 + hull 色；工作流顶点 = 白描边圆
    all.select(".node-circle")
      .attr("r", (d: SimNode) => nodeR(d))
      .attr("fill", (d: SimNode) =>
        d.type === "context"
          ? (currentContextColors.get(d.id) ?? "#8a8f98")
          : "rgba(255, 255, 255, 0.02)")
      .attr("fill-opacity", (d: SimNode) => (d.type === "context" ? 0.16 : null))
      .attr("stroke", defaultNodeStroke)
      .attr("stroke-dasharray", (d: SimNode) => (d.type === "context" ? "5 4" : null))
      .attr("stroke-width", defaultNodeStrokeWidth);

    all.select(".status-ring")
      .attr("r", (d: SimNode) => nodeR(d) + 3)
      .attr("fill", "none")
      .attr("stroke", (d: SimNode) => statusColorOf(d.status))
      .attr("stroke-width", (d: SimNode) => (d.status === "running" ? 3 : 2))
      .attr("stroke-opacity", (d: SimNode) => (d.type === "context" ? 0 : 0.7));

    all.select(".node-label")
      .text((d: SimNode) => {
        const max = d.type === "context" ? 18 : 14;
        return d.label.length > max ? `${d.label.slice(0, max - 2)}…` : d.label;
      })
      .attr("text-anchor", "middle")
      .attr("dy", 4)
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", "10px")
      .attr("font-weight", "600")
      .attr("fill", (d: SimNode) => (d.type === "context" ? currentContextColors.get(d.id) ?? "var(--ink)" : "var(--ink)"))
      .attr("letter-spacing", "0.04em")
      .style("pointer-events", "none")
      .style("user-select", "none");

    // checkpoint 进度条
    all.select(".cp-track")
      .attr("x", -14).attr("y", (d: SimNode) => nodeR(d) + 12)
      .attr("width", 28).attr("height", 3)
      .attr("rx", 1.5)
      .attr("fill", "rgba(255, 255, 255, 0.1)")
      .attr("opacity", (d: SimNode) => (d.checkpoints?.length ? 1 : 0));
    all.select(".cp-fill")
      .attr("x", -14).attr("y", (d: SimNode) => nodeR(d) + 12)
      .attr("width", (d: SimNode) => {
        const cps = d.checkpoints ?? [];
        const done = cps.filter((c) => c.status === "passed").length;
        return cps.length ? (done / cps.length) * 28 : 0;
      })
      .attr("height", 3)
      .attr("rx", 1.5)
      .attr("fill", (d: SimNode) => (d.status === "failed" ? "#e5504f" : "#34c964"))
      .attr("opacity", (d: SimNode) => (d.checkpoints?.length ? 1 : 0));

    // 执行者标签（running 节点）
    all.select(".assign-label")
      .text((d: SimNode) => (d.status === "running" && d.assigned_to ? d.assigned_to : ""))
      .attr("text-anchor", "middle")
      .attr("y", (d: SimNode) => -nodeR(d) - 8)
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", "8px")
      .attr("font-weight", "500")
      .attr("fill", "#f0a73a")
      .attr("opacity", (d: SimNode) => (d.status === "running" && d.assigned_to ? 0.9 : 0))
      .style("pointer-events", "none")
      .style("user-select", "none");

    // running 高亮
    all.select(".node-circle")
      .attr("filter", (d: SimNode) => (d.status === "running" ? "url(#glow)" : null))
      .attr("stroke", defaultNodeStroke)
      .attr("stroke-width", defaultNodeStrokeWidth);
    all.select(".status-ring")
      .attr("stroke-width", (d: SimNode) => (d.status === "running" ? 3 : 2));

    // 交互：hover 放大 + tooltip + 点击选中
    all
      .on("mouseenter", function (this: SVGGElement, event: MouseEvent) {
        const el = this;
        const d = d3.select(el).datum() as SimNode;
        const max = d.type === "context" ? 18 : 14;
        if (d.label.length > max && tooltipEl) {
          const rect = wrapperEl.getBoundingClientRect();
          tooltipEl.textContent = d.label;
          tooltipEl.style.display = "block";
          tooltipEl.style.left = `${event.clientX - rect.left + 12}px`;
          tooltipEl.style.top = `${event.clientY - rect.top - 8}px`;
        }
        if (prefersReducedMotion) return;
        d3.select(el).select(".node-circle")
          .transition().duration(HOVER_DURATION)
          .attr("r", nodeR(d) + 4)
          .attr("stroke", "rgba(255, 255, 255, 0.9)")
          .attr("stroke-width", 2);
        d3.select(el).select(".status-ring")
          .transition().duration(HOVER_DURATION)
          .attr("r", nodeR(d) + 7)
          .attr("stroke-opacity", 1);
      })
      .on("mouseleave", function (this: SVGGElement) {
        if (tooltipEl) tooltipEl.style.display = "none";
        if (prefersReducedMotion) return;
        const el = this;
        const d = d3.select(el).datum() as SimNode;
        d3.select(el).select(".node-circle")
          .transition().duration(HOVER_DURATION)
          .attr("r", nodeR(d))
          .attr("stroke", defaultNodeStroke(d))
          .attr("stroke-width", defaultNodeStrokeWidth(d));
        d3.select(el).select(".status-ring")
          .transition().duration(HOVER_DURATION)
          .attr("r", nodeR(d) + 3)
          .attr("stroke-opacity", d.type === "context" ? 0 : 0.7);
      })
      .on("click", function (event: MouseEvent, d: SimNode) {
        graphState.selectNode(d);
        if (!prefersReducedMotion) {
          d3.select(event.currentTarget as SVGGElement).select(".node-circle")
            .transition().duration(100)
            .attr("r", nodeR(d) + 6)
            .transition().duration(150)
            .attr("r", nodeR(d));
        }
      });

    // 拖拽（位置写入缓存）
    const drag = d3.drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active && simulation) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
        positions.set(d.id, { x: event.x, y: event.y });
      })
      .on("end", (event, d) => {
        if (!event.active && simulation) simulation.alphaTarget(0);
        if (pinned) {
          d.fx = d.x;
          d.fy = d.y; // 固定布局模式下保持钉住
        } else {
          d.fx = null;
          d.fy = null;
        }
        positions.set(d.id, { x: d.x ?? 0, y: d.y ?? 0 });
      });
    all.call(drag as never);

    return { nodeG, all };
  }

  /** 叠加视图专属力：成员 ↔ context 质心弹簧（空间归属，不画归属连线） */
  function contextClusterForce(alpha: number) {
    for (const h of currentHulls) {
      if (!h.ctxNode || h.members.length === 0) continue;
      const ctx = h.ctxNode;
      let cx = 0;
      let cy = 0;
      for (const m of h.members) {
        cx += (m.x ?? 0);
        cy += (m.y ?? 0);
      }
      cx /= h.members.length;
      cy /= h.members.length;
      const k = 0.08 * alpha;
      // context 拉向成员质心（快），成员拉向 context（慢，避免压塌工作流结构）
      if (ctx.vx !== undefined && ctx.vy !== undefined) {
        ctx.vx += (cx - (ctx.x ?? 0)) * k * 2;
        ctx.vy += (cy - (ctx.y ?? 0)) * k * 2;
      }
      for (const m of h.members) {
        if (m.vx === undefined || m.vy === undefined) continue;
        m.vx += ((ctx.x ?? 0) - (m.x ?? 0)) * k;
        m.vy += ((ctx.y ?? 0) - (m.y ?? 0)) * k;
      }
    }
  }

  // ── 全量渲染（节点集合 / 透镜变化时；位置缓存 + 缩放保持）──
  function renderGraph(graph: GraphIndex) {
    if (!svgEl || !graph || !wrapperEl) return;
    const { w, h } = getContainerSize();
    const overlay = isOverlay;

    stopFlowDots();
    const svg = d3.select(svgEl);
    const previousTransform = (svgEl as SVGSVGElement & { __zoom?: d3.ZoomTransform }).__zoom;

    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${w} ${h}`).attr("preserveAspectRatio", "xMidYMid meet");

    // 渲染上下文重建
    currentGraph = graph;
    byIdCache = new Map(graph.nodes.map((n) => [n.id, n]));
    currentContextColors = contextColors(graph.nodes.filter((n) => n.type === "context").map((n) => n.id));

    // defs
    const defs = svg.append("defs");
    defs.append("pattern")
      .attr("id", "dot-grid")
      .attr("x", 0).attr("y", 0)
      .attr("width", 20).attr("height", 20)
      .attr("patternUnits", "userSpaceOnUse")
      .append("circle")
      .attr("cx", 10).attr("cy", 10)
      .attr("r", 0.8)
      .attr("fill", "rgba(255, 255, 255, 0.04)");
    defs.append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 26).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "rgba(255, 255, 255, 0.3)");
    const glowFilter = defs.append("filter")
      .attr("id", "glow")
      .attr("x", "-50%").attr("y", "-50%")
      .attr("width", "200%").attr("height", "200%");
    glowFilter.append("feGaussianBlur").attr("stdDeviation", 4).attr("result", "coloredBlur");
    const feMerge = glowFilter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    svg.append("rect")
      .attr("width", w).attr("height", h)
      .attr("fill", "url(#dot-grid)")
      .attr("class", "grid-bg");

    // 缩放组（复用一个 zoom behavior，保持用户视角）
    zoomGroup = svg.append("g").attr("class", "zoom-group");
    if (!zoomBehavior) {
      zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 4])
        .on("zoom", (event) => {
          if (zoomGroup) zoomGroup.attr("transform", event.transform);
          const gridOpacity = Math.min(1, event.transform.k * 1.5);
          svg.select(".grid-bg").attr("opacity", gridOpacity);
        });
      svg.call(zoomBehavior)
        .on("dblclick.zoom", () => {
          svg.transition().duration(prefersReducedMotion ? 0 : 500)
            .call(zoomBehavior!.transform, d3.zoomIdentity);
        })
        .style("cursor", "grab");
      svg.on("mousedown.zoom", () => svg.style("cursor", "grabbing"));
      svg.on("mouseup.zoom", () => svg.style("cursor", "grab"));
    } else {
      svg.call(zoomBehavior);
    }
    if (previousTransform) {
      zoomGroup.attr("transform", previousTransform as unknown as string);
    }

    // 节点（位置缓存种子；ADR 顶点不进模拟——以徽章呈现，无连线）
    const nodes: SimNode[] = graph.nodes
      .filter((n) => n.type !== "adr")
      .map((n) => {
        const cached = positions.get(n.id);
        return { ...n, ...(cached ? { x: cached.x, y: cached.y } : {}) };
      });
    // 边（decides 不画连线——由 ADR 徽章体现；其余进 link 力）
    const edges = graph.edges
      .filter((e) => e.type !== "decides")
      .map((e) => ({ ...e })) as SimEdge[];

    currentNodes = nodes;
    currentEdges = edges;

    // hull / 徽章数据（叠加视图才有）
    refreshOverlayDecorations();

    simulation?.stop();
    const chargeStrength = -Math.min(800, 300 + nodes.length * 25);
    simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink<SimNode, SimEdge>(edges).id((d) => d.id).distance(160))
      .force("charge", d3.forceManyBody().strength(chargeStrength))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("collision", d3.forceCollide<SimNode>().radius((d) => nodeR(d) + 8))
      .force("ctxCluster", overlay ? contextClusterForce : null)
      .alphaDecay(0.02);

    renderEdgeLayer(zoomGroup, edges);
    renderNodeLayer(zoomGroup, nodes);
    applyFiltersAndDiff();

    // running 呼吸动画
    if (!prefersReducedMotion) {
      zoomGroup.selectAll<SVGGElement, SimNode>(".nodes > g.node")
        .filter((d: SimNode) => d.status === "running")
        .select(".status-ring")
        .transition().duration(1200).ease(d3.easeSinInOut)
        .attr("stroke-opacity", 0.3)
        .transition().duration(1200).ease(d3.easeSinInOut)
        .attr("stroke-opacity", 1)
        .on("start", function repeat(this: unknown) {
          const el = this as SVGCircleElement;
          const transition = d3.active(el);
          if (transition) {
            transition
              .transition().duration(1200).attr("stroke-opacity", 0.3)
              .transition().duration(1200).attr("stroke-opacity", 1)
              .on("start", repeat);
          }
        });
    }

    // tick
    simulation.on("tick", () => {
      zoomGroup?.selectAll<SVGGElement, SimEdge>(".edges .edge-group").each(function (this: SVGGElement) {
        const d = d3.select(this).datum() as SimEdge;
        const sx = (typeof d.source === "object" ? (d.source as SimNode).x : 0) ?? 0;
        const sy = (typeof d.source === "object" ? (d.source as SimNode).y : 0) ?? 0;
        const tx = (typeof d.target === "object" ? (d.target as SimNode).x : 0) ?? 0;
        const ty = (typeof d.target === "object" ? (d.target as SimNode).y : 0) ?? 0;
        d3.select(this).select(".edge-line")
          .attr("x1", sx).attr("y1", sy).attr("x2", tx).attr("y2", ty);
        d3.select(this).select(".edge-label")
          .attr("x", (sx + tx) / 2).attr("y", (sy + ty) / 2 - 4);
      });
      zoomGroup?.selectAll<SVGGElement, SimNode>(".nodes > g.node")
        .attr("transform", (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      updateHullsAndBadges();

      if (!prefersReducedMotion && simulation && simulation.alpha() > 0.8) {
        zoomGroup?.selectAll<SVGGElement, SimNode>(".nodes > g.node")
          .attr("opacity", 0)
          .transition().delay((_, i) => i * 20).duration(ENTER_DURATION)
          .ease(d3.easeCubicOut).attr("opacity", 1);
      }
    });

    simulation.on("end", () => {
      // 结算后写入位置缓存（下次重渲染复用）
      for (const n of nodes) {
        if (n.x !== undefined && n.y !== undefined) positions.set(n.id, { x: n.x, y: n.y });
      }
      startFlowDots(nodes, edges, runningNodeIds(nodes));
    });

    // 首次（无位置缓存）时在模拟稳定后自动适配视图
    const hadCachedPositions = nodes.some((n) => positions.has(n.id));
    if (!hadCachedPositions) {
      setTimeout(() => {
        if (simulation) autoFit();
      }, 2000);
    }
  }

  /** 仅边变化：增量更新边层，不重启模拟（P4-2 核心体验） */
  function syncEdges(graph: GraphIndex) {
    if (!svgEl || !zoomGroup || !simulation) {
      renderGraph(graph);
      return;
    }
    const newNodeIds = new Set(graph.nodes.map((n) => n.id));
    const sameNodes =
      currentNodes.length === graph.nodes.filter((n) => n.type !== "adr").length &&
      currentNodes.every((n) => newNodeIds.has(n.id));
    if (!sameNodes) {
      renderGraph(graph);
      return;
    }
    currentGraph = graph;
    byIdCache = new Map(graph.nodes.map((n) => [n.id, n]));
    currentContextColors = contextColors(graph.nodes.filter((n) => n.type === "context").map((n) => n.id));
    const edges = graph.edges
      .filter((e) => e.type !== "decides")
      .map((e) => ({ ...e })) as SimEdge[];
    currentEdges = edges;
    renderEdgeLayer(zoomGroup, edges);
    refreshOverlayDecorations();
    simulation.force("link", d3.forceLink<SimNode, SimEdge>(edges).id((d) => d.id).distance(160));
    simulation.alpha(0.3).restart();
    applyFiltersAndDiff();
    stopFlowDots();
    startFlowDots(currentNodes, edges, runningNodeIds(currentNodes));
  }

  /** 找出所有 running 节点的下游边（光点流动的通道） */
  function runningNodeIds(nodes: SimNode[]): Set<string> {
    return new Set(nodes.filter((n) => n.status === "running").map((n) => n.id));
  }

  // ── 血管隐喻：running 节点的下游边上有光点沿边流动 ──
  let flowRaf: number | null = null;
  let flowDotsLayer: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

  function startFlowDots(
    nodes: SimNode[],
    edges: SimEdge[],
    running: Set<string>,
  ) {
    if (!zoomGroup) return;
    if (prefersReducedMotion || running.size === 0) return;

    const flowEdges = edges.filter((e) =>
      running.has(edgeEndId(e.source)) && edgeRendered(e),
    );
    if (flowEdges.length === 0) return;

    zoomGroup.selectAll(".flow-layer").remove();
    const layer = zoomGroup.append("g").attr("class", "flow-layer");
    flowDotsLayer = layer;

    const dots = flowEdges.map((e, i) => ({
      edge: e,
      t: (i / flowEdges.length) % 1,
      speed: 0.003 + Math.random() * 0.001,
    }));

    const dotSel = layer.selectAll("circle")
      .data(dots)
      .join("circle")
      .attr("r", 3)
      .attr("fill", (d: unknown) => {
        const e = (d as { edge: EdgeSchema }).edge;
        return EDGE_TYPE_COLORS[e.type] ?? "#f0a73a";
      })
      .attr("opacity", 0.9)
      .attr("filter", "url(#glow)");

    if (flowRaf !== null) cancelAnimationFrame(flowRaf);

    function frame() {
      for (const d of dots) {
        d.t += d.speed;
        if (d.t >= 1) d.t -= 1;
        const e = d.edge;
        const sx = (typeof e.source === "object" ? (e.source as SimNode).x : 0) ?? 0;
        const sy = (typeof e.source === "object" ? (e.source as SimNode).y : 0) ?? 0;
        const tx = (typeof e.target === "object" ? (e.target as SimNode).x : 0) ?? 0;
        const ty = (typeof e.target === "object" ? (e.target as SimNode).y : 0) ?? 0;
        const x = sx + (tx - sx) * d.t;
        const y = sy + (ty - sy) * d.t;
        dotSel.filter((dd: unknown) => dd === d).attr("cx", x).attr("cy", y);
      }
      flowRaf = requestAnimationFrame(frame);
    }
    flowRaf = requestAnimationFrame(frame);
  }

  function stopFlowDots() {
    if (flowRaf !== null) {
      cancelAnimationFrame(flowRaf);
      flowRaf = null;
    }
    flowDotsLayer?.remove();
    flowDotsLayer = null;
  }

  // ── 适应视图（用模拟坐标，修复历史死代码）──
  function autoFit() {
    if (!svgEl || !zoomBehavior) return;
    const { w, h } = getContainerSize();
    const t = computeFitTransform(
      currentNodes.filter(
        (n) => isNodeVisibleInMaps(n, graphState.activeMaps) && n.x !== undefined && n.y !== undefined,
      ) as { x: number; y: number }[],
      w,
      h,
      { nodeRadius: NODE_R + 8 },
    );
    if (!t) return;
    d3.select(svgEl)
      .transition().duration(prefersReducedMotion ? 0 : 500)
      .call(zoomBehavior.transform, d3.zoomIdentity.translate(t.tx, t.ty).scale(t.scale));
  }

  function fitToView() {
    autoFit();
  }

  function zoomIn() {
    if (!svgEl || !zoomBehavior) return;
    d3.select(svgEl).transition().duration(300)
      .call(zoomBehavior.scaleBy, 1.3);
  }

  function zoomOut() {
    if (!svgEl || !zoomBehavior) return;
    d3.select(svgEl).transition().duration(300)
      .call(zoomBehavior.scaleBy, 0.7);
  }

  function togglePinned() {
    if (!simulation) return;
    pinned = !pinned;
    if (pinned) {
      simulation.stop();
      for (const n of currentNodes) {
        n.fx = n.x;
        n.fy = n.y;
      }
    } else {
      for (const n of currentNodes) {
        n.fx = null;
        n.fy = null;
      }
      simulation.alpha(0.3).restart();
    }
  }

  // ── 数据流 ──
  let lastGraphRef: GraphIndex | null = null;
  let lastMapsRef: { workflow: boolean; domain: boolean } | null = null;
  $effect(() => {
    const g = graphState.graph;
    if (!g || !svgEl) return;
    const maps = graphState.activeMaps;
    const mapsChanged = maps !== lastMapsRef;
    if (g !== lastGraphRef || mapsChanged) {
      const isFirst = lastGraphRef === null;
      lastGraphRef = g;
      lastMapsRef = maps;
      if (isFirst || mapsChanged) {
        renderGraph(g); // 透镜切换 → 力系不同（ctxCluster），全量重渲染（位置缓存保形）
      } else {
        syncEdges(g); // 节点集相同 → 边增量；否则内部回退全量
      }
    }
  });

  // 增量节点更新
  $effect(() => {
    const patched = graphState.lastPatched;
    if (!patched || !svgEl) return;
    // 知识顶点（context/adr）不在模拟里：刷新叠加装饰即可
    if (patched.type === "adr") {
      refreshOverlayDecorations();
      applyFiltersAndDiff();
      return;
    }
    // 同步 store 中的节点对象到模拟数据
    const simNode = currentNodes.find((n) => n.id === patched.id);
    if (simNode) {
      const { x, y, fx, fy } = simNode;
      Object.assign(simNode, patched, { x, y, fx, fy });
    }
    // 重新应用节点视觉（状态环/标签/进度条/执行者/glow）
    if (zoomGroup) {
      const target = zoomGroup
        .selectAll<SVGGElement, SimNode>(".nodes > g.node")
        .filter((d: SimNode) => d.id === patched.id);
      if (!target.empty()) {
        const d = target.datum() as SimNode;
        target.select(".status-ring")
          .attr("stroke", statusColorOf(d.status))
          .attr("stroke-width", d.status === "running" ? 3 : 2);
        target.select(".node-label")
          .text(d.label.length > 14 ? `${d.label.slice(0, 12)}…` : d.label);
        const cps = d.checkpoints ?? [];
        const done = cps.filter((c) => c.status === "passed").length;
        const fillW = cps.length ? (done / cps.length) * 28 : 0;
        target.select(".cp-track").attr("opacity", cps.length ? 1 : 0);
        target.select(".cp-fill")
          .attr("width", fillW)
          .attr("fill", d.status === "failed" ? "#e5504f" : "#34c964")
          .attr("opacity", cps.length ? 1 : 0);
        target.select(".node-circle")
          .attr("filter", d.status === "running" ? "url(#glow)" : null)
          .attr("stroke", defaultNodeStroke(d))
          .attr("stroke-width", defaultNodeStrokeWidth(d));
        target.select(".assign-label")
          .text(d.status === "running" && d.assigned_to ? d.assigned_to : "")
          .attr("opacity", d.status === "running" && d.assigned_to ? 0.9 : 0);
      }
      refreshOverlayDecorations();
      if (patched.status === "running") {
        stopFlowDots();
        startFlowDots(currentNodes, currentEdges, runningNodeIds(currentNodes));
      }
    }
    applyFiltersAndDiff();
  });

  // 过滤与 diff 变化 → 重算视觉
  $effect(() => {
    void graphState.levelFilter;
    void graphState.query;
    applyFiltersAndDiff();
  });
  $effect(() => {
    void graphState.diff;
    applyFiltersAndDiff();
  });

  // 选中态同步
  $effect(() => {
    const selectedId = graphState.selectedNode?.id;
    if (!zoomGroup) return;
    zoomGroup.selectAll<SVGGElement, SimNode>(".nodes > g.node").select(".node-circle")
      .attr("stroke", (d: SimNode) =>
        d.id === selectedId ? "var(--ink)" : defaultNodeStroke(d))
      .attr("stroke-width", (d: SimNode) => (d.id === selectedId ? 3 : defaultNodeStrokeWidth(d)));
  });

  // 尺寸变化
  let resizeObs: ResizeObserver | null = null;
  onMount(() => {
    if (!wrapperEl) return;
    resizeObs = new ResizeObserver(() => {
      if (graphState.graph && svgEl) {
        const { w, h } = getContainerSize();
        d3.select(svgEl).attr("viewBox", `0 0 ${w} ${h}`);
      }
    });
    resizeObs.observe(wrapperEl);

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        fitToView();
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  });

  onDestroy(() => {
    simulation?.stop();
    resizeObs?.disconnect();
    stopFlowDots();
  });
</script>

<div bind:this={wrapperEl} class="canvas-wrapper">
  <svg bind:this={svgEl} class="graph-canvas"></svg>
  <div bind:this={tooltipEl} class="node-tooltip"></div>

  {#if graphState.graph && lensVisibleCount === 0}
    <div class="lens-empty" role="status">
      所有 map 透镜已关闭——在左侧 MAPS 面板勾选至少一个 map
    </div>
  {/if}

  <div class="zoom-controls">
    <button class="zoom-btn" onclick={zoomIn} title="放大" aria-label="放大">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M7 3v8M3 7h8"/>
      </svg>
    </button>
    <button class="zoom-btn" onclick={zoomOut} title="缩小" aria-label="缩小">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 7h8"/>
      </svg>
    </button>
    <button class="zoom-btn" onclick={fitToView} title="适应视图" aria-label="适应视图">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M2 5V2h3M12 5V2H9M2 9v3h3M12 9v3H9"/>
      </svg>
    </button>
    <button class="zoom-btn {pinned ? 'active' : ''}" onclick={togglePinned} title="固定布局（大图性能）" aria-label="固定布局">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M7 2v10M2 7h10"/>
      </svg>
    </button>
  </div>

  <div class="zoom-hint">
    <span class="hint-key">scroll</span> zoom
    <span class="hint-sep">·</span>
    <span class="hint-key">drag</span> pan
    <span class="hint-sep">·</span>
    <span class="hint-key">dblclick</span> reset
    <span class="hint-sep">·</span>
    <span class="hint-key">+/-</span> zoom
    <span class="hint-sep">·</span>
    <span class="hint-key">0</span> fit
  </div>
</div>

<style>
  .canvas-wrapper {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--bg);
  }

  .graph-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .node-tooltip {
    position: absolute;
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--r-sm);
    pointer-events: none;
    display: none;
    z-index: var(--z-tooltip);
    white-space: nowrap;
    letter-spacing: var(--track-label);
  }

  /* 空透镜提示 */
  .lens-empty {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: var(--sp-3) var(--sp-4);
    pointer-events: none;
    letter-spacing: var(--track-label);
  }

  /* map 过滤：非本透镜顶点/边整体隐藏（display，而非淡化） */
  :global(.nodes > g.node.map-hidden),
  :global(.edges > g.edge-group.map-hidden) {
    display: none;
  }

  /* 过滤：不匹配节点/边淡化 */
  :global(.nodes > g.node.dimmed),
  :global(.edges > g.edge-group.dimmed) {
    opacity: 0.14;
  }

  /* 叠加视图：ADR 徽章 */
  :global(.adr-badges g.adr-badge) {
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  }

  /* diff 着色（P4-5） */
  :global(.nodes > g.node.diff-added .node-circle),
  :global(.edges > g.edge-group.diff-added .edge-line) {
    stroke: #34c964;
    stroke-width: 2.5;
    stroke-opacity: 0.9;
  }
  :global(.nodes > g.node.diff-removed .node-circle),
  :global(.edges > g.edge-group.diff-removed .edge-line) {
    stroke: #e5504f;
    stroke-width: 2.5;
    stroke-opacity: 0.9;
    stroke-dasharray: 4 3;
  }
  :global(.nodes > g.node.diff-modified .node-circle),
  :global(.edges > g.edge-group.diff-modified .edge-line) {
    stroke: #f0a73a;
    stroke-width: 2.5;
    stroke-opacity: 0.9;
  }

  .zoom-controls {
    position: absolute;
    bottom: var(--sp-8);
    right: var(--sp-4);
    display: flex;
    flex-direction: column;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: var(--sp-1);
    opacity: 0.7;
    transition: opacity 0.2s var(--ease-out-quart);
  }

  .canvas-wrapper:hover .zoom-controls {
    opacity: 0.95;
  }

  .zoom-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    color: var(--ink-muted);
    cursor: pointer;
    transition: background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart);
  }

  .zoom-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--ink);
  }

  .zoom-btn:active {
    background: rgba(255, 255, 255, 0.12);
  }

  .zoom-btn.active {
    color: var(--status-running);
  }

  .zoom-btn:not(:last-child) {
    border-bottom: 1px solid var(--line);
  }

  .zoom-hint {
    position: absolute;
    bottom: var(--sp-3);
    left: 50%;
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    pointer-events: none;
    background: var(--surface-2);
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--r);
    border: 1px solid var(--line);
    opacity: 0.6;
    letter-spacing: var(--track-label);
    transition: opacity 0.2s var(--ease-out-quart);
  }

  .canvas-wrapper:hover .zoom-hint {
    opacity: 0.9;
  }

  .hint-key {
    color: var(--ink-muted);
    font-weight: 500;
  }

  .hint-sep {
    margin: 0 var(--sp-1);
    color: var(--ink-faint);
  }

  @media (max-width: 768px) {
    .zoom-hint { display: none; }
    .zoom-controls {
      bottom: var(--sp-4);
      right: var(--sp-2);
    }
    .zoom-btn { width: 28px; height: 28px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .zoom-hint { transition: none; }
  }
</style>
