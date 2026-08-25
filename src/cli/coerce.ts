// src/cli/coerce.ts — CLI 数值参数统一防线（S1-1/S1-2/S3-17 + A4）
// CLI 与 MCP 双轨校验强弱不一致的根因是缺共享参数校验层（A4）；
// 本模块是 CLI 侧数值参数的唯一入口：非整数/越界 → 可读错误 + exit 1，
// 与 MCP zod（z.number().int().min(0)）同强度。core 写前校验（A2/f5）兜底之后，
// 这里的拦截让错误在最靠近用户的入口暴露，而非落盘后全图读崩。
export interface CoerceIntOpts {
  /** 缺省值（raw === undefined 时使用） */
  def?: number;
  /** 最小值（含） */
  min?: number;
  /** 最大值（含） */
  max?: number;
}

export function coerceInt(
  flag: string,
  raw: string | undefined,
  opts: CoerceIntOpts = {},
): number {
  let v: number;
  if (raw === undefined) {
    if (opts.def === undefined) {
      console.error(`❌ 缺少必填参数 ${flag}`);
      process.exit(1);
    }
    v = opts.def;
  } else {
    // 纯整数字符串校验：parseInt("12.5") 会静默截断成 12，必须显式拒绝
    if (!/^-?\d+$/.test(raw.trim())) {
      console.error(`❌ ${flag} 需为整数，收到: "${raw}"`);
      process.exit(1);
    }
    v = Number.parseInt(raw, 10);
  }
  if (opts.min !== undefined && v < opts.min) {
    console.error(`❌ ${flag} 不能小于 ${opts.min}，收到: ${v}`);
    process.exit(1);
  }
  if (opts.max !== undefined && v > opts.max) {
    console.error(`❌ ${flag} 不能大于 ${opts.max}，收到: ${v}`);
    process.exit(1);
  }
  return v;
}
