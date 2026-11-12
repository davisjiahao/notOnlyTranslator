import { createTranslatableTextWalker } from './pageScanner';

/** 可译正文中的一次出现，坐标相对 getTranslatableText 的 UTF-16 闭开区间。 */
export interface TextOccurrence {
  start: number;
  end: number;
  text: string;
}

/** 一次出现切过的文本节点局部区间。 */
export interface CoveringSlice {
  node: Text;
  from: number;
  to: number;
}

const UNICODE_EDGE = /[\p{L}\p{N}_]/u;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 在拼接后的可译正文里找出全部不重叠出现。
 * unicode 边界与阅读高亮一致；ascii 边界保持 \\b，供既有高亮器使用。
 * 短语可按空白伸缩，从而跨过被拆开的行内节点。
 */
export function findWordOccurrences(
  source: string,
  needle: string,
  options?: { flexibleWhitespace?: boolean; boundary?: 'unicode' | 'ascii' },
): TextOccurrence[] {
  const token = needle.trim();
  if (!token) return [];
  const boundary = options?.boundary ?? 'unicode';
  const flexible = options?.flexibleWhitespace ?? token.includes(' ');
  if (boundary === 'ascii' || flexible) {
    const escaped = escapeRegex(token);
    const body = flexible ? escaped.replace(/\\ /g, '\\s+') : escaped;
    const regex = new RegExp(`\\b${body}\\b`, 'gi');
    const found: TextOccurrence[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      found.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
    }
    return found;
  }

  const haystack = source.toLowerCase();
  const pin = token.toLowerCase();
  const found: TextOccurrence[] = [];
  let from = 0;
  while (from <= haystack.length - pin.length) {
    const index = haystack.indexOf(pin, from);
    if (index < 0) break;
    const end = index + pin.length;
    const left = source[index - 1] ?? '';
    const right = source[end] ?? '';
    if (!UNICODE_EDGE.test(left) && !UNICODE_EDGE.test(right)) {
      found.push({ start: index, end, text: source.slice(index, end) });
    }
    from = end;
  }
  return found;
}

/** 把绝对区间映射回当前可译文本节点；区间为空时返回 null。 */
export function slicesCovering(root: Element, start: number, end: number): CoveringSlice[] | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
  const walker = createTranslatableTextWalker(root);
  const slices: CoveringSlice[] = [];
  let offset = 0;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const length = node.textContent?.length ?? 0;
    const nodeEnd = offset + length;
    if (length > 0 && offset < end && nodeEnd > start) {
      const from = Math.max(start, offset) - offset;
      const to = Math.min(end, nodeEnd) - offset;
      if (to > from) slices.push({ node, from, to });
    }
    offset = nodeEnd;
    if (offset >= end && slices.length > 0) break;
  }
  return slices.length > 0 ? slices : null;
}

export function slicesTouch(slices: readonly CoveringSlice[], selector: string): boolean {
  return slices.some(slice => Boolean(slice.node.parentElement?.closest(selector)));
}

/**
 * 按切片包裹。任一节点已脱离文档则整次放弃，避免只高亮半个词。
 * 调用方需先确认这些切片没有落入已有高亮。
 */
export function wrapCoveringSlices(
  slices: readonly CoveringSlice[],
  createMark: (sliceText: string, index: number, total: number) => HTMLElement,
): HTMLElement[] | null {
  if (slices.length === 0) return null;
  const prepared = slices.map(slice => {
    const text = slice.node.textContent || '';
    const parent = slice.node.parentNode;
    if (!parent || slice.from < 0 || slice.to > text.length || slice.from >= slice.to) return null;
    return { slice, text, parent };
  });
  if (prepared.some(item => item === null)) return null;
  const marks: HTMLElement[] = [];
  prepared.forEach((item, index) => {
    if (!item) return;
    const { slice, text, parent } = item;
    const fragment = document.createDocumentFragment();
    if (slice.from > 0) fragment.appendChild(document.createTextNode(text.slice(0, slice.from)));
    const mark = createMark(text.slice(slice.from, slice.to), index, slices.length);
    fragment.appendChild(mark);
    marks.push(mark);
    if (slice.to < text.length) fragment.appendChild(document.createTextNode(text.slice(slice.to)));
    parent.replaceChild(fragment, slice.node);
  });
  return marks;
}
