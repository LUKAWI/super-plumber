<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import { graphState } from "../lib/store.svelte";
  import { STATUS_COLORS } from "../lib/types";
  import type { GraphIndex, NodeSchema } from "../lib/types";

  // Extend NodeSchema with D3 simulation properties
  type SimNode = NodeSchema & d3.SimulationNodeDatum;

  let svgEl: SVGSVGElement;
  let wrapperEl: HTMLDivElement;
  let tooltipEl: HTMLDivElement;
  let simulation: d3.Simulation<SimNode, undefined> | null = null;

  const prefersReducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const ENTER_DURATION = prefersReducedMotion ? 0 : 400;
  const HOVER_DURATION = prefersReducedMotion ? 0 : 150;
  const NODE_R = 20;

  function getContainerSize() {
    return { w: wrapperEl?.clientWidth || 960, h: wrapperEl?.clientHeight || 680 };
  }

  function renderGraph(graph: GraphIndex) {
    if (!svgEl || !graph || !wrapperEl) return;
    const { w, h } = getContainerSize();

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    svg.attr("viewBox", `0 0 ${w} ${h}`).attr("preserveAspectRatio", "xMidYMid meet");

    // ── Defs: dot grid pattern + arrowhead + glow filter ──
    const defs = svg.append("defs");

    // Dot grid pattern
    const gridPattern = defs.append("pattern")
      .attr("id", "dot-grid")
      .attr("x", 0).attr("y", 0)
      .attr("width", 20).attr("height", 20)
      .attr("patternUnits", "userSpaceOnUse");
    gridPattern.append("circle")
      .attr("cx", 10).attr("cy", 10)
      .attr("r", 0.8)
      .attr("fill", "rgba(255, 255, 255, 0.04)");

    // Arrowhead marker
    defs.append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 26).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "rgba(255, 255, 255, 0.3)");

    // Glow filter for running nodes
    const glowFilter = defs.append("filter")
      .attr("id", "glow")
      .attr("x", "-50%").attr("y", "-50%")
      .attr("width", "200%").attr("height", "200%");
    glowFilter.append("feGaussianBlur")
      .attr("stdDeviation", 4)
      .attr("result", "coloredBlur");
    const feMerge = glowFilter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // ── Background with dot grid ──
    svg.append("rect")
      .attr("width", w).attr("height", h)
      .attr("fill", "url(#dot-grid)")
      .attr("class", "grid-bg");

    // ── Zoom group ──
    const zoomGroup = svg.append("g").attr("class", "zoom-group");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on("zoom", (event) => {
        zoomGroup.attr("transform", event.transform);
        // Hide grid when zoomed out far
        const gridOpacity = Math.min(1, event.transform.k * 1.5);
        svg.select(".grid-bg").attr("opacity", gridOpacity);
      });
    svg.call(zoom)
      .on("dblclick.zoom", () => {
        // Double-click to reset zoom
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
      })
      .style("cursor", "grab");

    svg.on("mousedown.zoom", () => svg.style("cursor", "grabbing"));
    svg.on("mouseup.zoom", () => svg.style("cursor", "grab"));

    const nodes = graph.nodes.map((n) => ({ ...n } as SimNode));
    const edges = graph.edges.map((e) => ({ ...e }));

    // ── Force simulation ──
    const chargeStrength = -Math.min(800, 300 + nodes.length * 25);
    simulation?.stop();
    simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id((d: any) => d.id).distance(160))
      .force("charge", d3.forceManyBody().strength(chargeStrength))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("collision", d3.forceCollide(NODE_R + 8))
      .alphaDecay(0.02);

    // ── Edges ──
    const link = zoomGroup.append("g")
      .attr("class", "edges")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", "rgba(255, 255, 255, 0.18)")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)")
      .style("cursor", "pointer");

    // Edge hover effects
    link.on("mouseenter", function (this: any, d: any) {
      const edge = d3.select(this);
      edge
        .attr("stroke", "rgba(255, 255, 255, 0.6)")
        .attr("stroke-width", 2.5);

      // Highlight source and target nodes
      const sourceNode = node.filter((n: any) => n.id === d.source.id);
      const targetNode = node.filter((n: any) => n.id === d.target.id);

      sourceNode.select(".node-circle")
        .attr("stroke", "rgba(255, 255, 255, 0.9)")
        .attr("stroke-width", 2.5);
      targetNode.select(".node-circle")
        .attr("stroke", "rgba(255, 255, 255, 0.9)")
        .attr("stroke-width", 2.5);
    }).on("mouseleave", function () {
      const edge = d3.select(this);
      edge
        .attr("stroke", "rgba(255, 255, 255, 0.18)")
        .attr("stroke-width", 1.5);

      // Reset node highlights (unless selected)
      node.select(".node-circle")
        .attr("stroke", (d: any) => d.id === graphState.selectedNode?.id ? "var(--ink)" : "rgba(255, 255, 255, 0.6)")
        .attr("stroke-width", (d: any) => d.id === graphState.selectedNode?.id ? 3 : 1.5);
    });

    // ── Nodes ──
    const node = zoomGroup.append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer");

    // Node circles: white fill + status color ring
    node.append("circle")
      .attr("class", "node-circle")
      .attr("r", NODE_R)
      .attr("fill", "rgba(255, 255, 255, 0.02)")
      .attr("stroke", "rgba(255, 255, 255, 0.6)")
      .attr("stroke-width", 1.5);

    // Status ring (outer ring with status color)
    node.append("circle")
      .attr("class", "status-ring")
      .attr("r", NODE_R + 3)
      .attr("fill", "none")
      .attr("stroke", (d) => STATUS_COLORS[d.status] ?? "var(--status-pending)")
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.7);

    // Running nodes: glow + pulsing
    const runningNodes = node.filter((d) => d.status === "running");
    runningNodes.select(".node-circle")
      .attr("filter", "url(#glow)")
      .attr("stroke", () => STATUS_COLORS.running)
      .attr("stroke-width", 2.5);
    runningNodes.select(".status-ring")
      .attr("stroke", () => STATUS_COLORS.running)
      .attr("stroke-width", 3);

    // Node labels (monospace)
    node.append("text")
      .attr("class", "node-label")
      .text((d) => d.label.length > 14 ? d.label.slice(0, 12) + "…" : d.label)
      .attr("text-anchor", "middle")
      .attr("dy", 4)
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", "10px")
      .attr("font-weight", "600")
      .attr("fill", "var(--ink)")
      .attr("letter-spacing", "0.04em")
      .style("pointer-events", "none")
      .style("user-select", "none");

    // ── Interactions ──
    node.on("mouseenter", function (event: MouseEvent) {
      const el = this as SVGGElement;
      const d = d3.select(el).datum() as SimNode;
      
      // Show tooltip if label is truncated
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
    }).on("mouseleave", function () {
      // Hide tooltip
      if (tooltipEl) {
        tooltipEl.style.display = "none";
      }
      
      if (prefersReducedMotion) return;
      const el = this as SVGGElement;
      d3.select(el).select(".node-circle")
        .transition().duration(HOVER_DURATION)
        .attr("r", NODE_R)
        .attr("stroke", "rgba(255, 255, 255, 0.6)")
        .attr("stroke-width", 1.5);
      d3.select(el).select(".status-ring")
        .transition().duration(HOVER_DURATION)
        .attr("r", NODE_R + 3)
        .attr("stroke-opacity", 0.7);
    }).on("click", (event: MouseEvent, d: SimNode) => {
      graphState.selectNode(d);
      // Visual feedback: brief scale pulse
      if (!prefersReducedMotion) {
        d3.select(event.currentTarget as SVGGElement).select(".node-circle")
          .transition().duration(100)
          .attr("r", NODE_R + 6)
          .transition().duration(150)
          .attr("r", NODE_R);
      }
    });

    // ── Drag behavior ──
    const drag = d3.drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active && simulation) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
        d3.select(event.sourceEvent.currentTarget).select(".node-circle")
          .attr("stroke", "var(--ink)")
          .attr("stroke-width", 3);
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active && simulation) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
        d3.select(event.sourceEvent.currentTarget).select(".node-circle")
          .attr("stroke", "rgba(255, 255, 255, 0.6)")
          .attr("stroke-width", 1.5);
      });
    
    node.call(drag as any);

    // ── Selection state ──
    function updateSelection() {
      const selectedId = graphState.selectedNode?.id;
      node.select(".node-circle")
        .attr("stroke", (d) => d.id === selectedId ? "var(--ink)" : "rgba(255, 255, 255, 0.6)")
        .attr("stroke-width", (d) => d.id === selectedId ? 3 : 1.5);
      node.select(".status-ring")
        .attr("stroke-opacity", (d) => d.id === selectedId ? 1 : 0.7)
        .attr("stroke-width", (d) => d.id === selectedId ? 3 : 2);
    }

    // Update selection when node is clicked
    node.on("click.selection", () => {
      setTimeout(updateSelection, 0);
    });

    // ── Running pulse animation ──
    if (!prefersReducedMotion) {
      runningNodes.select(".status-ring")
        .transition().duration(1200).ease(d3.easeSinInOut)
        .attr("stroke-opacity", 0.3)
        .transition().duration(1200).ease(d3.easeSinInOut)
        .attr("stroke-opacity", 1)
        .on("start", function repeat() {
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

    // ── Tick ──
    if (simulation) {
      simulation.on("tick", () => {
        link
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y);

        node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);

        // Entrance stagger on first tick
        if (!prefersReducedMotion && simulation && simulation.alpha() > 0.8) {
          node.attr("opacity", 0)
            .transition().delay((_, i) => i * 20).duration(ENTER_DURATION)
            .ease(d3.easeCubicOut).attr("opacity", 1);
        }
      });

      // ── Auto-fit after simulation settles ──
      simulation.on("end", () => autoFit(svg, zoom, nodes));
    }
    setTimeout(() => { if (simulation) autoFit(svg, zoom, nodes); }, 2000);
  }

  function autoFit(
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
    nodes: NodeSchema[]
  ) {
    if (nodes.length === 0) return;
    const { w, h } = getContainerSize();

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes as any[]) {
      if (n.x == null || n.y == null) continue;
      x0 = Math.min(x0, n.x - 60);
      y0 = Math.min(y0, n.y - 60);
      x1 = Math.max(x1, n.x + 60);
      y1 = Math.max(y1, n.y + 60);
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

    // Keyboard shortcuts
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        fitToView();
      }
    };
    
    window.addEventListener('keydown', handleKeydown);
    
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  $effect(() => {
    if (graphState.graph) renderGraph(graphState.graph);
  });

  onDestroy(() => {
    simulation?.stop();
    resizeObs?.disconnect();
  });

  // Zoom control functions
  function zoomIn() {
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    const zoom = d3.zoom<SVGSVGElement, unknown>();
    svg.transition().duration(300).call(zoom.scaleBy, 1.3);
  }

  function zoomOut() {
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    const zoom = d3.zoom<SVGSVGElement, unknown>();
    svg.transition().duration(300).call(zoom.scaleBy, 0.7);
  }

  function fitToView() {
    if (!svgEl || !graphState.graph || graphState.graph.nodes.length === 0) return;
    const svg = d3.select(svgEl);
    const zoom = d3.zoom<SVGSVGElement, unknown>();
    const { w, h } = getContainerSize();
    
    // Get all node positions from the simulation
    const nodes = graphState.graph.nodes;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    nodes.forEach((node: any) => {
      if (node.x !== undefined && node.y !== undefined) {
        minX = Math.min(minX, node.x - NODE_R);
        minY = Math.min(minY, node.y - NODE_R);
        maxX = Math.max(maxX, node.x + NODE_R);
        maxY = Math.max(maxY, node.y + NODE_R);
      }
    });
    
    if (minX === Infinity) return;
    
    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    const padding = 40;
    
    const scale = Math.min(
      (w - padding * 2) / graphWidth,
      (h - padding * 2) / graphHeight,
      2
    );
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    const transform = d3.zoomIdentity
      .translate(w / 2, h / 2)
      .scale(scale)
      .translate(-centerX, -centerY);
    
    svg.transition().duration(500).call(zoom.transform, transform);
  }
