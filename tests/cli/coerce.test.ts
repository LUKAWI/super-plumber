// tests/cli/coerce.test.ts
// arch-c1（C1）：coerceInt 摘除 process.exit 变纯函数后的单测锁定。
// 此前错误路径 console.error + process.exit(1) 不可单测（杀进程）；现在抛
// CliUsageError 由 runner 统一渲染（消息与拆钩前逐字一致，e2e 零漂移）。
import { describe, it, expect } from "vitest";
import { coerceInt } from "../../src/cli/coerce.js";
import { CliUsageError } from "../../src/cli/runner.js";

describe("coerceInt 纯函数化（arch-c1）", () => {
  it("合法整数原样解析；缺省值生效", () => {
    expect(coerceInt("--level", "3")).toBe(3);
    expect(coerceInt("--level", " 7 ")).toBe(7); // 前后空白容忍（旧实现一致）
    expect(coerceInt("--level", undefined, { def: 1 })).toBe(1);
    expect(coerceInt("--last", "0", { def: 50, min: 0 })).toBe(0);
    // 未给 min 时不拦负数（旧实现一致）
    expect(coerceInt("--level", "-1")).toBe(-1);
  });

  it("缺必填参数（无 def）→ 抛 CliUsageError，消息含 flag", () => {
    expect(() => coerceInt("--id", undefined)).toThrowError(CliUsageError);
    expect(() => coerceInt("--id", undefined)).toThrow("缺少必填参数 --id");
  });

  it("非整数字符串 → 抛 CliUsageError（拒绝小数/字母/科学计数法/空串）", () => {
    for (const bad of ["abc", "2.5", "1e3", "", "0x10"]) {
      expect(() => coerceInt("--level", bad), `--level ${bad}`).toThrowError(
        CliUsageError,
      );
      expect(() => coerceInt("--level", bad)).toThrow(
        `--level 需为整数，收到: "${bad}"`,
      );
    }
  });

  it("越界 → 抛 CliUsageError，消息含边界值", () => {
    expect(() => coerceInt("--priority", "-5", { min: 0 })).toThrow(
      "--priority 不能小于 0，收到: -5",
    );
    expect(() => coerceInt("--port", "70000", { min: 1, max: 65535 })).toThrow(
      "--port 不能大于 65535，收到: 70000",
    );
  });

  it("纯函数契约：不触碰 process.exit（错误以异常表达）", () => {
    // 若实现仍调用 process.exit，vitest 进程会被杀掉而非抛错——本用例自然失败
    let caught: unknown;
    try {
      coerceInt("--level", "abc");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliUsageError);
  });
});
