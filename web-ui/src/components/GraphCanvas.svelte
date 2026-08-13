<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import { graphState } from "../lib/store.svelte";
  import { computeFitTransform } from "../lib/layout";
  import { STATUS_COLORS, EDGE_TYPE_COLORS, EDGE_TYPE_LABELS } from "../lib/types";
  import type { GraphIndex, NodeSchema, EdgeSchema } from "../lib/types";

  // Extend NodeSchema with D3 simulation properties
  type SimNode = NodeSchema & d3.SimulationNodeDatum;

  let svgEl: SVGSVGElement;
  let wrapperEl: HTMLDivElement;
  let tooltipEl: HTMLDivElement;
  let simulation: d3.Simulation<SimNode, undefined> | null = null;
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let zoomGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

  // 布局持久化：全量重渲染时复用节点坐标（P4-2：加一条边不再全图重抖）
  const positions = new Map<string, { x: number; y: number }>();
  let currentNodes: SimNode[] = [];
  let currentEdges: (EdgeSchema & { source: SimNode | string; target: SimNode | string })[] = [];
  let pinned = $state(false);

  const prefersReducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const ENTER_DURATION = prefersReducedMotion ? 0 : 400;
  const HOVER_DURATION = prefersReducedMotion ? 0 : 150;
  const NODE_R = 20;

  function getContainerSize() {
    return { w: wrapperEl?.clientWidth || 960, h: wrapperEl?.clientHeight || 680 };
  }

  // ── 过滤（层级 + 搜索）与 diff 着色的命中判断 ──
  function nodeMatchesFilters(n: NodeSchema): boolean {
    const levels = graphState.levelFilter;
    if (levels !== null && !levels.includes(n.level)) return false;
    const q = graphState.query.trim().toLowerCase();
    if (q && !n.id.toLowerCase().includes(q) && !n.label.toLowerCase().includes(q)) return false;
    return true;
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

  function applyFiltersAndDiff() {
    if (!svgEl || !zoomGroup) return;
    const nodeSel = zoomGroup.selectAll<SVGGElement, SimNode>(".nodes > g.node");
    nodeSel.classed("dimmed", (d: any) => !nodeMatchesFilters(d));
    const diffMap = new Map<string, string | null>();
    for (const n of currentNodes) diffMap.set(n.id, diffClassOf("node", n.id));
    nodeSel
      .classed("diff-added", (d: any) => diffMap.get(d.id) === "diff-added")
      .classed("diff-removed", (d: any) => diffMap.get(d.id) === "diff-removed")
      .classed("diff-modified", (d: any) => diffMap.get(d.id) === "diff-modified");

    const edgeSel = zoomGroup.selectAll<SVGGElement, unknown>(".edges .edge-group");
    edgeSel.classed("dimmed", function (this: SVGGElement) {
      const g = d3.select(this);
      const d = g.datum() as { source: SimNode | string; target: SimNode | string };
      const src = typeof d.source === "object" ? (d.source as SimNode).id : d.source;
      const tgt = typeof d.target === "object" ? (d.target as SimNode).id : d.target;
      const srcNode = currentNodes.find((n) => n.id === src);
      const tgtNode = currentNodes.find((n) => n.id === tgt);
      return (
        (srcNode !== undefined && !nodeMatchesFilters(srcNode)) ||
        (tgtNode !== undefined && !nodeMatchesFilters(tgtNode))
      );
    });
    const edgeDiff = new Map<string, string | null>();
    for (const e of currentEdges) edgeDiff.set(e.id, diffClassOf("edge", e.id));
    edgeSel
      .classed("diff-added", function (this: SVGGElement) {
        const d = d3.select(this).datum() as { id: string };
        return edgeDiff.get(d.id) === "diff-added";
      })
      .classed("diff-removed", function (this: SVGGElement) {
        const d = d3.select(this).datum() as { id: string };
        return edgeDiff.get(d.id) === "diff-removed";
      })
      .classed("diff-modified", function (this: SVGGElement) {
        const d = d3.select(this).datum() as { id: string };
        return edgeDiff.get(d.id) === "diff-modified";
      });
  }

  // ── 边层渲染（全量/增量共用）──
  function renderEdgeLayer(
    parent: d3.Selection<SVGGElement, unknown, null, undefined>,
    edges: (EdgeSchema & { source: SimNode | string; target: SimNode | string })[],
  ) {
    let linkG = parent.select<SVGGElement>(".edges");
    if (linkG.empty()) linkG = parent.append("g").attr("class", "edges");

    const link = linkG
      .selectAll<SVGGElement, EdgeSchema & { source: SimNode | string; target: SimNode | string }>("g.edge-group")
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
      .attr("stroke", (d: unknown) => {
        const e = d as EdgeSchema;
        return EDGE_TYPE_COLORS[e.type] ?? "#ffffff";
      })
      .attr("stroke-opacity", 0.28) // 默认微妙色相
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)");

    all
      .select(".edge-label")
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("font-family", "var(--font-mono)")
      .attr("fill", (d: unknown) => EDGE_TYPE_COLORS[(d as EdgeSchema).type] ?? "#fff")
      .attr("paint-order", "stroke")
      .attr("stroke", "#000000")
      .attr("stroke-width", "3px")
      .attr("stroke-linejoin", "round")
      .attr("opacity", 0)
      .text((d: unknown) => EDGE_TYPE_LABELS[(d as EdgeSchema).type] ?? (d as EdgeSchema).type);

    // hover 高亮 + 点击选中（边详情）
    all
      .on("mouseenter", function (this: SVGGElement) {
        const group = d3.select(this);
        group.select(".edge-line")
          .attr("stroke-opacity", 0.9)
          .attr("stroke-width", 2.5);
        group.select(".edge-label").attr("opacity", 1);
        const d = group.datum() as { source: SimNode | string; target: SimNode | string };
        const srcId = typeof d.source === "object" ? (d.source as SimNode).id : d.source;
        const tgtId = typeof d.target === "object" ? (d.target as SimNode).id : d.target;
        const nodeSel = parent.selectAll<SVGGElement, SimNode>(".nodes > g.node");
        nodeSel
          .filter((n: SimNode) => n.id === srcId || n.id === tgtId)
          .select(".node-circle")
          .attr("stroke", "rgba(255, 255, 255, 0.9)")
          .attr("stroke-width", 2.5);
      })
      .on("mouseleave", function (this: SVGGElement) {
        const group = d3.select(this);
        group.select(".edge-line")
          .attr("stroke-opacity", (d: unknown) => EDGE_TYPE_COLORS[(d as EdgeSchema).type] ? 0.28 : 0.18)
          .attr("stroke-width", 1.5);
        group.select(".edge-label").attr("opacity", 0);
        const d = group.datum() as { source: SimNode | string; target: SimNode | string };
        const srcId = typeof d.source === "object" ? (d.source as SimNode).id : d.source;
        const tgtId = typeof d.target === "object" ? (d.target as SimNode).id : d.target;
        const selected = graphState.selectedNode?.id;
        const nodeSel = parent.selectAll<SVGGElement, SimNode>(".nodes > g.node");
        nodeSel
          .filter((n: SimNode) => n.id === srcId || n.id === tgtId)
          .select(".node-circle")
          .attr("stroke", (n: SimNode) => (n.id === selected ? "var(--ink)" : "rgba(255, 255, 255, 0.6)"))
          .attr("stroke-width", (n: SimNode) => (n.id === selected ? 3 : 1.5));
      })
      .on("click", function (this: SVGGElement) {
        const group = d3.select(this);
        const d = group.datum() as EdgeSchema & { source: SimNode | string; target: SimNode | string };
        graphState.selectEdge({
          id: d.id,
          source: typeof d.source === "object" ? (d.source as SimNode).id : d.source,
          target: typeof d.target === "object" ? (d.target as SimNode).id : d.target,
          type: d.type,
          ...(d.contract ? { contract: d.contract } : {}),
        });
      });

    return { linkG, all };
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

    // Node circles: white fill + status color ring
    all.select(".node-circle")
      .attr("r", NODE_R)
      .attr("fill", "rgba(255, 255, 255, 0.02)")
      .attr("stroke", "rgba(255, 255, 255, 0.6)")
      .attr("stroke-width", 1.5);

    all.select(".status-ring")
      .attr("r", NODE_R + 3)
      .attr("fill", "none")
      .attr("stroke", (d: any) => STATUS_COLORS[d.status as keyof typeof STATUS_COLORS] ?? "var(--status-pending)")
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.7);

    all.select(".node-label")
      .text((d: any) => (d.label.length > 14 ? d.label.slice(0, 12) + "…" : d.label))
      .attr("text-anchor", "middle")
      .attr("dy", 4)
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", "10px")
      .attr("font-weight", "600")
      .attr("fill", "var(--ink)")
      .attr("letter-spacing", "0.04em")
      .style("pointer-events", "none")
      .style("user-select", "none");

    // checkpoint 进度条
    all.select(".cp-track")
      .attr("x", -14).attr("y", NODE_R + 12)
      .attr("width", 28).attr("height", 3)
      .attr("rx", 1.5)
      .attr("fill", "rgba(255, 255, 255, 0.1)")
      .attr("opacity", (d: any) => (d.checkpoints?.length ? 1 : 0));
    all.select(".cp-fill")
      .attr("x", -14).attr("y", NODE_R + 12)
      .attr("width", (d: any) => {
        const cps = d.checkpoints ?? [];
        const done = cps.filter((c: any) => c.status === "passed").length;
        return cps.length ? (done / cps.length) * 28 : 0;
      })
      .attr("height", 3)
      .attr("rx", 1.5)
      .attr("fill", (d: any) => (d.status === "failed" ? "#e5504f" : "#34c964"))
      .attr("opacity", (d: any) => (d.checkpoints?.length ? 1 : 0));

    // 执行者标签（running 节点）
    all.select(".assign-label")
      .text((d: any) => (d.status === "running" && d.assigned_to ? d.assigned_to : ""))
      .attr("text-anchor", "middle")
      .attr("y", -NODE_R - 8)
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", "8px")
      .attr("font-weight", "500")
      .attr("fill", "#f0a73a")
      .attr("opacity", (d: any) => (d.status === "running" && d.assigned_to ? 0.9 : 0))
      .style("pointer-events", "none")
      .style("user-select", "none");

    // running 高亮
    all.select(".node-circle")
      .attr("filter", (d: any) => (d.status === "running" ? "url(#glow)" : null))
      .attr("stroke", (d: any) =>
        d.status === "running" ? STATUS_COLORS.running : "rgba(255, 255, 255, 0.6)")
      .attr("stroke-width", (d: any) => (d.status === "running" ? 2.5 : 1.5));
    all.select(".status-ring")
      .attr("stroke-width", (d: any) => (d.status === "running" ? 3 : 2));

    // 交互：hover 放大 + tooltip + 点击选中
    all
      .on("mouseenter", function (this: SVGGElement, event: MouseEvent) {
        const el = this;
        const d = d3.select(el).datum() as SimNode;
        if (d.label.length > 14 && tooltipEl) {
          const rect = wrapperEl.getBoundingClientRect();
          tooltipEl.textContent = d.label;
          tooltipEl.style.display = "block";
          tooltipEl.style.left = `${event.clientX - rect.left + 12}px`;
          tooltipEl.style.top = `${event.clientY - rect.top - 8}px`;
        }
        if (prefersReducedMotion) return;
        d3.select(el).select(".node-circle")
          .transition().duration(HOVER_DURATION)
          .attr("r", NODE_R + 4)
          .attr("stroke", "rgba(255, 255, 255, 0.9)")
          .attr("stroke-width", 2);
        d3.select(el).select(".status-ring")
          .transition().duration(HOVER_DURATION)
          .attr("r", NODE_R + 7)
          .attr("stroke-opacity", 1);
      })
      .on("mouseleave", function (this: SVGGElement) {
        if (tooltipEl) tooltipEl.style.display = "none";
        if (prefersReducedMotion) return;
        const el = this;
        d3.select(el).select(".node-circle")
          .transition().duration(HOVER_DURATION)
          .attr("r", NODE_R)
          .attr("stroke", "rgba(255, 255, 255, 0.6)")
          .attr("stroke-width", 1.5);
        d3.select(el).select(".status-ring")
          .transition().duration(HOVER_DURATION)
          .attr("r", NODE_R + 3)
          .attr("stroke-opacity", 0.7);
      })
      .on("click", function (event: MouseEvent, d: SimNode) {
        graphState.selectNode(d);
        if (!prefersReducedMotion) {
          d3.select(event.currentTarget as SVGGElement).select(".node-circle")
            .transition().duration(100)
            .attr("r", NODE_R + 6)
            .transition().duration(150)
            .attr("r", NODE_R);
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

  // ── 全量渲染（节点集合变化时；位置缓存 + 缩放保持）──
  function renderGraph(graph: GraphIndex) {
    if (!svgEl || !graph || !wrapperEl) return;
    const { w, h } = getContainerSize();

    stopFlowDots();
    const svg = d3.select(svgEl);
    const previousTransform = (svgEl as SVGSVGElement & { __zoom?: d3.ZoomTransform }).__zoom;

    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${w} ${h}`).attr("preserveAspectRatio", "xMidYMid meet");

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

    // 节点（位置缓存种子）
    const nodes: SimNode[] = graph.nodes.map((n) => {
      const cached = positions.get(n.id);
      return { ...n, ...(cached ? { x: cached.x, y: cached.y } : {}) };
    });
    const edges = graph.edges.map((e) => ({ ...e })) as typeof currentEdges;

    currentNodes = nodes;
    currentEdges = edges;

    simulation?.stop();
    const chargeStrength = -Math.min(800, 300 + nodes.length * 25);
    simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges as any).id((d: any) => (d as SimNode).id).distance(160))
      .force("charge", d3.forceManyBody().strength(chargeStrength))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("collision", d3.forceCollide(NODE_R + 8))
      .alphaDecay(0.02);

    renderEdgeLayer(zoomGroup, edges);
    renderNodeLayer(zoomGroup, nodes);
    applyFiltersAndDiff();

    // running 呼吸动画
    if (!prefersReducedMotion) {
      zoomGroup.selectAll<SVGGElement, SimNode>(".nodes > g.node")
        .filter((d: any) => d.status === "running")
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
      zoomGroup?.selectAll<SVGGElement, unknown>(".edges .edge-group").each(function (this: SVGGElement) {
        const d = d3.select(this).datum() as {
          source: SimNode | string;
          target: SimNode | string;
        };
        const sx = (typeof d.source === "object" ? (d.source as any).x : 0) ?? 0;
        const sy = (typeof d.source === "object" ? (d.source as any).y : 0) ?? 0;
        const tx = (typeof d.target === "object" ? (d.target as any).x : 0) ?? 0;
        const ty = (typeof d.target === "object" ? (d.target as any).y : 0) ?? 0;
        d3.select(this).select(".edge-line")
          .attr("x1", sx).attr("y1", sy).attr("x2", tx).attr("y2", ty);
        d3.select(this).select(".edge-label")
          .attr("x", (sx + tx) / 2).attr("y", (sy + ty) / 2 - 4);
      });
      zoomGroup?.selectAll<SVGGElement, SimNode>(".nodes > g.node")
        .attr("transform", (d: any) => `translate(${d.x ?? 0},${d.y ?? 0})`);

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
      currentNodes.length === graph.nodes.length &&
      currentNodes.every((n) => newNodeIds.has(n.id));
    if (!sameNodes) {
      renderGraph(graph);
      return;
    }
    const edges = graph.edges.map((e) => ({ ...e })) as typeof currentEdges;
    currentEdges = edges;
    renderEdgeLayer(zoomGroup, edges);
    simulation.force("link", d3.forceLink(edges as any).id((d: any) => (d as SimNode).id).distance(160));
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
    edges: typeof currentEdges,
    running: Set<string>,
  ) {
    if (!zoomGroup) return;
    if (prefersReducedMotion || running.size === 0) return;

    const flowEdges = edges.filter((e) =>
      running.has(String(typeof e.source === "object" ? (e.source as SimNode).id : e.source)),
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
        const sx = (typeof e.source === "object" ? (e.source as any).x : 0) ?? 0;
        const sy = (typeof e.source === "object" ? (e.source as any).y : 0) ?? 0;
        const tx = (typeof e.target === "object" ? (e.target as any).x : 0) ?? 0;
        const ty = (typeof e.target === "object" ? (e.target as any).y : 0) ?? 0;
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
      currentNodes.filter((n) => n.x !== undefined && n.y !== undefined) as { x: number; y: number }[],
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
  $effect(() => {
    const g = graphState.graph;
    if (!g || !svgEl) return;
    if (g !== lastGraphRef) {
      const isFirst = lastGraphRef === null;
      lastGraphRef = g;
      if (isFirst) {
        renderGraph(g);
      } else {
        syncEdges(g); // 节点集相同 → 边增量；否则内部回退全量
      }
    }
  });

  // 增量节点更新
  $effect(() => {
    const patched = graphState.lastPatched;
    if (!patched || !svgEl) return;
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
        .filter((d: any) => d.id === patched.id);
      if (target.empty()) return;
      const d = target.datum() as SimNode;
      target.select(".status-ring")
        .attr("stroke", () => STATUS_COLORS[d.status] ?? "var(--status-pending)")
        .attr("stroke-width", d.status === "running" ? 3 : 2);
      target.select(".node-label")
        .text(d.label.length > 14 ? d.label.slice(0, 12) + "…" : d.label);
      const cps = d.checkpoints ?? [];
      const done = cps.filter((c: any) => c.status === "passed").length;
      const fillW = cps.length ? (done / cps.length) * 28 : 0;
      target.select(".cp-track").attr("opacity", cps.length ? 1 : 0);
      target.select(".cp-fill")
        .attr("width", fillW)
        .attr("fill", d.status === "failed" ? "#e5504f" : "#34c964")
        .attr("opacity", cps.length ? 1 : 0);
      target.select(".node-circle")
        .attr("filter", d.status === "running" ? "url(#glow)" : null)
        .attr("stroke", d.status === "running" ? STATUS_COLORS.running : "rgba(255, 255, 255, 0.6)")
        .attr("stroke-width", d.status === "running" ? 2.5 : 1.5);
      target.select(".assign-label")
        .text(d.status === "running" && d.assigned_to ? d.assigned_to : "")
        .attr("opacity", d.status === "running" && d.assigned_to ? 0.9 : 0);
      if (d.status === "running") {
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
      .attr("stroke", (d: any) =>
        d.id === selectedId ? "var(--ink)" : "rgba(255, 255, 255, 0.6)")
      .attr("stroke-width", (d: any) => (d.id === selectedId ? 3 : 1.5));
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

  /* 过滤：不匹配节点/边淡化 */
  :global(.nodes > g.node.dimmed),
  :global(.edges > g.edge-group.dimmed) {
    opacity: 0.14;
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
