import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBatchParagraphParser, readTranslationStream } from '@/background/translationStream';
import { executeTransportRequest } from '@/background/translationRequest';

const encoder = new TextEncoder();
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const delta = (text: string) => event({ choices: [{ delta: { content: text }, finish_reason: null }] });
const stop = event({ choices: [{ delta: {}, finish_reason: 'stop' }] });
const response = (text: string, chunkSize = 1) => {
  const bytes = encoder.encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
};
const read = (text: string, emit = vi.fn(), format: 'openai' | 'anthropic' | 'gemini' = 'openai') =>
  readTranslationStream(response(text), new AbortController().signal, format, emit);

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('批次段落增量解析', () => {
  it('对象闭合即输出，支持跨片转义、Unicode和字符串括号', () => {
    const emit = vi.fn();
    const parser = createBatchParagraphParser(emit);
    const paragraph = { id: 'PARA_0', text: '中文😀\\"{}[]', nested: [{ text: '}]' }] };
    const first = `{"paragraphs":[${JSON.stringify(paragraph)}`;
    for (const character of first.split('')) parser.push(character);
    expect(emit).toHaveBeenCalledExactlyOnceWith(paragraph);
    parser.push(',{"id":"PARA_1","text":"unfinished');
    expect(emit).toHaveBeenCalledTimes(1);
    parser.push('"}]}');
    expect(emit).toHaveBeenLastCalledWith({ id: 'PARA_1', text: 'unfinished' });
  });

  it.each([
    '{"nested":{"paragraphs":[{"id":"hidden"}]}}',
    '[{"paragraphs":[{"id":"hidden"}]}]',
    '{"text":"paragraphs","other":[{"id":"hidden"}]}',
    '```json\n{"paragraphs":[{"id":"hidden"}]}\n```',
    '{paragraphs:[{"id":"hidden"}]}',
    '{"paragraphs":[{"id":undefined}]}',
    '{"paragraphs":[{"id":"unfinished"',
  ])('不输出隐藏、非标准或不完整对象 %s', (text) => {
    const emit = vi.fn();
    expect(() => createBatchParagraphParser(emit).push(text)).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });

  it('仅输出数组直接对象成员而非嵌套对象或其他字段', () => {
    const emit = vi.fn();
    createBatchParagraphParser(emit).push('{"before":{"paragraphs":[]},"paragraphs":[null,1,"x",[{"id":"hidden"}],{"id":"ok"}],"after":{"id":"hidden"}}');
    expect(emit).toHaveBeenCalledExactlyOnceWith({ id: 'ok' });
  });

  it.each([
    '{"paragraphs" [{"id":"hidden"}]}',
    '{"paragraphs":[{"id":"hidden",}]}',
    '{"paragraphs":[{"id":"hidden" 2}]}',
    '{"paragraphs": [{"id":"hidden"}]}',
    '{"paragraphs":[{"id":"hidden"]}',
  ])('拒绝语法错误前缀 %s', (text) => {
    const emit = vi.fn();
    const parser = createBatchParagraphParser(emit);
    parser.push(text);
    parser.push('{"paragraphs":[{"id":"later"}]}');
    expect(emit).not.toHaveBeenCalled();
  });

  it('标准转义键名与跨片Unicode转义正常解析', () => {
    const emit = vi.fn();
    const parser = createBatchParagraphParser(emit);
    parser.push('{"para\\u0067raphs":[{"id":"\\u');
    parser.push('4e2d\\u6587"}]}');
    expect(emit).toHaveBeenCalledExactlyOnceWith({ id: '中文' });
  });

  it('一万条对象仍各自输出一次', () => {
    const emit = vi.fn();
    const values = Array.from({ length: 10_000 }, (_, id) => ({ id }));
    createBatchParagraphParser(emit).push(JSON.stringify({ paragraphs: values }));
    expect(emit).toHaveBeenCalledTimes(values.length);
    expect(emit).toHaveBeenLastCalledWith({ id: 9999 });
  });

  it('允许协议之外的宽松嵌套但拒绝超过64层的结构', () => {
    const emit = vi.fn();
    const nested = (depth: number) => `{"metadata":${'['.repeat(depth)}0${']'.repeat(depth)},"paragraphs":[{"id":"ok"}]}`;
    createBatchParagraphParser(emit).push(nested(63));
    expect(emit).toHaveBeenCalledExactlyOnceWith({ id: 'ok' });
    expect(() => createBatchParagraphParser(emit).push(nested(64)))
      .toThrow(expect.objectContaining({ kind: 'output_limit', retryable: false }));
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('解析buffer超过上限时停止，不能无限保留输入', () => {
    const parser = createBatchParagraphParser(vi.fn());
    expect(() => parser.push(' '.repeat(1_048_577))).toThrow(expect.objectContaining({ kind: 'output_limit' }));
  });

  it('空输入与空数组不输出', () => {
    const emit = vi.fn();
    const parser = createBatchParagraphParser(emit);
    parser.push('');
    parser.push('{"paragraphs":[]}');
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('SSE流读取', () => {
  it('跨UTF8字节、CRLF、多行data、注释与多个事件，忽略DONE后的垃圾', async () => {
    const emit = vi.fn();
    const text = ': heartbeat\r\n\r\nevent: message\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"中文😀"}}]}\r\n\r\n'
      + delta('tail') + stop + 'data: [DONE]\n\ndata: not-json\n\n';
    await expect(read(text, emit)).resolves.toBe('中文😀tail');
    expect(emit.mock.calls).toEqual([['中文😀'], ['tail']]);
  });

  it('OpenAI的stop终态允许没有DONE而正常EOF', async () => {
    await expect(read(delta('ok') + stop)).resolves.toBe('ok');
  });

  it('DONE也可作为兼容端点的正常终态', async () => {
    await expect(read(delta('ok') + 'data: [DONE]\n\n')).resolves.toBe('ok');
  });

  it.each([
    delta('partial'),
    'data: invalid\n\n',
    'data: null\n\n',
    'data: [DONE]\n\n',
    delta('   ') + stop,
    delta('partial') + 'data: {"choices":[]}',
  ])('截断或无效响应失败 %s', async (text) => {
    await expect(read(text)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it.each(['length', 'content_filter', 'tool_calls'])('非正常结束不返回最终成功 %s', async (reason) => {
    await expect(read(delta('partial') + event({ choices: [{ delta: {}, finish_reason: reason }] })))
      .rejects.toMatchObject({ kind: reason === 'length' ? 'output_limit' : 'unavailable', retryable: false });
  });

  it('拒绝与服务端错误不泄漏正文', async () => {
    for (const body of [{ error: { message: 'secret-user-content' } }, { choices: [{ delta: { refusal: 'secret-user-content' } }] }]) {
      const error = await read(event(body)).catch(error => error);
      expect(error.message).not.toContain('secret-user-content');
      expect(error.kind).toBe('unavailable');
    }
  });

  it('Anthropic只读取text_delta并等待message_stop', async () => {
    const emit = vi.fn();
    await expect(read(
      event({ type: 'message_start', message: {} })
      + event({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } })
      + event({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } })
      + event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })
      + event({ type: 'message_stop' }), emit, 'anthropic',
    )).resolves.toBe('ok');
    expect(emit).toHaveBeenCalledExactlyOnceWith('ok');
  });

  it.each(['max_tokens', 'refusal', 'tool_use'])('Anthropic异常终态 %s', async (reason) => {
    await expect(read(event({ type: 'message_delta', delta: { stop_reason: reason } }), vi.fn(), 'anthropic'))
      .rejects.toMatchObject({ kind: reason === 'max_tokens' ? 'output_limit' : 'unavailable', retryable: false });
  });

  it('Anthropic即使有stop_reason也不能省略message_stop', async () => {
    await expect(read(event({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } })
      + event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }), vi.fn(), 'anthropic'))
      .rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('Gemini合并文本part，忽略thought并检查STOP', async () => {
    const emit = vi.fn();
    await expect(read(event({ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: '甲' }, { text: '乙' }] }, finishReason: 'STOP' }] }), emit, 'gemini'))
      .resolves.toBe('甲乙');
    expect(emit.mock.calls).toEqual([['甲乙']]);
  });

  it.each(['MAX_TOKENS', 'SAFETY'])('Gemini异常终态 %s', async (reason) => {
    await expect(read(event({ candidates: [{ finishReason: reason }] }), vi.fn(), 'gemini'))
      .rejects.toMatchObject({ kind: reason === 'MAX_TOKENS' ? 'output_limit' : 'unavailable', retryable: false });
  });

  it('Gemini提示词拦截不作为空响应重试', async () => {
    await expect(read(event({ promptFeedback: { blockReason: 'SAFETY' } }), vi.fn(), 'gemini'))
      .rejects.toMatchObject({ kind: 'unavailable', retryable: false });
  });

  it('取消时释放reader并停止后续emit', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode(delta('first') + delta('second'))); }, cancel });
    const emit = vi.fn(() => controller.abort());
    await expect(readTranslationStream(new Response(body), controller.signal, 'openai', emit)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('挂起读取受transport超时约束并释放reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const promise = executeTransportRequest('https://example.test', {}, {
      timeoutMs: 20,
      readResponse: (res, signal) => readTranslationStream(res, signal, 'openai', vi.fn()),
      onSuccess: () => 'wrong',
    });
    const assertion = expect(promise).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('完成终态后同chunk的超长垃圾不再解析', async () => {
    const text = delta('ok') + 'data: [DONE]\n\n' + 'x'.repeat(1_048_577);
    await expect(readTranslationStream(response(text, text.length), new AbortController().signal, 'openai', vi.fn())).resolves.toBe('ok');
  });

  it.each([
    'data: ' + 'x'.repeat(1_048_577),
    'data: ' + 'x'.repeat(600_000) + '\ndata: ' + 'x'.repeat(600_000) + '\n\n',
    delta('x'.repeat(600_000)) + delta('x'.repeat(600_000)) + stop,
  ])('限制单行、单事件与总输出buffer', async (text) => {
    await expect(readTranslationStream(response(text, 65_536), new AbortController().signal, 'openai', vi.fn()))
      .rejects.toMatchObject({ kind: 'output_limit', retryable: false });
  });

  it('单事件data行数超过16384时停止，即使字节数很小', async () => {
    await expect(readTranslationStream(response('data:\n'.repeat(16_385) + '\n', 8192), new AbortController().signal, 'openai', vi.fn()))
      .rejects.toMatchObject({ kind: 'output_limit', retryable: false });
  });

  it('空data行的分隔符也计入事件buffer上限', async () => {
    vi.resetModules();
    vi.doMock('@/background/translationStreamParser', () => ({ MAX_STREAM_CHARS: 16, createBatchParagraphParser: vi.fn() }));
    try {
      const { readTranslationStream: readWithSmallLimit } = await import('@/background/translationStream');
      await expect(readWithSmallLimit(response('data:\n'.repeat(18) + '\n', 128), new AbortController().signal, 'openai', vi.fn()))
        .rejects.toMatchObject({ kind: 'output_limit' });
    } finally {
      vi.doUnmock('@/background/translationStreamParser');
      vi.resetModules();
    }
  });

  it('正文提前到达时先emit，Promise保持pending直到正常终态', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    let notifyFirst!: () => void;
    const first = new Promise<void>(resolve => { notifyFirst = resolve; });
    const body = new ReadableStream<Uint8Array>({ start(c) { streamController = c; } });
    const emit = vi.fn(() => notifyFirst());
    let settled = false;
    const promise = readTranslationStream(new Response(body), new AbortController().signal, 'openai', emit).then(value => { settled = true; return value; });
    streamController.enqueue(encoder.encode(delta('first')));
    await first;
    expect(settled).toBe(false);
    expect(emit).toHaveBeenCalledExactlyOnceWith('first');
    streamController.enqueue(encoder.encode(stop));
    await expect(promise).resolves.toBe('first');
    expect(body.locked).toBe(false);
  });

  it('读取失败仍释放锁，取消失败不产生未处理拒绝', async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error('network')); } });
    await expect(readTranslationStream(new Response(body), new AbortController().signal, 'openai', vi.fn())).rejects.toThrow();
    expect(body.locked).toBe(false);
    const cancel = vi.fn().mockRejectedValue(new Error('cancel failure'));
    const completed = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode(delta('ok') + stop)); }, cancel });
    await expect(readTranslationStream(new Response(completed), new AbortController().signal, 'openai', vi.fn())).resolves.toBe('ok');
    expect(completed.locked).toBe(false);
  });

  it('缺少body或预先取消时失败', async () => {
    await expect(readTranslationStream(new Response(null), new AbortController().signal, 'openai', vi.fn()))
      .rejects.toMatchObject({ kind: 'unavailable' });
    const controller = new AbortController();
    controller.abort();
    await expect(readTranslationStream(response(delta('late')), controller.signal, 'openai', vi.fn()))
      .rejects.toMatchObject({ kind: 'cancelled' });
  });
});
