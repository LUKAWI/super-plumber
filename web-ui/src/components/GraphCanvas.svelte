<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import { graphState } from "../lib/store.svelte";
  import { STATUS_COLORS } from "../lib/types";
  import type { GraphIndex, NodeSchema } from "../lib/types";

  let svgEl: SVGSVGElement;
  let wrapperEl: HTMLDivElement;
  let simulation: d3.Simulation<NodeSchema, undefined> | null = null;

  const prefersReducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const ENTER_DURATION = prefersReducedMotion ? 0 : 400;
  const HOVER_DURATION = prefersReducedMotion ? 0 : 150;
  const NODE_R = 22;

  function getContainerSize() {
    return { w: wrapperEl?.clientWidth || 960, h: wrapperEl?.clientHeight || 680 };
  }

  function renderGraph(graph: GraphIndex) {
    if (!svgEl || !graph || !wrapperEl) return;
    const { w, h } = getContainerSize();

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    // Responsive viewBox
    svg.attr("viewBox", `0 0 ${w} ${h}`).attr("preserveAspectRatio", "xMidYMid meet");

    // ── Zoom ──
    const zoomGroup = svg.append("g").attr("class", "zoom-group");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on("zoom", (event) => zoomGroup.attr("transform", event.transform));
    svg.call(zoom).on("dblclick.zoom", null);

    const nodes = graph.nodes.map((n) => ({ ...n }));
    const edges = graph.edges.map((e) => ({ ...e }));

    // ── Defs ──
    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10").attr("refX", 28).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
      .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#475569");
    defs.append("filter").attr("id", "glow")
      .append("feDropShadow").attr("dx", 0).attr("dy", 0)
      .attr("stdDeviation", 5).attr("flood-color", "#f59e0b").attr("flood-opacity", 0.5);

    // ── Force simulation (proportional to node count) ──
    const chargeStrength = -Math.min(800, 300 + nodes.length * 25);
    simulation?.stop();
    simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id((d: any) => d.id).distance(180))
      .force("charge", d3.forceManyBody().strength(chargeStrength))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("collision", d3.forceCollide(NODE_R + 10));

    // ── Edges ──
    const link = zoomGroup.append("g")
      .selectAll("line").data(edges).join("line")
      .attr("stroke", "#334155").attr("stroke-width", 1.5).attr("stroke-opacity", 0.8);

    // ── Nodes ──
    const node = zoomGroup.append("g")
      .selectAll("g").data(nodes).join("g").style("cursor", "pointer");

    node.append("circle")
      .attr("r", NODE_R)
      .attr("fill", (d) => STATUS_COLORS[d.status] ?? "#334155")
      .attr("stroke", "#1e293b").attr("stroke-width", 2);

    node.filter((d) => d.status === "running")
      .select("circle").attr("filter", "url(#glow)").attr("stroke", "#fbbf24").attr("stroke-width", 3);

    node.append("text")
      .text((d) => d.label.length > 12 ? d.label.slice(0, 10) + "…" : d.label)
      .attr("text-anchor", "middle").attr("dy", 4.5)
      .attr("font-size", "10px").attr("font-weight", "500")
      .attr("fill", "#fff").attr("font-family", "system-ui, sans-serif")
      .style("pointer-events", "none");

    // ── Interactions ──
    node.on("mouseenter", function () {
      if (prefersReducedMotion) return;
      d3.select(this).select("circle")
        .transition().duration(HOVER_DURATION).attr("r", NODE_R + 4);
    }).on("mouseleave", function () {
      if (prefersReducedMotion) return;
      d3.select(this).select("circle")
        .transition().duration(HOVER_DURATION).attr("r", NODE_R);
    }).on("click", (_e: any, d: NodeSchema) => graphState.selectNode(d));

    // ── Running pulse ──
    if (!prefersReducedMotion) {
      node.filter((d) => d.status === "running").select("circle")
        .transition().duration(1200).ease(d3.easeSinInOut).attr("stroke-opacity", 0.3)
        .transition().duration(1200).ease(d3.easeSinInOut).attr("stroke-opacity", 1)
        .on("start", function repeat() {
          d3.active(this).transition().duration(1200).attr("stroke-opacity", 0.3)
            .transition().duration(1200).attr("stroke-opacity", 1).on("start", repeat);
        });
    }

    // ── Tick ──
    simulation.on("tick", () => {
      link.attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);
      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);

      // Entrance stagger on first tick
      if (!prefersReducedMotion && simulation!.alpha() > 0.8) {
        node.attr("opacity", 0)
          .transition().delay((_: any, i: number) => i * 25).duration(ENTER_DURATION)
          .ease(d3.easeCubicOut).attr("opacity", 1);
      }
    });

    // ── Auto-fit after simulation settles ──
    simulation.on("end", () => autoFit(svg, zoom, nodes));
    // Also try after a timeout as fallback
    setTimeout(() => { if (simulation) autoFit(svg, zoom, nodes); }, 2000);
  }

  function autoFit(
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
    nodes: NodeSchema[]
  ) {
    if (nodes.length === 0) return;
    const { w, h } = getContainerSize();
    // Compute bounding box from all node positions
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes as any[]) {
      if (n.x == null || n.y == null) continue;
      x0 = Math.min(x0, n.x - 60); y0 = Math.min(y0, n.y - 60);
      x1 = Math.max(x1, n.x + 60); y1 = Math.max(y1, n.y + 60);
    }
    if (x0 === Infinity) return;
    const bw = x1 - x0, bh = y1 - y0;
    const scale = Math.min(w / bw, h / bh, 1.2);
    const tx = w / 2 - (x0 + x1) / 2 * scale;
    const ty = h / 2 - (y0 + y1) / 2 * scale;

    svg.transition().duration(prefersReducedMotion ? 0 : 500)
      .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  // ── Resize observer ──
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
  });

  $effect(() => {
    if (graphState.graph) renderGraph(graphState.graph);
  });

  onDestroy(() => {
    simulation?.stop();
    resizeObs?.disconnect();
  });
</script>

<div bind:this={wrapperEl} class="canvas-wrapper">
  <svg bind:this={svgEl} class="graph-canvas"></svg>
  <div class="zoom-hint">滚轮缩放 · 拖拽平移</div>
</div>

<style>
  .canvas-wrapper {
    flex: 1;
    overflow: hidden;
    position: relative;
  }
  .canvas-wrapper::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(11, 17, 32, 0.5) 100%);
  }
  .graph-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .zoom-hint {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.7rem;
    color: #475569;
    pointer-events: none;
    background: rgba(15, 23, 42, 0.7);
    padding: 4px 12px;
    border-radius: 6px;
  }
</style>
