import { describe, it, expect } from "vitest";
import { parseAvoidNote } from "./glossary";

describe("parseAvoidNote（术语 Avoid: 尾注约定解析）", () => {
  it("无尾注 → 原文透传，avoid 为 null", () => {
    const r = parseAvoidNote("带明细行的购买单据，区别于账单");
    expect(r.text).toBe("带明细行的购买单据，区别于账单");
    expect(r.avoid).toBeNull();
  });

  it("尾部 Avoid: 尾注 → 正文与尾注分离（ctx-webui 约定样例形态）", () => {
    const r = parseAvoidNote("调度就绪的节点集合。Avoid: 别叫 待办池");
    expect(r.text).toBe("调度就绪的节点集合。");
    expect(r.avoid).toBe("别叫 待办池");
  });

  it("全角冒号 Avoid： 同样识别", () => {
    const r = parseAvoidNote("执行期上下文。Avoid：不要与租户混淆");
    expect(r.text).toBe("执行期上下文。");
    expect(r.avoid).toBe("不要与租户混淆");
  });

  it("小写 avoid: 亦容（约定键不挑大小写）", () => {
    const r = parseAvoidNote("前沿合并档。avoid: 不是新调度桶");
    expect(r.avoid).toBe("不是新调度桶");
  });

  it("标记前空白归入切分、正文尾随空白剥掉", () => {
    const r = parseAvoidNote("领域上下文。   Avoid:   别缩写 ctx   ");
    expect(r.text).toBe("领域上下文。");
    expect(r.avoid).toBe("别缩写 ctx");
  });

  it("整个字符串就是尾注（无正文）→ 按未约定处理，原样呈现不误伤", () => {
    const r = parseAvoidNote("Avoid: 别这么叫");
    expect(r.text).toBe("Avoid: 别这么叫");
    expect(r.avoid).toBeNull();
  });

  it("只有标记无内容 → 视为无尾注", () => {
    const r = parseAvoidNote("定义正文。Avoid: ");
    expect(r.avoid).toBeNull();
    expect(r.text).toBe("定义正文。");
  });

  it("空字符串 → 无尾注", () => {
    expect(parseAvoidNote("")).toEqual({ text: "", avoid: null });
  });
});
