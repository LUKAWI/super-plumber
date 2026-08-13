import { describe, it, expect } from "vitest";
import { computeFitTransform } from "./layout";

describe("computeFitTransform", () => {
  it("空节点 → null", () => {
    expect(computeFitTransform([], 800, 600)).toBeNull();
  });

  it("单节点居中且缩放受限", () => {
    const t = computeFitTransform([{ x: 100, y: 100 }], 800, 600, { nodeRadius: 20 });
    expect(t).not.toBeNull();
    expect(t!.scale).toBe(2); // 受 maxScale 限制
    expect(t!.tx).toBeGreaterThan(0);
    expect(t!.ty).toBeGreaterThan(0);
  });

  it("两节点适配视口（比例正确）", () => {
    const t = computeFitTransform(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 500 },
      ],
      800,
      600,
      { nodeRadius: 20, maxScale: 10 },
    );
    expect(t).not.toBeNull();
    // 缩放后两节点都应落在视口内
    const left = t!.tx + 0 * t!.scale;
    const right = t!.tx + 1000 * t!.scale;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(800);
  });

  it("NaN 坐标被过滤后不产生 NaN 变换", () => {
    const t = computeFitTransform(
      [
        { x: Number.NaN, y: 0 },
        { x: 0, y: 0 },
      ],
      800,
      600,
    );
    expect(t).not.toBeNull();
    expect(Number.isFinite(t!.scale)).toBe(true);
    expect(Number.isFinite(t!.tx)).toBe(true);
  });
});
