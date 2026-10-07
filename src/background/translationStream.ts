import { TransportError } from '@/shared/utils/translationErrors';
import { MAX_STREAM_CHARS } from './translationStreamParser';

export { createBatchParagraphParser } from './translationStreamParser';
export type TranslationStreamFormat = 'openai' | 'anthropic' | 'gemini';

interface StreamEvent {
  type?: string;
  error?: unknown;
  choices?: Array<{ delta?: { content?: unknown; refusal?: unknown }; message?: { refusal?: unknown }; finish_reason?: string | null }>;
  stop_reason?: string | null;
  delta?: { type?: string; text?: unknown; stop_reason?: string | null };
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: unknown };
}

const invalidStream = () => TransportError.unavailable('翻译流响应无效或意外中断');
const refusedStream = () => new TransportError('unavailable', '翻译服务未返回可用内容', { retryable: false });

function checkFinishReason(reason: string | null | undefined, accepted: string[]): void {
  if (!reason) return;
  if (['length', 'max_tokens', 'MAX_TOKENS'].includes(reason)) throw TransportError.outputLimit();
  if (!accepted.includes(reason)) throw refusedStream();
}

function validateCompletion(data: StreamEvent, format: TranslationStreamFormat, streaming: boolean): void {
  if (data.error || data.type === 'error') throw invalidStream();
  if (format === 'anthropic') {
    checkFinishReason(streaming ? data.delta?.stop_reason : data.stop_reason, ['end_turn', 'stop_sequence']);
  } else if (format === 'gemini') {
    if (data.promptFeedback?.blockReason) throw refusedStream();
    const candidate = Array.isArray(data.candidates) ? data.candidates[0] : undefined;
    checkFinishReason(candidate?.finishReason, ['STOP']);
  } else {
    const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
    if (streaming ? choice?.delta?.refusal : choice?.message?.refusal) throw refusedStream();
    checkFinishReason(choice?.finish_reason, ['stop']);
  }
}

export function validateJsonTranslationCompletion(data: unknown, format: TranslationStreamFormat): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalidStream();
  validateCompletion(data, format, false);
}

function extractEvent(data: StreamEvent, format: TranslationStreamFormat): { text: string; done: boolean } {
  validateCompletion(data, format, true);
  if (format === 'anthropic') {
    return {
      text: data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && typeof data.delta.text === 'string' ? data.delta.text : '',
      done: data.type === 'message_stop',
    };
  }
  if (format === 'gemini') {
    const candidate = Array.isArray(data.candidates) ? data.candidates[0] : undefined;
    const parts = candidate?.content?.parts;
    return {
      text: Array.isArray(parts) ? parts.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('') : '',
      done: candidate?.finishReason === 'STOP',
    };
  }
  const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
  return { text: typeof choice?.delta?.content === 'string' ? choice.delta.content : '', done: choice?.finish_reason === 'stop' };
}

function createEventDecoder(onData: (data: string) => void, isDone: () => boolean): { push(text: string): void } {
  let line = '';
  let data: string | undefined;
  let dataLines = 0;
  const maxDataLines = 16_384;
  let previousCR = false;
  const consumeLine = () => {
    if (!line) {
      if (data !== undefined) onData(data);
      data = undefined;
      dataLines = 0;
    } else if (line.startsWith('data:') || line === 'data') {
      if (++dataLines > maxDataLines) throw TransportError.outputLimit();
      const value = line === 'data' ? '' : line.slice(5).replace(/^ /, '');
      data = data === undefined ? value : `${data}\n${value}`;
      if (data.length > MAX_STREAM_CHARS) throw TransportError.outputLimit();
    }
    line = '';
  };
  return {
    push(text) {
      for (const character of text) {
        if (isDone()) return;
        if (character === '\n' && previousCR) { previousCR = false; continue; }
        previousCR = character === '\r';
        if (character === '\r' || character === '\n') consumeLine();
        else line += character;
        if (line.length > MAX_STREAM_CHARS) throw TransportError.outputLimit();
      }
    },
  };
}

export async function readTranslationStream(
  response: Response,
  signal: AbortSignal,
  format: TranslationStreamFormat,
  onTextDelta: (delta: string) => void,
): Promise<string> {
  if (signal.aborted) throw TransportError.cancelled();
  if (!response.body) throw invalidStream();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let output = '';
  let done = false;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    void reader.cancel().catch(() => undefined);
  };
  const assertActive = () => { if (signal.aborted) throw TransportError.cancelled(); };
  const events = createEventDecoder((raw) => {
    assertActive();
    if (done) return;
    if (raw.trim() === '[DONE]' && format === 'openai') { done = true; return; }
    let data: StreamEvent;
    try { data = JSON.parse(raw); } catch { throw invalidStream(); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalidStream();
    const event = extractEvent(data, format);
    if (output.length + event.text.length > MAX_STREAM_CHARS) throw TransportError.outputLimit();
    if (event.text) {
      output += event.text;
      onTextDelta(event.text);
      assertActive();
    }
    done = event.done;
  }, () => done);
  let rejectAbort: (error: TransportError) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => { cancel(); rejectAbort(TransportError.cancelled()); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    assertActive();
    while (!done) {
      const chunk = await Promise.race([reader.read(), aborted]);
      assertActive();
      if (chunk.done) { events.push(decoder.decode()); break; }
      events.push(decoder.decode(chunk.value, { stream: true }));
    }
    if (!done || !output.trim()) throw invalidStream();
    return output;
  } finally {
    signal.removeEventListener('abort', onAbort);
    cancel();
    reader.releaseLock();
  }
}
