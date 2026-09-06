import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("F11 MCP description token budget", () => {
  it("逐工具语义锚点完整且总量至少下降 20%", () => {
    const output = execFileSync(process.execPath, [path.resolve("scripts/mcp-description-budget.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const result = JSON.parse(output) as {
      tool_count: number;
      ratio: number;
      semantic_gaps: string[];
      rows: { name: string; tokens: number }[];
    };
    expect(result.tool_count).toBe(27);
    expect(result.ratio).toBeLessThanOrEqual(0.8);
    expect(result.semantic_gaps).toEqual([]);
    expect(result.rows).toHaveLength(27);
    expect(result.rows.every((row) => row.tokens > 0)).toBe(true);
  });
});
