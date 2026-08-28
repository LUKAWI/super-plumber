<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import { graphState } from "../lib/store.svelte";
  import { computeFitTransform } from "../lib/layout";
  import {
    STATUS_COLORS,
    EDGE_TYPE_LABELS,
    statusColorOf,
    type GraphIndex,
    type NodeSchema,
    type NodeStatus,
    type EdgeSchema,
    type EdgeType,
  } from "../lib/types";
  import {
    contextColors,
    contextHullGroups,
    isContractEdge,
    isEdgeVisibleInMaps,
    isNodeVisibleInMaps,
  } from "../lib/maps";

  // Extend NodeSchema with D3 simulation properties
  type SimNode = NodeSchema & d3.SimulationNodeDatum;
  type SimEdge = EdgeSchema & { source: SimNode | string; target: SimNode | string };

  let svgEl: SVGSVGElement;
  let wrapperEl: HTMLDivElement;
  let tooltipEl: HTMLDivElement;
  let dustEl: SVGSVGElement;
  let simulation: d3.Simulation<SimNode, undefined> | null = null;
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let zoomGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

  // 布局持久化：按图名分桶缓存节点坐标（v0.7：修复跨图同名 id 互继承坐标；
  // P4-2：加一条边不再全图重抖）
  const positionsByGraph = new Map<string, Map<string, { x: number; y: number }>>();
  function positionsFor(graphName: string): Map<string, { x: number; y: number }> {
    let m = positionsByGraph.get(graphName);
    if (!m) {
      m = new Map();
      positionsByGraph.set(graphName, m);
    }
    return m;
  }
  let currentNodes: SimNode[] = [];
  let currentEdges: SimEdge[] = [];
  /** 当前图的位置缓存（renderGraph 时指向对应图分桶；拖拽/结算写入用） */
  let currentPositions: Map<string, { x: number; y: number }> = new Map();
  // 布局钉住改由 store 全局态承载（工具轨按钮/快捷键共用）
  const pinned = $derived(graphState.layoutPinned);

  // fit 管线（v0.7 评审 P0：废除 setTimeout(2000) 魔数——挂接模拟收敛，
  // 并在切图/透镜重渲染时强制重新取景）
  let fitDone = false;
  let fitFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  // 用户是否手动动过视角（缩/平移）：动了就不做终态自动取景
  let userMovedView = false;

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

  const prefersReducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const ENTER_DURATION = prefersReducedMotion ? 0 : 400;
  const NODE_R = 20;
  const CONTEXT_R = 26; // context 顶点（领域视图）：虚线大圆
  const HULL_PAD = NODE_R + 20; // 星云云体外扩半径（罩住成员星芒主体）

  function nodeR(d: SimNode): number {
    return d.type === "context" ? CONTEXT_R : NODE_R;
  }

  function getContainerSize() {
    return { w: wrapperEl?.clientWidth || 960, h: wrapperEl?.clientHeight || 680 };
  }

  /** 微尘生成（氛围层，非数据——用 Math.random 即可）：面积/18000 粒，20% 极慢闪烁 */
  function buildDust() {
    if (!dustEl || !wrapperEl) return;
    const w = Math.max(320, wrapperEl.clientWidth || 960);
    const h = Math.max(240, wrapperEl.clientHeight || 680);
    const dust = d3.select(dustEl);
    dust.selectAll("*").remove();
    dust.attr("viewBox", `0 0 ${w} ${h}`).attr("preserveAspectRatio", "xMidYMid slice");
    const layer = dust.append("g");
    const n = Math.min(120, Math.max(30, Math.round((w * h) / 18000)));
    for (let i = 0; i < n; i++) {
      const r = Math.random() < 0.7 ? 0.5 + Math.random() * 0.5 : 1.0 + Math.random() * 0.4;
      const twinkle = Math.random() < 0.2;
      const c = layer.append("circle")
        .attr("cx", (Math.random() * w).toFixed(1))
        .attr("cy", (Math.random() * h).toFixed(1))
        .attr("r", r.toFixed(2))
        .attr("class", twinkle ? "dust dust-tw" : "dust");
      if (twinkle) c.style("animation-delay", `${(-Math.random() * 4.5).toFixed(2)}s`);
    }
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
    const statuses = graphState.statusFilter;
    if (statuses !== null && !statuses.includes(n.status as NodeStatus)) return false;
    const q = graphState.query.trim().toLowerCase();
    if (q && !n.id.toLowerCase().includes(q) && !n.label.toLowerCase().includes(q)) return false;
    return true;
  }

  /** 当前过滤（层级+状态+搜索）下可见的节点数（0 → 画布空态提示） */
  const filterMatchCount = $derived.by(() => {
    const g = graphState.graph;
    if (!g) return 0;
    return g.nodes.filter(
      (n) => n.type !== "adr" && nodeRendered(n) && nodeMatchesFilters(n),
    ).length;
  });

  /** 搜索/过滤是否处于激活态（决定是否显示"无匹配"空态） */
  const filtersActive = $derived(
    graphState.query.trim() !== "" ||
      graphState.levelFilter !== null ||
      graphState.statusFilter !== null,
  );

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

  // 边视觉基线（2026-08-28 拍板：E1 渐隐星座线 + E3 running 能量流）
  // 两端渐隐由每边的 userSpaceOnUse 线性渐变承担（线本体 stroke-opacity 恒 1）；
  // 契约边虚线 + 中段略亮；running 源的出边走琥珀能量档（E3，与 flow dots 同源）
  // 2026-08-28 排查（.edge-debug 像素采样实证）：fit 后 k≈0.6-0.9，1.5px 线缩到
  // 0.9-1.35px 亚像素 + 渐变中段 0.75，整条 96px 边仅 ~98 个亮像素（峰值 61%）
  // ——感知"隐约可见"；叠加 f8389b4 旧版参数（0.5/22-78）则峰值再打 68% 折即
  // "完全不可见"。修复 = 渐变增亮（0.85/8-92）+ 线宽随缩放补偿（屏幕宽 base×√k）。
  function edgeEnergy(e: SimEdge): boolean {
    const sid = edgeEndId(e.source);
    return currentNodes.find((n) => n.id === sid)?.status === "running";
  }
  function edgeGradId(e: SimEdge): string {
    return `eg-${e.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  }
  function edgeBaseWidth(e: SimEdge): number {
    return edgeEnergy(e) ? 1.9 : edgeIsContract(e) ? 1.8 : 1.5;
  }
  // 线宽缩放补偿：k<1 时按 1/√k 放大（屏幕宽 = base×√k，亚像素不再摊薄），
  // k≥1 不缩（上限 2.2×，scaleExtent 下限 0.15 时防巨粗）；zoom 时批量刷（带 0.03 步进阈值）
  let edgeZoomW = 1;
  let lastAppliedZoomW = 1;
  function syncEdgeZoomWidth(k: number) {
    const w = Math.min(2.2, Math.max(1, 1 / Math.sqrt(k)));
    if (Math.abs(w - lastAppliedZoomW) < 0.03) {
      edgeZoomW = lastAppliedZoomW;
      return;
    }
    edgeZoomW = w;
    lastAppliedZoomW = w;
    zoomGroup?.selectAll<SVGLineElement, SimEdge>(".edges .edge-line")
      .attr("stroke-width", (d: SimEdge) => edgeWidthOf(d));
  }
  function edgeWidthOf(e: SimEdge): number {
    return edgeBaseWidth(e) * edgeZoomW;
  }

  /** 渐变 stops（energy 切档）+ 初始端点坐标；渐变元素内嵌在 g.edge-group 里，随组生死 */
  function applyEdgeVisual(sel: d3.Selection<SVGGElement, SimEdge, any, any>) {
    sel.select<SVGLinearGradientElement>("linearGradient.edge-grad").each(function (this: SVGLinearGradientElement, d: SimEdge) {
      const g = d3.select(this);
      g.selectAll("stop").remove();
      if (edgeEnergy(d)) {
        g.append("stop").attr("offset", "0%").attr("stop-color", STATUS_COLORS.running).attr("stop-opacity", 0.7);
        g.append("stop").attr("offset", "65%").attr("stop-color", STATUS_COLORS.running).attr("stop-opacity", 0.2);
        g.append("stop").attr("offset", "100%").attr("stop-color", STATUS_COLORS.running).attr("stop-opacity", 0);
      } else {
        // 中段 0.7 + 10%-90% 平台：结构可读、两端仍向星晕溶解（0.85/8-92 用户实测过重）
        const mid = edgeIsContract(d) ? 0.78 : 0.7;
        g.append("stop").attr("offset", "0%").attr("stop-color", "#ffffff").attr("stop-opacity", 0);
        g.append("stop").attr("offset", "10%").attr("stop-color", "#ffffff").attr("stop-opacity", mid);
        g.append("stop").attr("offset", "90%").attr("stop-color", "#ffffff").attr("stop-opacity", mid);
        g.append("stop").attr("offset", "100%").attr("stop-color", "#ffffff").attr("stop-opacity", 0);
      }
      // 初始坐标（tick 逐帧接管）：端点未就绪时 0,0 退化一帧可接受
      const sx = (currentNodes.find((n) => n.id === edgeEndId(d.source))?.x ?? 0);
      const sy = (currentNodes.find((n) => n.id === edgeEndId(d.source))?.y ?? 0);
      const tx = (currentNodes.find((n) => n.id === edgeEndId(d.target))?.x ?? 0);
      const ty = (currentNodes.find((n) => n.id === edgeEndId(d.target))?.y ?? 0);
      g.attr("x1", sx).attr("y1", sy).attr("x2", tx).attr("y2", ty);
    });
    sel.select<SVGLineElement>(".edge-line")
      .attr("stroke", (d: SimEdge) => `url(#${edgeGradId(d)})`)
      .attr("stroke-width", (d: SimEdge) => edgeWidthOf(d))
      .attr("stroke-opacity", 1);
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
    // 边基线（E1 渐隐由渐变承担；契约边虚线 + 加粗中段；E3 能量档加粗；宽度随缩放补偿）
    edgeSel.select<SVGLineElement>(".edge-line")
      .attr("stroke-opacity", 1)
      .attr("stroke-width", (d: SimEdge) => edgeWidthOf(d))
      .attr("stroke-dasharray", (d: SimEdge) => (edgeIsContract(d) ? "7 4" : null));
  }

  // ── 叠加视图装饰：领域星云（ADR 徽章 2026-08-28 退役——图中不再设 ADR 文档入口）──

  /** 从模拟节点重建 hull 分组（渲染/数据变化时调用） */
  function refreshOverlayDecorations() {
    if (!zoomGroup) return;
    if (!isOverlay) {
      zoomGroup.selectAll(".hulls").remove();
      currentHulls = [];
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

    renderHullLayer();
    updateHullsAndBadges();
  }

  /** 领域星云云体：质心 + 成员最大距离 + pad（圆云；渐变走 objectBoundingBox，免逐帧坐标同步） */
  function cloudGeometry(members: SimNode[], pad: number): { cx: number; cy: number; r: number } | null {
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
    let r = pad;
    for (const p of pts) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy) + pad);
    return { cx, cy, r };
  }

  function renderHullLayer() {
    if (!zoomGroup || !svgEl) return;
    let hullG = zoomGroup.select<SVGGElement>("g.hulls");
    if (hullG.empty()) {
      // 插到最底层（edges/nodes 之前）
      hullG = zoomGroup.insert<SVGGElement>("g", ":first-child").attr("class", "hulls");
    }
    // 每个上下文一朵云：径向渐变按 objectBoundingBox 跟随云体（云内 0.12 → 0）
    const defs = d3.select(svgEl).select("defs");
    for (const h of currentHulls) {
      const gid = `neb-${h.contextId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      if (defs.select(`#${gid}`).empty()) {
        const grad = defs.append("radialGradient").attr("id", gid);
        grad.append("stop").attr("offset", "0%").attr("stop-color", h.color).attr("stop-opacity", 0.12);
        grad.append("stop").attr("offset", "55%").attr("stop-color", h.color).attr("stop-opacity", 0.05);
        grad.append("stop").attr("offset", "100%").attr("stop-color", h.color).attr("stop-opacity", 0);
      }
    }
    const sel = hullG
      .selectAll<SVGGElement, HullRender>("g.hull")
      .data(currentHulls, (h) => h.contextId);
    sel.exit().remove();
    const enter = sel.enter().append("g").attr("class", "hull");
    enter.append("circle").attr("class", "hull-cloud");
    // 云心微尘点（context 顶点化身：云由谁而生可寻）
    enter.append("circle").attr("class", "hull-core").attr("r", 2.6);
    enter.append("circle").attr("class", "hull-core-ring")
      .attr("r", 5.2).attr("fill", "none").attr("stroke-width", 1).attr("stroke-opacity", 0.5);
    enter.append("text").attr("class", "hull-label");
    const all = enter.merge(sel);
    all.select(".hull-cloud")
      .attr("fill", (h) => `url(#neb-${h.contextId.replace(/[^a-zA-Z0-9_-]/g, "_")})`)
      // 淡虚线云缘：颜色之外需要轮廓区分领域（2026-08-28 用户拍板）
      .attr("stroke", (h) => h.color)
      .attr("stroke-opacity", 0.35)
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4 4")
      .style("cursor", "pointer")
      .on("click", (_event: MouseEvent, h: HullRender) => {
        const full = currentGraph?.nodes.find((n) => n.id === h.contextId);
        if (full) graphState.selectNode(full);
      });
    all.select(".hull-core")
      .attr("fill", (h) => h.color)
      .attr("fill-opacity", 0.95)
      .style("pointer-events", "none");
    all.select(".hull-core-ring")
      .attr("stroke", (h) => h.color)
      .style("pointer-events", "none");
    all.select(".hull-label")
      .text((h) => `${h.label} · ${h.members.length}`)
      .attr("text-anchor", "middle")
      .attr("font-family", "var(--font-sans)")
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("fill", (h) => h.color)
      .attr("paint-order", "stroke")
      .attr("stroke", "#000000")
      .attr("stroke-width", "3px")
      .attr("stroke-linejoin", "round")
      .style("pointer-events", "none")
      .style("user-select", "none");
  }

  /** 每 tick 更新星云云体 / 云心 / 标签 */
  function updateHullsAndBadges() {
    if (!zoomGroup || !isOverlay) return;
    zoomGroup.selectAll<SVGGElement, HullRender>(".hulls g.hull").each(function (this: SVGGElement, h: HullRender) {
      const geom = cloudGeometry(h.members, HULL_PAD);
      const g = d3.select(this);
      if (!geom) {
        g.attr("display", "none");
        return;
      }
      g.attr("display", null);
      g.select(".hull-cloud").attr("cx", geom.cx).attr("cy", geom.cy).attr("r", geom.r);
      g.select(".hull-core").attr("cx", geom.cx).attr("cy", geom.cy);
      g.select(".hull-core-ring").attr("cx", geom.cx).attr("cy", geom.cy);
      g.select(".hull-label").attr("x", geom.cx).attr("y", geom.cy - geom.r - 6);
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

    // 渐变内嵌在边组里（随组生死，免 defs 孤儿清理）；坐标由 tick 逐帧同步。
    // 2026-08-28 排查实锤：此处曾漏设 id——全部渐变 id 为空，stroke 的
    // url(#eg-…) 引用悬空（Chrome 对无 fallback 的失效 paint 引用按 initial
    // none 处理 → 线整体不绘制），即"边完全不可见"的根因；computed style
    // 逐项核验却全部"正确"（引用字面值无误，无人解引用查目标存在性）。
    enter.append("linearGradient")
      .attr("class", "edge-grad")
      .attr("id", (d: SimEdge) => edgeGradId(d))
      .attr("gradientUnits", "userSpaceOnUse")
      .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 0);
    enter.append("line").attr("class", "edge-line");
    enter.append("text").attr("class", "edge-label");

    const all = enter.merge(link);

    // E1/E3：线 stroke 指向本组渐变（两端渐隐/琥珀档由渐变承担），箭头退役
    applyEdgeVisual(all);

    all
      .select(".edge-label")
      .attr("text-anchor", "middle")
      .attr("font-size", "11px")
      .attr("font-family", "var(--font-sans)")
      .attr("fill", "rgba(255, 255, 255, 0.92)")
      .attr("paint-order", "stroke")
      .attr("stroke", "#000000")
      .attr("stroke-width", "3px")
      .attr("stroke-linejoin", "round")
      .attr("opacity", 0)
      .text(edgeLabelOf);

    // hover 高亮 + 点击选中（边详情）；端点星以 edge-hilite 类增亮（CSS 承担视觉）
    all
      .on("mouseenter", function (this: SVGGElement) {
        const group = d3.select(this);
        group.select(".edge-line")
          .attr("stroke-width", 2.5 * edgeZoomW);
        group.select(".edge-label").attr("opacity", 1);
        const d = group.datum() as SimEdge;
        const srcId = edgeEndId(d.source);
        const tgtId = edgeEndId(d.target);
        parent.selectAll<SVGGElement, SimNode>(".nodes > g.node")
          .filter((n: SimNode) => n.id === srcId || n.id === tgtId)
          .classed("edge-hilite", true);
      })
      .on("mouseleave", function (this: SVGGElement) {
        const group = d3.select(this);
        const d = group.datum() as SimEdge;
        group.select(".edge-line")
          .attr("stroke-width", edgeWidthOf(d));
        group.select(".edge-label").attr("opacity", 0);
        const srcId = edgeEndId(d.source);
        const tgtId = edgeEndId(d.target);
        parent.selectAll<SVGGElement, SimNode>(".nodes > g.node")
          .filter((n: SimNode) => n.id === srcId || n.id === tgtId)
          .classed("edge-hilite", false);
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

  // ── 星体视觉正本（star-node-demo.html V4 八向棱星，2026-08-28 两度拍板）──
  // 颜色=状态；星等=状态权重（running 最亮最长、cancelled 最暗）；
  // 星芒 = 2 长主芒（白渐变）+ 2 斜短芒（0.565×）+ 红蓝错位色差残像（prism-shift）。
  // halo 贴芒（r ≈ 1.04×芒长）——游离光球才是光污染，贴芒后即星体气质。
  // 数值单位为星体本征坐标，随 nodeR 通过 star-scale 组缩放（context 顶点更大）。
  const STAR_SPEC: Record<string, { spike: number; glow: number; core: number }> = {
    pending: { spike: 44, glow: 0.7, core: 2.6 },
    ready: { spike: 44, glow: 0.7, core: 2.6 },
    running: { spike: 48, glow: 1, core: 2.8 },
    passed: { spike: 44, glow: 0.7, core: 2.6 },
    failed: { spike: 46, glow: 0.9, core: 2.7 },
    blocked: { spike: 45, glow: 0.75, core: 2.6 },
    cancelled: { spike: 34, glow: 0.45, core: 2.2 },
  };

  function starSpecOf(d: SimNode) {
    const s = nodeR(d) / NODE_R;
    return { ...(STAR_SPEC[d.status] ?? STAR_SPEC.pending), s };
  }

  /** 菱形主芒路径：v 竖向 / h 横向；半宽取 0.041×（V4 正本 1.8/46） */
  function spikePathV(len: number): string {
    const w = Math.max(1, len * 0.041);
    return `M0,${-len} L${w},0 L0,${len} L${-w},0 Z`;
  }
  function spikePathH(len: number): string {
    const w = Math.max(1, len * 0.041);
    return `M${-len},0 L0,${-w} L${len},0 L0,${w} Z`;
  }

  /** 闪烁相位：id 哈希 → 同图每次加载相位一致、星与星去同步 */
  function starTwinklePhase(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /** 星态任务摘要（星芒旁常显；超长截断，hover tooltip 出全文） */
  function labelOf(d: SimNode): string {
    const max = d.type === "context" ? 18 : 20;
    return d.label.length > max ? `${d.label.slice(0, max - 2)}…` : d.label;
  }

  /** 依状态/尺寸应用星体几何与闪烁相位（全量渲染与增量补丁共用） */
  function applyStarVisual(sel: d3.Selection<SVGGElement, SimNode, any, any>) {
    sel.select(".node-hit").attr("r", (d: SimNode) => nodeR(d) + 8);
    sel.select(".star-scale").attr("transform", (d: SimNode) => `scale(${starSpecOf(d).s})`);
    const L = (d: SimNode) => starSpecOf(d).spike * starSpecOf(d).s;
    sel.select(".star-halo")
      .attr("r", (d: SimNode) => L(d) * 0.88)
      .attr("fill", (d: SimNode) => `url(#halo-${d.status})`)
      .style("animation-delay", (d: SimNode) => `${-(starTwinklePhase(d.id) % 3600)}ms`);
    sel.select(".star-spikes")
      .attr("opacity", (d: SimNode) => starSpecOf(d).glow)
      .style("animation-delay", (d: SimNode) => `${-((starTwinklePhase(d.id) * 7) % 5200)}ms`);
    sel.selectAll<SVGPathElement, SimNode>(".spike-v,.prism-v")
      .attr("d", (d: SimNode) => spikePathV(L(d)));
    sel.selectAll<SVGPathElement, SimNode>(".spike-h,.prism-h")
      .attr("d", (d: SimNode) => spikePathH(L(d)));
    sel.selectAll<SVGPathElement, SimNode>(".spike-d1,.spike-d2")
      .attr("d", (d: SimNode) => spikePathV(L(d) * 0.565));
    sel.select(".prism-r")
      .style("animation-delay", (d: SimNode) => `${-((starTwinklePhase(d.id) * 3) % 2200)}ms`);
    // prism-b 保留 -1.1s 基础错相（与 prism-r 反相才有色差感）
    sel.select(".prism-b")
      .style("animation-delay", (d: SimNode) => `${-((starTwinklePhase(d.id) * 3) % 2200 + 1100)}ms`);
    sel.select(".star-core")
      .attr("r", (d: SimNode) => starSpecOf(d).core * starSpecOf(d).s)
      .style("animation-delay", (d: SimNode) => `${-((starTwinklePhase(d.id) * 13) % 2800)}ms`);
    sel.select(".hover-flash").attr("r", (d: SimNode) => L(d) * 1.1);
    sel.select(".hover-ring").attr("r", (d: SimNode) => L(d) * 0.95);
    sel.select(".diff-ring").attr("r", (d: SimNode) => L(d) * 1.02);
    sel.classed("st-running", (d: SimNode) => d.status === "running");
    // 摘要沿主芒外侧常显；执行者标签让位至芒尖之外
    sel.select(".node-label").attr("x", (d: SimNode) => L(d) + 12);
    sel.select(".assign-label").attr("y", (d: SimNode) => -(L(d) + 14));
  }

  // ── 节点层渲染 ──
  function renderNodeLayer(parent: d3.Selection<SVGGElement, unknown, null, undefined>, nodes: SimNode[]) {
    let nodeG = parent.select<SVGGElement>(".nodes");
    if (nodeG.empty()) nodeG = parent.append("g").attr("class", "nodes");

    const node = nodeG
      .selectAll<SVGGElement, SimNode>("g.node")
      .data(nodes, (d: SimNode) => d.id);

    node.exit().remove();

    const enter = node.enter().append("g").attr("class", "node").style("cursor", "pointer")
      // 键盘可达（v0.7 评审 P0）：SVG 节点可 Tab 聚焦、Enter/Space 选中
      .attr("tabindex", 0)
      .attr("role", "button");

    // 命中盘：星体不参与拾取，交互面积 = 星心外扩 8
    enter.append("circle").attr("class", "node-hit").attr("fill", "transparent");

    // 星体（V4 正本）：halo 贴芒 → 色差残像 → 八向星芒 → 白炽心；
    // hover 声呐元素（flash/ring）默认不可见；diff-ring 仅对比模式显现
    const sky = enter.append("g").attr("class", "star-scale")
      .append("g").attr("class", "star-sky");
    sky.append("circle").attr("class", "star-halo");
    sky.append("circle").attr("class", "hover-flash").attr("fill", "url(#flash-grad)");
    sky.append("circle").attr("class", "hover-ring")
      .attr("fill", "none").attr("stroke", "#ffffff").attr("stroke-width", 1).attr("stroke-opacity", 0.9);
    sky.append("circle").attr("class", "diff-ring").attr("fill", "none").attr("stroke-opacity", 0.9);
    const ghostSpecs = [
      { cls: "prism-r", color: "#e5504f", offV: "translate(0.8,0)", offH: "translate(0,-0.8)" },
      { cls: "prism-b", color: "#4a93e8", offV: "translate(-0.8,0)", offH: "translate(0,0.8)" },
    ] as const;
    for (const g of ghostSpecs) {
      const pg = sky.append("g").attr("class", g.cls).attr("fill", g.color).attr("opacity", 0.5);
      pg.append("path").attr("class", "prism-v").attr("transform", g.offV);
      pg.append("path").attr("class", "prism-h").attr("transform", g.offH);
    }
    const spikes = sky.append("g").attr("class", "star-spikes");
    spikes.append("path").attr("class", "spike-v").attr("fill", "url(#spike-v)");
    spikes.append("path").attr("class", "spike-h").attr("fill", "url(#spike-h)");
    spikes.append("path").attr("class", "spike-d1").attr("transform", "rotate(45)")
      .attr("fill", "rgba(255,255,255,0.95)").attr("fill-opacity", 0.55);
    spikes.append("path").attr("class", "spike-d2").attr("transform", "rotate(-45)")
      .attr("fill", "rgba(255,255,255,0.95)").attr("fill-opacity", 0.55);
    sky.append("circle").attr("class", "star-core").attr("fill", "#ffffff");

    // 摘要（星芒外侧常显）+ 执行者标签（running）
    enter.append("text").attr("class", "node-label");
    enter.append("text").attr("class", "assign-label");

    const all = enter.merge(node);

    // 任务摘要：星芒外侧常显（黑描边保证压在 halo/边线上仍可读）
    all.select(".node-label")
      .text(labelOf)
      .attr("text-anchor", "start")
      .attr("dominant-baseline", "central")
      .attr("font-family", "var(--font-sans)")
      .attr("font-size", "11px")
      .attr("font-weight", "500")
      .attr("fill", (d: SimNode) =>
        d.type === "context" ? currentContextColors.get(d.id) ?? "var(--ink)" : "rgba(255, 255, 255, 0.92)")
      .attr("paint-order", "stroke")
      .attr("stroke", "#000000")
      .attr("stroke-width", "3px")
      .attr("stroke-linejoin", "round")
      .style("pointer-events", "none")
      .style("user-select", "none");

    // 执行者标签（running 节点；agent id = 数据 → mono）
    all.select(".assign-label")
      .text((d: SimNode) => (d.status === "running" && d.assigned_to ? d.assigned_to : ""))
      .attr("text-anchor", "middle")
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", "10px")
      .attr("font-weight", "500")
      .attr("fill", "#f0a73a")
      .attr("opacity", (d: SimNode) => (d.status === "running" && d.assigned_to ? 0.9 : 0))
      .style("pointer-events", "none")
      .style("user-select", "none");

    // 星体几何/相位（放在基线设置之后：y/x 等位置由星等决定）
    applyStarVisual(all);

    // 交互：hover 声呐环（CSS）+ tooltip + 点击选中 + 键盘焦点/选中（类驱动）
    all
      .attr("aria-label", (d: SimNode) => `${d.label}（${d.status}）`)
      .on("keydown", function (event: KeyboardEvent, d: SimNode) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          graphState.selectNode(d);
        }
      })
      .on("focus", function (this: SVGGElement) {
        // 键盘焦点与 hover 同语言（声呐环由 .is-focused 类触发）；SVG g 无 outline
        d3.select(this).classed("is-focused", true);
      })
      .on("blur", function (this: SVGGElement) {
        d3.select(this).classed("is-focused", false);
      })
      .on("mouseenter", function (this: SVGGElement, event: MouseEvent) {
        const el = this;
        const d = d3.select(el).datum() as SimNode;
        const max = d.type === "context" ? 18 : 20;
        if (d.label.length > max && tooltipEl) {
          const rect = wrapperEl.getBoundingClientRect();
          tooltipEl.textContent = d.label;
          tooltipEl.style.display = "block";
          tooltipEl.style.left = `${event.clientX - rect.left + 12}px`;
          tooltipEl.style.top = `${event.clientY - rect.top - 8}px`;
        }
        // 被退让隐藏的标签 hover 时恢复可读
        d3.select(el).select(".node-label").attr("opacity", 1);
      })
      .on("mouseleave", function (this: SVGGElement) {
        if (tooltipEl) tooltipEl.style.display = "none";
        const el = this;
        const d = d3.select(el).datum() as SimNode;
        d3.select(el).select(".node-label")
          .attr("opacity", (d as unknown as { __labelCulled?: boolean }).__labelCulled ? 0 : 1);
      })
      .on("click", function (_event: MouseEvent, d: SimNode) {
        graphState.selectNode(d);
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
        currentPositions.set(d.id, { x: event.x, y: event.y });
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
        currentPositions.set(d.id, { x: d.x ?? 0, y: d.y ?? 0 });
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
  let lastGraphName: string | null = null;
  function renderGraph(graph: GraphIndex) {
    if (!svgEl || !graph || !wrapperEl) return;
    const { w, h } = getContainerSize();
    const overlay = isOverlay;
    const graphName = graph.name ?? "default";
    const isGraphSwitch = lastGraphName !== null && lastGraphName !== graphName;
    lastGraphName = graphName;

    stopFlowDots();
    const svg = d3.select(svgEl);
    const previousTransform = (svgEl as SVGSVGElement & { __zoom?: d3.ZoomTransform }).__zoom;
    const positions = positionsFor(graphName);
    currentPositions = positions;

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
    // 2026-08-28：箭头随 E1 星座线退役（marker 定义一并移除）
    const glowFilter = defs.append("filter")
      .attr("id", "glow")
      .attr("x", "-50%").attr("y", "-50%")
      .attr("width", "200%").attr("height", "200%");
    glowFilter.append("feGaussianBlur").attr("stdDeviation", 4).attr("result", "coloredBlur");
    const feMerge = glowFilter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // 星体 defs：每状态一个 halo 径向渐变（V4 正本浓度，2026-08-28 再降档：
    // 光晕收至 0.88×芒长以内，中心 0.5-0.55——"减光晕"意味着星已足够亮）
    for (const [st, color] of Object.entries(STATUS_COLORS) as [NodeStatus, string][]) {
      const grad = defs.append("radialGradient").attr("id", `halo-${st}`);
      grad.append("stop").attr("offset", "0%").attr("stop-color", color)
        .attr("stop-opacity", st === "running" ? 0.55 : 0.5);
      grad.append("stop").attr("offset", "45%").attr("stop-color", color)
        .attr("stop-opacity", st === "running" ? 0.13 : 0.11);
      grad.append("stop").attr("offset", "100%").attr("stop-color", color).attr("stop-opacity", 0);
    }
    const flashGrad = defs.append("radialGradient").attr("id", "flash-grad");
    flashGrad.append("stop").attr("offset", "0%").attr("stop-color", "#ffffff").attr("stop-opacity", 0.85);
    flashGrad.append("stop").attr("offset", "45%").attr("stop-color", "#ffffff").attr("stop-opacity", 0.18);
    flashGrad.append("stop").attr("offset", "100%").attr("stop-color", "#ffffff").attr("stop-opacity", 0);
    const spikeGradSpecs = [
      { id: "spike-v", x2: 0, y2: 1 },
      { id: "spike-h", x2: 1, y2: 0 },
    ] as const;
    for (const sg of spikeGradSpecs) {
      const grad = defs.append("linearGradient").attr("id", sg.id)
        .attr("x1", 0).attr("y1", 0).attr("x2", sg.x2).attr("y2", sg.y2);
      grad.append("stop").attr("offset", "0%").attr("stop-color", "#ffffff").attr("stop-opacity", 0);
      grad.append("stop").attr("offset", "50%").attr("stop-color", "#ffffff").attr("stop-opacity", 0.85);
      grad.append("stop").attr("offset", "100%").attr("stop-color", "#ffffff").attr("stop-opacity", 0);
    }

    svg.append("rect")
      .attr("width", w).attr("height", h)
      .attr("fill", "url(#dot-grid)")
      .attr("class", "grid-bg");

    // 缩放组（复用一个 zoom behavior，保持用户视角）
    zoomGroup = svg.append("g").attr("class", "zoom-group");
    if (!zoomBehavior) {
      let declutterTimer: ReturnType<typeof setTimeout> | null = null;
      zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 4])
        .on("zoom", (event) => {
          if (zoomGroup) zoomGroup.attr("transform", event.transform);
          // 程序化取景（fit/定位）不带 sourceEvent——只有真实滚轮/拖拽才算用户操作
          if (event.sourceEvent) userMovedView = true;
          const gridOpacity = Math.min(1, event.transform.k * 1.5);
          svg.select(".grid-bg").attr("opacity", gridOpacity);
          // 边线宽随缩放补偿（k<1 亚像素摊薄是"看不到线"的共因）
          syncEdgeZoomWidth(event.transform.k);
        })
        .on("end", () => {
          // 缩放稳定后重跑标签退让（放大后隐藏的标签自然回归）
          if (declutterTimer) clearTimeout(declutterTimer);
          declutterTimer = setTimeout(() => declutterLabels(), 150);
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
    if (previousTransform && !isGraphSwitch) {
      // 同图重渲染（透镜切换/数据刷新）保持用户视角；切图则由 fit 管线重新取景
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
    // 保持视角的同图重渲染：边宽补偿与当前 k 对齐（新建 DOM 已按 edgeZoomW 生成，
    // 这里兜底 lastAppliedZoomW 状态与实际 transform 一致）
    syncEdgeZoomWidth((svgEl as SVGSVGElement & { __zoom?: d3.ZoomTransform }).__zoom?.k ?? 1);

    // 入场动画只跑一次（v0.7：原实现在 tick 内每帧重启，浪费且抖动）
    if (!prefersReducedMotion && !isGraphSwitch) {
      zoomGroup.selectAll<SVGGElement, SimNode>(".nodes > g.node")
        .attr("opacity", 0)
        .transition().delay((_, i) => Math.min(i, 40) * 15).duration(ENTER_DURATION)
        .ease(d3.easeCubicOut)
        .attr("opacity", 1);
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
        // E1：渐隐方向必须随端点逐帧同步（userSpaceOnUse 坐标）
        d3.select(this).select("linearGradient.edge-grad")
          .attr("x1", sx).attr("y1", sy).attr("x2", tx).attr("y2", ty);
        d3.select(this).select(".edge-label")
          .attr("x", (sx + tx) / 2).attr("y", (sy + ty) / 2 - 4);
      });
      zoomGroup?.selectAll<SVGGElement, SimNode>(".nodes > g.node")
        .attr("transform", (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      updateHullsAndBadges();

      // fit 挂接模拟收敛（alpha ≤ 0.3 ≈ 布局可用），每次渲染只取景一次
      if (!fitDone && !pinned && simulation && simulation.alpha() <= 0.3) {
        fitDone = true;
        autoFit();
      }
    });

    simulation.on("end", () => {
      // 结算后写入位置缓存（下次重渲染复用）
      for (const n of nodes) {
        if (n.x !== undefined && n.y !== undefined) positions.set(n.id, { x: n.x, y: n.y });
      }
      startFlowDots(nodes, edges, runningNodeIds(nodes));
      // 终态补一次取景：alpha 0.3 早停后节点还会惯性漂移，首屏可能偏出画布
      //（星空评审实锤）；用户已手动动过视角则不打扰
      if (!userMovedView && !pinned) autoFit();
    });

    // fit 兜底：若 4s 内 alpha 阈值未触发（如 pinned/极小图），强制取景一次
    if (fitFallbackTimer) clearTimeout(fitFallbackTimer);
    fitDone = false;
    userMovedView = false;
    fitFallbackTimer = setTimeout(() => {
      if (!fitDone && !pinned) {
        fitDone = true;
        autoFit();
      }
    }, 4000);
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
      x: 0,
      y: 0,
    }));

    const dotSel = layer.selectAll("circle")
      .data(dots)
      .join("circle")
      .attr("r", 3)
      // 光点 = running 语义（琥珀），不再继承边类型色——血管理喻与触发状态同源
      .attr("fill", STATUS_COLORS.running)
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
        d.x = sx + (tx - sx) * d.t;
        d.y = sy + (ty - sy) * d.t;
      }
      // 一次 join 批量更新（v0.7：废除逐点 filter 的 O(n²)）
      dotSel.attr("cx", (d: unknown) => (d as { x: number }).x)
        .attr("cy", (d: unknown) => (d as { y: number }).y);
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
      .call(zoomBehavior.transform, d3.zoomIdentity.translate(t.tx, t.ty).scale(t.scale))
      .on("end", () => declutterLabels());
  }

  // ── 标签碰撞退让（finish review 修复 1）：fit/缩放稳定后跑一次贪心避让，
  // 状态优先级高的保留（running > failed > blocked > ready > passed > pending），
  // 互叠标签隐藏；hover 或放大后重新取景可恢复 ──
  const LABEL_PRIORITY: Record<string, number> = {
    running: 0, failed: 1, blocked: 2, ready: 3, passed: 4, pending: 5, cancelled: 6,
  };

  function declutterLabels() {
    if (!svgEl || !zoomGroup) return;
    const t = (svgEl as SVGSVGElement & { __zoom?: d3.ZoomTransform }).__zoom ?? d3.zoomIdentity;
    interface LBox { x1: number; y1: number; x2: number; y2: number }
    const kept: LBox[] = [];
    const entries: { d: SimNode; el: SVGTextElement; box: LBox; rank: number }[] = [];
    zoomGroup.selectAll<SVGGElement, SimNode>(".nodes > g.node")
      .each(function (this: SVGGElement, d: SimNode) {
        const g = d3.select(this);
        if (g.classed("map-hidden") || g.classed("dimmed")) return;
        if (d.x === undefined || d.y === undefined) return;
        const label = labelOf(d);
        const w = label.length * 11 + 8;
        // 摘要沿主芒外侧起排：盒左缘 = 芒尖 + 间距（屏幕坐标随缩放换算）
        const spec = starSpecOf(d);
        const tipX = (spec.spike * spec.s + 10) * t.k;
        const cx = t.applyX(d.x);
        const cy = t.applyY(d.y); // dominant-baseline central
        entries.push({
          d,
          el: this.querySelector(".node-label") as SVGTextElement,
          box: { x1: cx + tipX - 4, y1: cy - 8, x2: cx + tipX + w, y2: cy + 8 },
          rank: LABEL_PRIORITY[d.status] ?? 9,
        });
      });
    entries.sort((a, b) => a.rank - b.rank);
    for (const e of entries) {
      const hit = kept.some((b) =>
        e.box.x1 < b.x2 && e.box.x2 > b.x1 && e.box.y1 < b.y2 && e.box.y2 > b.y1,
      );
      (e.d as unknown as { __labelCulled?: boolean }).__labelCulled = hit;
      d3.select(e.el).attr("opacity", hit ? 0 : 1);
      if (!hit) kept.push(e.box);
    }
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
    const next = !graphState.layoutPinned;
    graphState.setLayoutPinned(next);
    if (next) {
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
        applyStarVisual(target);
        target.select(".node-label")
          .text(labelOf(d));
        target.select(".assign-label")
          .text(d.status === "running" && d.assigned_to ? d.assigned_to : "")
          .attr("opacity", d.status === "running" && d.assigned_to ? 0.9 : 0);
        // 状态变化会影响出边能量档（E3）——全量边刷一遍渐变（边数少，代价可忽略）
        applyEdgeVisual(zoomGroup.selectAll<SVGGElement, SimEdge>(".edges .edge-group"));
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

  // 选中态同步：is-selected 类驱动星芒增亮 + 摘要提明（CSS），无圆形图标
  $effect(() => {
    const selectedId = graphState.selectedNode?.id;
    if (!zoomGroup) return;
    zoomGroup.selectAll<SVGGElement, SimNode>(".nodes > g.node")
      .classed("is-selected", (d: SimNode) => d.id === selectedId);
  });

  // 尺寸变化（v0.7：resize/旋转后强制重新取景——修复移动端黑屏）
  let resizeObs: ResizeObserver | null = null;
  let resizeFitTimer: ReturnType<typeof setTimeout> | null = null;
  onMount(() => {
    if (!wrapperEl) return;
    resizeObs = new ResizeObserver(() => {
      if (graphState.graph && svgEl) {
        const { w, h } = getContainerSize();
        d3.select(svgEl).attr("viewBox", `0 0 ${w} ${h}`);
        if (resizeFitTimer) clearTimeout(resizeFitTimer);
        resizeFitTimer = setTimeout(() => {
          fitDone = true; // 尺寸变化直接取景，不等模拟
          autoFit();
        }, 180);
      }
      buildDust(); // 微尘随容器重建（屏幕固定层）
    });
    resizeObs.observe(wrapperEl);
    buildDust();

    // 画布空白处点击 = 全局退出手势之一（清除选中）
    d3.select(svgEl).on("click.bg", (event: MouseEvent) => {
      const t = event.target as Element;
      if (t === svgEl || t.classList?.contains("grid-bg")) {
        // 焦点残留会让 is-focused 不退场（实体形态滞留），一并交还
        if (document.activeElement instanceof Element && document.activeElement.closest("g.node")) {
          (document.activeElement as HTMLElement).blur?.();
        }
        graphState.selectNode(null);
        graphState.selectEdge(null);
      }
    });

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
    if (fitFallbackTimer) clearTimeout(fitFallbackTimer);
    if (resizeFitTimer) clearTimeout(resizeFitTimer);
    stopFlowDots();
  });

  // 工具轨缩放命令（App 的统一工具轨 → 画布执行）
  $effect(() => {
    const req = graphState.zoomRequest;
    if (!req) return;
    if (req.kind === "in") zoomIn();
    else if (req.kind === "out") zoomOut();
    else if (req.kind === "fit") fitToView();
  });

  // 定位请求（搜索 Enter / 空态"定位"）：平移居中到目标节点
  $effect(() => {
    const req = graphState.locateRequest;
    if (!req || !svgEl || !zoomBehavior) return;
    const node = currentNodes.find((n) => n.id === req.nodeId);
    if (!node || node.x === undefined || node.y === undefined) return;
    const { w, h } = getContainerSize();
    const k = (svgEl as SVGSVGElement & { __zoom?: d3.ZoomTransform }).__zoom?.k ?? 1;
    d3.select(svgEl)
      .transition().duration(prefersReducedMotion ? 0 : 450).ease(d3.easeCubicOut)
      .call(zoomBehavior.transform, d3.zoomIdentity.translate(w / 2, h / 2).scale(k).translate(-(node.x as number), -(node.y as number)));
  });
  /** 叠加视图簇色图例（颜色必须有图例——v0.7 评审 P1：簇色不再无解释） */
  const overlayLegend = $derived.by(() => {
    if (!isOverlay) return [] as { id: string; color: string; label: string }[];
    const g = graphState.graph;
    if (!g) return [];
    const ids = g.nodes.filter((n) => n.type === "context").map((n) => n.id);
    const colors = contextColors(ids);
    return ids.map((id) => ({
      id,
      color: colors.get(id) ?? "#8a8f98",
      label: g.nodes.find((n) => n.id === id)?.label ?? id,
    }));
  });
</script>

<div bind:this={wrapperEl} class="canvas-wrapper">
  <!-- 银河带 + 微尘：屏幕固定层（不随缩放平移，缩放 4× 不穿帮；氛围预算 ≤0.05 alpha） -->
  <div class="sky-bg" aria-hidden="true">
    <div class="sky-band"></div>
    <svg class="sky-dust" bind:this={dustEl}></svg>
  </div>
  <svg bind:this={svgEl} class="graph-canvas"></svg>
  <div bind:this={tooltipEl} class="node-tooltip"></div>

  {#if graphState.graph && lensVisibleCount === 0}
    <div class="lens-empty" role="status">
      所有 map 透镜已关闭——在左侧工具轨的「透镜」里至少勾选一个
    </div>
  {:else if graphState.graph && filtersActive && filterMatchCount === 0}
    <div class="lens-empty" role="status">
      <span>没有匹配当前过滤条件的节点</span>
      <button class="lens-empty-clear" onclick={() => { graphState.setQuery(""); graphState.setLevelFilter(null); graphState.clearStatusFilter(); }}>
        清除过滤
      </button>
    </div>
  {/if}

  {#if overlayLegend.length > 0}
    <div class="ctx-legend" aria-label="context 簇色图例">
      {#each overlayLegend as item (item.id)}
        <span class="ctx-legend-item">
          <span class="ctx-dot" style="background: {item.color}"></span>
          <span class="ctx-name">{item.label}</span>
        </span>
      {/each}
    </div>
  {/if}

  {#if graphState.diff}
    <div class="diff-mode-chip" role="status">
      <span class="diff-mode-dot"></span>
      对比模式
      <span class="diff-mode-counts">
        +{graphState.diff.added.length} −{graphState.diff.removed.length} ~{graphState.diff.modified.length}
      </span>
      <button class="diff-mode-exit" onclick={() => graphState.clearDiff()} aria-label="退出对比模式">退出</button>
    </div>
  {/if}

  <div class="zoom-hint">
    <span class="hint-key">scroll</span> 缩放
    <span class="hint-sep">·</span>
    <span class="hint-key">drag</span> 平移
    <span class="hint-sep">·</span>
    <span class="hint-key">双击</span> 重置
    <span class="hint-sep">·</span>
    <span class="hint-key">0</span> 适配
    <span class="hint-sep">·</span>
    <span class="hint-key">Tab</span> 选节点
  </div>
</div>

<style>
  .canvas-wrapper {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--bg);
  }

  /* ── 银河带 + 微尘：屏幕固定层（不随缩放平移；氛围预算 ≤0.05 alpha）── */
  .sky-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .graph-canvas {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    display: block;
  }

  .sky-band {
    position: absolute;
    inset: -20%;
    background: linear-gradient(
      115deg,
      transparent 32%,
      rgba(207, 216, 255, 0.05) 45%,
      rgba(232, 236, 255, 0.032) 52%,
      transparent 68%
    );
  }

  .sky-band::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      115deg,
      transparent 42%,
      rgba(232, 236, 255, 0.03) 50%,
      transparent 58%
    );
  }

  .sky-dust {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
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

  /* 空透镜提示（字体/字距由后方 .lens-empty 块统一为 sans） */
  .lens-empty {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: var(--sp-3) var(--sp-4);
    pointer-events: none;
  }

  /* map 过滤：非本透镜顶点/边整体隐藏（display，而非淡化） */
  :global(.nodes > g.node.map-hidden),
  :global(.edges > g.edge-group.map-hidden) {
    display: none;
  }

  /* 过滤：不匹配节点/边淡化（0.3：保留轮廓可寻，配合无匹配空态） */
  :global(.nodes > g.node.dimmed),
  :global(.edges > g.edge-group.dimmed) {
    opacity: 0.3;
  }

  /* 叠加视图：ADR 徽章 */
  /* 2026-08-28：ADR 徽章层随「图中不设 ADR 文档入口」删除 */

  /* diff 着色（v0.7：纯形状编码——加粗/虚线/点线，不再劫持状态色相）
     节点侧已无圆形图标：编码落在 star-sky 的 diff-ring 上 */
  :global(.edges > g.edge-group.diff-added .edge-line) {
    stroke: rgba(255, 255, 255, 0.95);
    stroke-width: 3;
    stroke-opacity: 1;
    stroke-dasharray: none;
  }
  :global(.edges > g.edge-group.diff-removed .edge-line) {
    stroke: rgba(255, 255, 255, 0.95);
    stroke-width: 2.5;
    stroke-opacity: 1;
    stroke-dasharray: 3 3;
  }
  :global(.edges > g.edge-group.diff-modified .edge-line) {
    stroke: rgba(255, 255, 255, 0.95);
    stroke-width: 2.5;
    stroke-opacity: 1;
    stroke-dasharray: 8 3;
  }

  /* diff 形状编码的星态载体：diff-ring（星芒外细环，仅对比模式显现；同语言：加粗/虚线/点线） */
  :global(.nodes > g.node.diff-added .diff-ring) {
    opacity: 1;
    stroke: rgba(255, 255, 255, 0.95);
    stroke-width: 2.5;
  }
  :global(.nodes > g.node.diff-removed .diff-ring) {
    opacity: 1;
    stroke: rgba(255, 255, 255, 0.95);
    stroke-width: 2;
    stroke-dasharray: 3 3;
  }
  :global(.nodes > g.node.diff-modified .diff-ring) {
    opacity: 1;
    stroke: rgba(255, 255, 255, 0.95);
    stroke-width: 2;
    stroke-dasharray: 8 3;
  }

  /* ── 星空节点（2026-08-28 两度拍板：V4 棱星正本 + 声呐环 hover）──────
     节点 DOM 由 d3 生成 → 规则走 :global，keyframes 亦须全局。
     圆形节点形态已退役——hover/键盘焦点/选中/边高亮全部以「声呐环 + 白炽脉冲
     + 星芒增亮」表达，无任何圆环图标。闪烁只动 opacity/transform。 */
  :global {
    @keyframes star-breathe {
      0%, 100% { opacity: 0.82; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.06); }
    }
    @keyframes star-breathe-strong {
      0%, 100% { opacity: 0.85; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.14); }
    }
    @keyframes star-sparkle {
      0%, 100% { opacity: 0.9; }
      42% { opacity: 0.55; }
      58% { opacity: 0.95; }
    }
    @keyframes core-glint {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.86; }
    }
    @keyframes prism-shift {
      0%, 100% { transform: translate(0, 0); opacity: 0.5; }
      50% { transform: translate(0.6px, -0.4px); opacity: 0.32; }
    }
    @keyframes ring-bloom {
      0% { opacity: 0.9; transform: scale(0.5); }
      100% { opacity: 0; transform: scale(1.7); }
    }
    @keyframes flash-pulse {
      0% { opacity: 0; }
      18% { opacity: 0.6; }
      100% { opacity: 0; }
    }

    .nodes g.node .star-sky {
      pointer-events: none;
      transform-origin: center;
      transform-box: fill-box;
    }
    .nodes g.node .diff-ring { opacity: 0; }

    /* hover / 焦点 / 选中 / 边高亮：声呐环（单次）+ 白炽脉冲 + 星芒增亮 */
    .nodes g.node .hover-flash {
      opacity: 0;
      transform-origin: center;
      transform-box: fill-box;
    }
    .nodes g.node .hover-ring {
      opacity: 0;
      transform: scale(0.5);
      transform-origin: center;
      transform-box: fill-box;
    }
    .nodes g.node:hover .hover-ring,
    .nodes g.node.is-focused .hover-ring {
      animation: ring-bloom 0.8s var(--ease-out-quart);
    }
    .nodes g.node:hover .hover-flash,
    .nodes g.node.is-focused .hover-flash {
      animation: flash-pulse 0.4s var(--ease-out-quart);
    }
    .nodes g.node:hover .star-spikes,
    .nodes g.node.is-focused .star-spikes,
    .nodes g.node.is-selected .star-spikes,
    .nodes g.node.edge-hilite .star-spikes {
      filter: brightness(1.35);
    }
    .nodes g.node.is-selected .node-label {
      fill: var(--ink);
    }

    .nodes g.node .star-halo {
      animation: star-breathe 3.6s ease-in-out infinite;
      transform-origin: center;
      transform-box: fill-box;
    }
    .nodes g.node.st-running .star-halo {
      animation-name: star-breathe-strong;
    }
    .nodes g.node .star-spikes {
      animation: star-sparkle 5.2s ease-in-out infinite;
      transform-origin: center;
      transform-box: fill-box;
      transition: filter 0.14s var(--ease-out-quart);
    }
    .nodes g.node .star-core {
      animation: core-glint 2.8s ease-in-out infinite;
      transform-origin: center;
      transform-box: fill-box;
    }
    .nodes g.node .prism-r {
      animation: prism-shift 2.2s ease-in-out infinite;
      transform-box: fill-box;
    }
    .nodes g.node .prism-b {
      animation: prism-shift 2.2s ease-in-out -1.1s infinite;
      transform-box: fill-box;
    }

    @media (prefers-reduced-motion: reduce) {
      .nodes g.node .star-halo,
      .nodes g.node .star-spikes,
      .nodes g.node .star-core,
      .nodes g.node .prism-r,
      .nodes g.node .prism-b {
        animation: none;
      }
      .nodes g.node:hover .hover-ring,
      .nodes g.node.is-focused .hover-ring,
      .nodes g.node:hover .hover-flash,
      .nodes g.node.is-focused .hover-flash {
        animation: none;
      }
      .nodes g.node .star-spikes {
        transition: none;
      }
      .sky-dust .dust-tw {
        animation: none;
      }
    }
  }

  /* 簇色图例（叠加视图，工具轨右侧：轨是不透明 z=10，图例必须让位） */
  .ctx-legend {
    position: absolute;
    left: calc(var(--rail-w) + var(--sp-3));
    bottom: var(--sp-3);
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: color-mix(in srgb, var(--bg-chrome) 82%, transparent);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: var(--sp-2) var(--sp-3);
    max-width: 220px;
    pointer-events: none;
    z-index: 5;
  }

  .ctx-legend-item {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--text-2xs);
    color: var(--ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ctx-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* 对比模式徽章（画布顶部居中：模式可见，不再静默切换） */
  .diff-mode-chip {
    position: absolute;
    top: var(--sp-3);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    background: var(--surface-1);
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    padding: var(--sp-1) var(--sp-3);
    font-size: var(--text-2xs);
    color: var(--ink);
    z-index: 5;
  }

  .diff-mode-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px dashed var(--ink-muted);
  }

  .diff-mode-counts {
    font-family: var(--font-mono);
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }

  .diff-mode-exit {
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-sm);
    color: var(--ink-muted);
    font-size: var(--text-2xs);
    padding: 1px var(--sp-2);
    cursor: pointer;
    transition: color 0.13s var(--ease-out-quart), border-color 0.13s var(--ease-out-quart);
  }

  .diff-mode-exit:hover {
    color: var(--ink);
    border-color: var(--ink-faint);
  }

  /* 空态里的清除按钮 */
  .lens-empty-clear {
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-sm);
    color: var(--ink-muted);
    font-family: var(--font-sans);
    font-size: var(--text-2xs);
    padding: 2px var(--sp-2);
    cursor: pointer;
    transition: color 0.13s var(--ease-out-quart), border-color 0.13s var(--ease-out-quart);
  }

  .lens-empty-clear:hover {
    color: var(--ink);
    border-color: var(--ink-faint);
  }

  .lens-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
    font-family: var(--font-sans);
    letter-spacing: normal;
  }

  /* 空态容器 pointer-events:none 不穿透到恢复出口按钮 */
  .lens-empty-clear {
    pointer-events: auto;
  }

  .zoom-hint {
    position: absolute;
    bottom: var(--sp-2);
    left: 50%;
    transform: translateX(-50%);
    font-family: var(--font-sans);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    pointer-events: none;
    background: color-mix(in srgb, var(--bg-chrome) 85%, transparent);
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--r);
    border: 1px solid var(--line);
    z-index: 5;
    letter-spacing: 0.02em;
    transition: color 0.2s var(--ease-out-quart);
  }

  .canvas-wrapper:hover .zoom-hint {
    color: var(--ink-muted);
  }

  .hint-key {
    color: var(--ink-muted);
    font-weight: 500;
    font-family: var(--font-mono);
  }

  .hint-sep {
    margin: 0 var(--sp-1);
    color: var(--ink-faint);
  }

  /* 键盘焦点：SVG g 不支持 outline，视觉由 JS 焦点环承担；浏览器默认轮廓关闭 */
  .graph-canvas :global(g.node:focus) {
    outline: none;
  }

  @media (max-width: 768px) {
    .zoom-hint { display: none; }
    .ctx-legend {
      max-width: 150px;
      left: var(--sp-2);
      bottom: calc(52px + var(--sp-2));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .zoom-hint { transition: none; }
  }

  /* 微尘由 d3 生成 → 样式走 :global（keyframes 同） */
  :global {
    .sky-dust .dust {
      fill: rgba(255, 255, 255, 0.32);
    }
    .sky-dust .dust-tw {
      animation: dust-tw 4.5s ease-in-out infinite;
    }
    @keyframes dust-tw {
      0%, 100% { opacity: 0.14; }
      50% { opacity: 0.5; }
    }
  }
</style>
