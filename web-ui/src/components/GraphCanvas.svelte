<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import { graphState } from "../lib/store.svelte";
  import { STATUS_COLORS, EDGE_TYPE_COLORS, EDGE_TYPE_LABELS } from "../lib/types";
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

    stopFlowDots();
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

    // ── Edges（每边一个 group：线 + 中点标签）──
    const linkG = zoomGroup.append("g").attr("class", "edges");
    const link = linkG.selectAll("g.edge-group")
      .data(edges)
      .join("g")
      .attr("class", "edge-group")
      .style("cursor", "pointer");

    link.append("line")
      .attr("class", "edge-line")
      .attr("stroke", (d) => {
        const hue = EDGE_TYPE_COLORS[d.type] ?? "#ffffff";
        return hue;
      })
      .attr("stroke-opacity", 0.28)   // 默认微妙色相
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)");

    // 中点类型标签（默认隐藏，hover 显示）
    link.append("text")
      .attr("class", "edge-label")
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("font-family", "var(--font-mono)")
      .attr("fill", (d) => EDGE_TYPE_COLORS[d.type] ?? "#fff")
      .attr("paint-order", "stroke")
      .attr("stroke", "#0b1120")
      .attr("stroke-width", "3px")
      .attr("stroke-linejoin", "round")
      .attr("opacity", 0)
      .text((d) => EDGE_TYPE_LABELS[d.type] ?? d.type);

    // Edge hover effects
    link.on("mouseenter", function (this: any, d: any) {
      const group = d3.select(this);
      group.select(".edge-line")
        .attr("stroke-opacity", 0.9)
        .attr("stroke-width", 2.5);
      group.select(".edge-label")
        .attr("opacity", 1);

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
      const group = d3.select(this);
      group.select(".edge-line")
        .attr("stroke-opacity", (d: any) => EDGE_TYPE_COLORS[d.type] ? 0.28 : 0.18)
        .attr("stroke-width", 1.5);
      group.select(".edge-label")
        .attr("opacity", 0);

      // Reset node highlights (unless selected)
      node.select(".node-circle")
        .attr("stroke", (d: any) => d.id === graphState.selectedNode?.id ? "var(--ink)" : "rgba(255, 255, 255, 0.6)")
        .attr("stroke-width", (d: any) => d.id === graphState.selectedNode?.id ? 3 : 1.5);
    });

    // 记录当前渲染数据（供增量更新重启用）
    currentNodes = nodes;
    currentEdges = edges;
    currentZoomGroup = zoomGroup;

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

    // Checkpoint 进度条（节点下方小进度条）
    const nodeWithCp = node.filter((d: any) => d.checkpoints && d.checkpoints.length > 0);
    nodeWithCp.append("rect")
      .attr("class", "cp-track")
      .attr("x", -14).attr("y", NODE_R + 12)
      .attr("width", 28).attr("height", 3)
      .attr("rx", 1.5)
      .attr("fill", "rgba(255, 255, 255, 0.1)");
    nodeWithCp.append("rect")
      .attr("class", "cp-fill")
      .attr("x", -14).attr("y", NODE_R + 12)
      .attr("width", (d: any) => {
        const done = d.checkpoints.filter((c: any) => c.status === "passed").length;
        return d.checkpoints.length ? (done / d.checkpoints.length) * 28 : 0;
      })
      .attr("height", 3)
      .attr("rx", 1.5)
      .attr("fill", (d: any) => d.status === "failed" ? "#ef4444" : "#22c55e");

    // 执行者标签（仅 running 节点旁显示 assigned_to）
    node.filter((d: any) => d.status === "running" && d.assigned_to)
      .append("text")
      .attr("class", "assign-label")
      .text((d: any) => d.assigned_to)
      .attr("text-anchor", "middle")
      .attr("y", -NODE_R - 8)
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", "8px")
      .attr("font-weight", "500")
      .attr("fill", "#f59e0b")
      .attr("opacity", 0.9)
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
        link.select(".edge-line")
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y);
        link.select(".edge-label")
          .attr("x", (d: any) => (d.source.x + d.target.x) / 2)
          .attr("y", (d: any) => (d.source.y + d.target.y) / 2 - 4);

        node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);

        // Entrance stagger on first tick
        if (!prefersReducedMotion && simulation && simulation.alpha() > 0.8) {
          node.attr("opacity", 0)
            .transition().delay((_, i) => i * 20).duration(ENTER_DURATION)
            .ease(d3.easeCubicOut).attr("opacity", 1);
        }
      });

      // ── Auto-fit after simulation settles ──
      simulation.on("end", () => {
        autoFit(svg, zoom, nodes);
        startFlowDots(zoomGroup, nodes, edges, runningNodeIds(nodes));
      });
    }
    setTimeout(() => {
      if (simulation) autoFit(svg, zoom, nodes);
      startFlowDots(zoomGroup, nodes, edges, runningNodeIds(nodes));
    }, 2000);
  }

  /** 找出所有 running 节点的下游边（光点流动的通道） */
  function runningNodeIds(nodes: any[]): Set<string> {
    return new Set(nodes.filter((n) => n.status === "running").map((n) => n.id));
  }

  /**
   * 血管隐喻：running 节点的下游边上有光点沿边流动。
   * 用一个 dot layer 管理所有流动光点，requestAnimationFrame 驱动。
   */
  let flowRaf: number | null = null;
  let flowDotsLayer: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

  function startFlowDots(
    zoomGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
    nodes: any[],
    edges: any[],
    running: Set<string>
  ) {
    if (prefersReducedMotion || running.size === 0) return;

    // 取 running 节点的下游边
    const flowEdges = edges.filter((e: any) => running.has(e.source.id));
    if (flowEdges.length === 0) return;

    // 清掉旧的 dot layer（重新渲染时）
    zoomGroup.selectAll(".flow-layer").remove();

    const layer = zoomGroup.append("g").attr("class", "flow-layer");
    flowDotsLayer = layer;

    // 每个边一个光点，记录进度 t ∈ [0,1)
    const dots = flowEdges.map((e: any, i: number) => ({
      edge: e,
      t: (i / flowEdges.length) % 1,
      speed: 0.003 + Math.random() * 0.001, // 每帧推进比例
    }));

    // 绘制光点
    const dotSel = layer.selectAll("circle")
      .data(dots)
      .join("circle")
      .attr("r", 3)
      .attr("fill", (d: any) => EDGE_TYPE_COLORS[d.edge.type] ?? "#f59e0b")
      .attr("opacity", 0.9)
      .attr("filter", "url(#glow)");

    const prevRaf = flowRaf;
    if (prevRaf !== null) cancelAnimationFrame(prevRaf);

    function frame() {
      for (const d of dots) {
        d.t += d.speed;
        if (d.t >= 1) d.t -= 1;
        const sx = d.edge.source.x, sy = d.edge.source.y;
        const tx = d.edge.target.x, ty = d.edge.target.y;
        const x = sx + (tx - sx) * d.t;
        const y = sy + (ty - sy) * d.t;
        dotSel.filter((dd: any) => dd === d)
          .attr("cx", x).attr("cy", y);
      }
      flowRaf = requestAnimationFrame(frame);
    }
    flowRaf = requestAnimationFrame(frame);
  }

  /** 停止光点流动（onDestroy / 全量重渲染前） */
  function stopFlowDots() {
    if (flowRaf !== null) {
      cancelAnimationFrame(flowRaf);
      flowRaf = null;
    }
    flowDotsLayer?.remove();
    flowDotsLayer = null;
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

  // 供增量更新重启用：当前渲染的节点/边数据
  let currentNodes: any[] = [];
  let currentEdges: any[] = [];
  let currentZoomGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

  // 全量渲染：仅在 graph 对象引用变化（首连 / 低频全量事件）时触发
  let lastGraphRef: GraphIndex | null = null;
  $effect(() => {
    const g = graphState.graph;
    if (g && g !== lastGraphRef) {
      lastGraphRef = g;
      renderGraph(g);
    }
  });

  // 增量更新：监听 lastPatched，就地刷新单个节点的视觉状态
  let patchCache: { nodeId: string; elements: d3.Selection<SVGGElement, any, any, any> } | null = null;
  $effect(() => {
    const patched = graphState.lastPatched;
    if (!patched || !svgEl) return;
    const svg = d3.select(svgEl);
    const nodeSel = svg.selectAll<SVGGElement, any>(".nodes > g");
    const target = nodeSel.filter((d: any) => d.id === patched.id);
    if (target.empty()) return;

    // 更新状态环颜色
    target.select(".status-ring")
      .attr("stroke", () => STATUS_COLORS[patched.status] ?? "var(--status-pending)");

    // 更新标签
    target.select(".node-label")
      .text(patched.label.length > 14 ? patched.label.slice(0, 12) + "…" : patched.label);

    // 更新 checkpoint 进度条
    const cps = patched.checkpoints ?? [];
    const done = cps.filter((c: any) => c.status === "passed").length;
    const fillW = cps.length ? (done / cps.length) * 28 : 0;
    const track = target.select(".cp-track");
    const fill = target.select(".cp-fill");
    if (track.empty() && cps.length > 0) {
      // 新增进度条（节点之前没有 checkpoints）
      target.append("rect").attr("class", "cp-track")
        .attr("x", -14).attr("y", NODE_R + 12).attr("width", 28).attr("height", 3)
        .attr("rx", 1.5).attr("fill", "rgba(255, 255, 255, 0.1)");
      target.append("rect").attr("class", "cp-fill")
        .attr("x", -14).attr("y", NODE_R + 12).attr("height", 3).attr("rx", 1.5);
    }
    target.select(".cp-fill")
      .attr("width", fillW)
      .attr("fill", patched.status === "failed" ? "#ef4444" : "#22c55e");
    if (cps.length === 0) {
      target.select(".cp-track").attr("width", 0);
      target.select(".cp-fill").attr("width", 0);
    }

    // running：加 glow + 粗环；非 running：还原
    target.select(".node-circle")
      .attr("filter", patched.status === "running" ? "url(#glow)" : null)
      .attr("stroke", patched.status === "running" ? "var(--status-running)" : "rgba(255, 255, 255, 0.6)")
      .attr("stroke-width", patched.status === "running" ? 2.5 : 1.5);
    target.select(".status-ring")
      .attr("stroke-width", patched.status === "running" ? 3 : 2);

    // 触发数据绑定更新（progress bar 等由 data 驱动）
    if (patchCache) {
      // 仅更新内部状态，不重启 simulation
      const data = target.datum() as any;
      if (data) {
        Object.assign(data, patched);
      }
    }

    // 若该节点进入 running：重启光点流动（沿其下游边）
    if (patched.status === "running") {
      stopFlowDots();
      const running = runningNodeIds(currentNodes);
      startFlowDots(currentZoomGroup!, currentNodes, currentEdges, running);
    }
  });

  onDestroy(() => {
    simulation?.stop();
    resizeObs?.disconnect();
    stopFlowDots();
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
