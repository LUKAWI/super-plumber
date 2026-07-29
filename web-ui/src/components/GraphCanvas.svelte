<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import * as d3 from "d3";
  import { graphState } from "../lib/store.svelte";
  import { STATUS_COLORS } from "../lib/types";
  import type { GraphIndex, NodeSchema } from "../lib/types";

  let svgEl: SVGSVGElement;
  let simulation: d3.Simulation<NodeSchema, undefined> | null = null;

  // Check reduced motion preference
  const prefersReducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const ENTER_DURATION = prefersReducedMotion ? 0 : 400;
  const HOVER_DURATION = prefersReducedMotion ? 0 : 150;

  function renderGraph(graph: GraphIndex) {
    if (!svgEl || !graph) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    const width = svgEl.clientWidth || 800;
    const height = svgEl.clientHeight || 600;

    const nodes = graph.nodes.map((n) => ({ ...n }));
    const edges = graph.edges.map((e) => ({ ...e }));

    // Arrow marker
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
      .attr("fill", "#475569");

    // Glow filter for running nodes
    const defs = svg.append("defs");
    defs.append("filter")
      .attr("id", "node-glow")
      .append("feDropShadow")
      .attr("dx", 0)
      .attr("dy", 0)
      .attr("stdDeviation", 6)
      .attr("flood-color", "#f59e0b")
      .attr("flood-opacity", 0.6);

    defs.append("filter")
      .attr("id", "node-passed-glow")
      .append("feDropShadow")
      .attr("dx", 0)
      .attr("dy", 0)
      .attr("stdDeviation", 4)
      .attr("flood-color", "#22c55e")
      .attr("flood-opacity", 0.4);

    simulation?.stop();
    simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id((d: any) => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(65));

    // ── Edges ──
    const link = svg.append("g")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", "#334155")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.8);

    // ── Nodes ──
    const node = svg.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer");

    // Circles
    const circles = node.append("circle")
      .attr("r", 22)
      .attr("fill", (d) => STATUS_COLORS[d.status] ?? "#334155")
      .attr("stroke", (d) => d.status === "running" ? "#fbbf24" : "#1e293b")
      .attr("stroke-width", (d) => d.status === "running" ? 3 : 2);

    // Apply glow for running/passed
    node.filter((d) => d.status === "running")
      .select("circle")
      .attr("filter", "url(#node-glow)");
    node.filter((d) => d.status === "passed")
      .select("circle")
      .attr("filter", "url(#node-passed-glow)");

    // Labels
    node.append("text")
      .text((d) => d.label.length > 12 ? d.label.slice(0, 10) + "..." : d.label)
      .attr("text-anchor", "middle")
      .attr("dy", 4.5)
      .attr("font-size", "10px")
      .attr("font-weight", "500")
      .attr("fill", "#ffffff")
      .attr("font-family", "system-ui, sans-serif")
      .style("pointer-events", "none");

    // ── Interactions ──
    node.on("mouseenter", function (_event: any, d: NodeSchema) {
      if (prefersReducedMotion) return;
      d3.select(this).select("circle")
        .transition().duration(HOVER_DURATION)
        .attr("r", 26)
        .attr("stroke-width", 3);
      d3.select(this).select("text")
        .transition().duration(HOVER_DURATION)
        .attr("font-size", "11px")
        .attr("dy", 4);
    })
    .on("mouseleave", function (_event: any, d: NodeSchema) {
      if (prefersReducedMotion) return;
      d3.select(this).select("circle")
        .transition().duration(HOVER_DURATION)
        .attr("r", 22)
        .attr("stroke-width", d.status === "running" ? 3 : 2);
      d3.select(this).select("text")
        .transition().duration(HOVER_DURATION)
        .attr("font-size", "10px")
        .attr("dy", 4.5);
    })
    .on("click", function (_event: any, d: NodeSchema) {
      // Click feedback
      if (!prefersReducedMotion) {
        d3.select(this).select("circle")
          .transition().duration(100)
          .attr("r", 18)
          .transition().duration(100)
          .attr("r", 22);
      }
      graphState.selectNode(d);
    });

    // ── Running pulse animation ──
    if (!prefersReducedMotion) {
      node.filter((d) => d.status === "running")
        .select("circle")
        .transition()
        .duration(1200)
        .ease(d3.easeSinInOut)
        .attr("stroke-opacity", 0.4)
        .transition()
        .duration(1200)
        .ease(d3.easeSinInOut)
        .attr("stroke-opacity", 1)
        .on("start", function repeat() {
          d3.active(this)
            .transition()
            .duration(1200)
            .ease(d3.easeSinInOut)
            .attr("stroke-opacity", 0.4)
            .transition()
            .duration(1200)
            .ease(d3.easeSinInOut)
            .attr("stroke-opacity", 1)
            .on("start", repeat);
        });
    }

    // ── Simulation ──
    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);

      // Entrance animation on first tick
      if (!prefersReducedMotion && simulation!.alpha() > 0.99) {
        node.attr("opacity", 0)
          .transition()
          .delay((_: any, i: number) => i * 30)
          .duration(ENTER_DURATION)
          .ease(d3.easeCubicOut)
          .attr("opacity", 1);
      }
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
    background: radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(11, 17, 32, 0.6) 100%);
  }
  .graph-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
