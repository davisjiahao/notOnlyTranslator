import { TransportError } from '@/shared/utils/translationErrors';

// 字符数上限约束失控服务的内存占用，不替代模型的 token 预算。
export const MAX_STREAM_CHARS = 1_048_576;
// 批次结构远浅于此上限，防止恶意嵌套使不可变栈复制退化。
const MAX_JSON_DEPTH = 64;

type Expectation = 'keyOrEnd' | 'key' | 'colon' | 'valueOrEnd' | 'value' | 'commaOrEnd';
interface Frame {
  kind: '{' | '[';
  expect: Expectation;
  key?: string;
  paragraphs: boolean;
  paragraphStart?: number;
}

export function createBatchParagraphParser(onParagraph: (value: unknown) => void): { push(delta: string): void } {
  let buffer = '';
  let stack: Frame[] = [];
  let tokenStart = -1;
  let inString = false;
  let escaped = false;
  let invalid = false;
  let started = false;

  const updateTop = (changes: Partial<Frame>) => {
    stack = [...stack.slice(0, -1), { ...stack[stack.length - 1], ...changes }];
  };
  const fail = () => { invalid = true; };
  const acceptsValue = () => ['value', 'valueOrEnd'].includes(stack[stack.length - 1]?.expect);

  const scalar = (raw: string) => {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { fail(); return; }
    const top = stack[stack.length - 1];
    if (top?.kind === '{' && ['key', 'keyOrEnd'].includes(top.expect) && typeof value === 'string') {
      updateTop({ key: value, expect: 'colon' });
    } else if (acceptsValue()) {
      updateTop({ expect: 'commaOrEnd' });
    } else {
      fail();
    }
  };

  const open = (kind: '{' | '[', position: number) => {
    const parent = stack[stack.length - 1];
    if ((!parent && (started || kind !== '{')) || (parent && !acceptsValue())) { fail(); return; }
    if (stack.length >= MAX_JSON_DEPTH) throw TransportError.outputLimit();
    const paragraphs = kind === '[' && stack.length === 1 && parent?.key === 'paragraphs';
    const paragraphStart = kind === '{' && parent?.paragraphs ? position : undefined;
    if (parent) updateTop({ expect: 'commaOrEnd' });
    stack = [...stack, { kind, paragraphs, paragraphStart, expect: kind === '{' ? 'keyOrEnd' : 'valueOrEnd' }];
    started = true;
  };

  const close = (character: string, position: number) => {
    const top = stack[stack.length - 1];
    const expectedKind = character === '}' ? '{' : '[';
    if (!top || top.kind !== expectedKind || !['keyOrEnd', 'valueOrEnd', 'commaOrEnd'].includes(top.expect)) { fail(); return; }
    stack = stack.slice(0, -1);
    if (top.paragraphStart !== undefined) {
      let paragraph: unknown;
      try { paragraph = JSON.parse(buffer.slice(top.paragraphStart, position + 1)); } catch { fail(); return; }
      onParagraph(paragraph);
    }
  };

  const punctuation = (character: string, position: number) => {
    if (character === '{' || character === '[') { open(character, position); return; }
    if (character === '}' || character === ']') { close(character, position); return; }
    const top = stack[stack.length - 1];
    if (character === ':' && top?.expect === 'colon') updateTop({ expect: 'value' });
    else if (character === ',' && top?.expect === 'commaOrEnd') updateTop({ expect: top.kind === '{' ? 'key' : 'value' });
    else fail();
  };

  const consume = (character: string, position: number) => {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') {
        inString = false;
        scalar(buffer.slice(tokenStart, position + 1));
        tokenStart = -1;
      }
      return;
    }
    const separator = /[ \t\r\n{}[\],:]/.test(character);
    if (tokenStart >= 0 && separator) {
      scalar(buffer.slice(tokenStart, position));
      tokenStart = -1;
      if (invalid) return;
    }
    if (/[ \t\r\n]/.test(character)) return;
    if (character === '"' && tokenStart < 0) { tokenStart = position; inString = true; return; }
    if (separator) punctuation(character, position);
    else if (tokenStart < 0) tokenStart = position;
  };

  return {
    push(delta) {
      if (invalid) return;
      if (buffer.length + delta.length > MAX_STREAM_CHARS) throw TransportError.outputLimit();
      const offset = buffer.length;
      buffer += delta;
      for (let i = 0; i < delta.length && !invalid; i++) consume(delta[i], offset + i);
    },
  };
}
