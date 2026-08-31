// web-ui/src/lib/glossary.ts — 术语 definition 尾部 `Avoid:` 约定的解析（0.8.1 P1-9）。
// 按约定解析字符串即可：定义正文之后若带 `Avoid: …` 尾注（全半角冒号皆容），
// UI 将该段识别出来分区高亮呈现；不依赖 schema 新字段。
// 术语锚点：ctx-webui 术语表「Avoid 呈现」——先按约定解析、schema 字段后置。

export interface ParsedAvoidNote {
  /** Avoid 尾注之前的定义正文（无尾注时即原文） */
  text: string;
  /** Avoid 尾注内容；无尾注时 null */
  avoid: string | null;
}

/**
 * 解析术语 definition 中的 `Avoid:` 尾注。
 * - 无尾注 → { text: 原文, avoid: null }
 * - 有尾注 → 正文去尾随空白/句读保留原样，avoid 段剥掉标记与前导空白
 * 只在「定义正文之后」的段生效：`Avoid:` 首次出现即切分（尾注按约定在尾部）；
 * 正文中间恰含 "Avoid:" 字样时同样会被切出——按约定写作不该如此，此处不猜测语境。
 */
export function parseAvoidNote(definition: string): ParsedAvoidNote {
  const marker = /\s*[aA]void\s*[:：]\s*/.exec(definition);
  if (!marker || marker.index === 0) {
    // 无尾注；或整个字符串就是尾注（无正文，视为未按约定，原样呈现不误伤）
    return { text: definition, avoid: null };
  }
  const text = definition.slice(0, marker.index).replace(/\s+$/, "");
  const avoid = definition.slice(marker.index + marker[0].length).replace(/\s+$/, "");
  if (avoid === "") {
    return { text, avoid: null };
  }
  return { text, avoid };
}
