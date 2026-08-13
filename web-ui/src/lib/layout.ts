// 布局纯函数（可单测）：根据节点坐标计算"适应视图"的缩放/平移变换
export interface LayoutNode {
	x: number;
	y: number;
}

export interface FitTransform {
	scale: number;
	tx: number;
	ty: number;
}

export function computeFitTransform(
	nodes: LayoutNode[],
	width: number,
	height: number,
	opts: { padding?: number; nodeRadius?: number; maxScale?: number } = {},
): FitTransform | null {
	const padding = opts.padding ?? 40;
	const r = opts.nodeRadius ?? 20;
	const maxScale = opts.maxScale ?? 2;
	if (nodes.length === 0) return null;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const n of nodes) {
		// 防御非有限坐标（模拟在极端参数下可能产生 NaN）
		if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
		minX = Math.min(minX, n.x - r);
		minY = Math.min(minY, n.y - r);
		maxX = Math.max(maxX, n.x + r);
		maxY = Math.max(maxY, n.y + r);
	}
	if (minX === Infinity) return null;

	const graphWidth = Math.max(1, maxX - minX);
	const graphHeight = Math.max(1, maxY - minY);
	const scale = Math.min(
		(width - padding * 2) / graphWidth,
		(height - padding * 2) / graphHeight,
		maxScale,
	);
	const centerX = (minX + maxX) / 2;
	const centerY = (minY + maxY) / 2;
	return {
		scale,
		tx: width / 2 - centerX * scale,
		ty: height / 2 - centerY * scale,
	};
}