</script>

<div bind:this={wrapperEl} class="canvas-wrapper">
  <svg bind:this={svgEl} class="graph-canvas"></svg>
  <div bind:this={tooltipEl} class="node-tooltip"></div>
  
  <div class="zoom-controls">
    <button class="zoom-btn" onclick={zoomIn} title="放大">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M7 3v8M3 7h8"/>
      </svg>
    </button>
    <button class="zoom-btn" onclick={zoomOut} title="缩小">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 7h8"/>
      </svg>
    </button>
    <button class="zoom-btn" onclick={fitToView} title="适应视图">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M2 5V2h3M12 5V2H9M2 9v3h3M12 9v3H9"/>
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
    z-index: 100;
    white-space: nowrap;
    letter-spacing: var(--track-label);
  }

  .zoom-controls {
    position: absolute;
    top: var(--sp-3);
    right: var(--sp-3);
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
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

  .zoom-btn + .zoom-btn {
    border-top: 1px solid var(--line);
  }

  .zoom-controls {
    position: absolute;
    bottom: var(--sp-8);
    right: var(--sp-4);
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
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
    color: var(--ink-muted);
    cursor: pointer;
    border-radius: var(--r-sm);
    transition: all 0.15s var(--ease-out-quart);
  }

  .zoom-btn:hover {
    background: var(--surface-3);
    color: var(--ink);
  }

  .zoom-btn:active {
    background: var(--line);
    transform: scale(0.95);
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
    .zoom-hint {
      display: none;
    }
    .zoom-controls {
      bottom: var(--sp-4);
      right: var(--sp-2);
    }
    .zoom-btn {
      width: 28px;
      height: 28px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .zoom-hint {
      transition: none;
    }
  }
</style>
