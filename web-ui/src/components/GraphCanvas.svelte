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
