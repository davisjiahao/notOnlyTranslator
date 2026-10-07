import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationApiService } from '@/background/translationApi';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserSettings } from '@/shared/types';

const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const chunk = (text: string) => event({ choices: [{ delta: { content: text } }] });
const streamResponse = (text: string) => new Response(text, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
const settings = (provider: UserSettings['apiProvider']): UserSettings => ({ ...DEFAULT_SETTINGS, apiProvider: provider });
const invoke = (provider: UserSettings['apiProvider'], options = {}, retry = { maxRetries: 0 }) =>
  TranslationApiService.callWithSystem('system', 'user', 'test-api-key', settings(provider), retry, options);

afterEach(() => { vi.unstubAllGlobals(); });

describe('TranslationApiService流式适配', () => {
  it.each(['openai', 'custom', 'ollama', 'alibaba'] as const)('%s仅有增量回调时请求流式', async (provider) => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(chunk('ok') + 'data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchMock);
    const onTextDelta = vi.fn();
    const onStreamStart = vi.fn();
    await expect(invoke(provider, { onTextDelta, onStreamStart })).resolves.toBe('ok');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveProperty('stream', true);
    expect(onStreamStart).toHaveBeenCalledOnce();
    expect(onTextDelta).toHaveBeenCalledExactlyOnceWith('ok');
  });

  it('未提供增量回调的原单段请求保持JSON行为', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'old' } }] })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(invoke('openai')).resolves.toBe('old');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('stream');
  });

  it('收到JSON响应时复用原解析且不补发请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'fallback' } }] }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onTextDelta = vi.fn();
    await expect(invoke('openai', { onTextDelta })).resolves.toBe('fallback');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onTextDelta).not.toHaveBeenCalled();
  });

  it('JSON回退保留output_limit分类', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }))));
    await expect(invoke('openai', { onTextDelta: vi.fn() })).rejects.toMatchObject({ kind: 'output_limit', retryable: false });
  });

  it.each([
    ['anthropic', { content: [{ text: 'partial' }], stop_reason: 'max_tokens' }, 'output_limit'],
    ['gemini', { candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'MAX_TOKENS' }] }, 'output_limit'],
    ['openai', { choices: [{ message: { content: 'partial' }, finish_reason: 'content_filter' }] }, 'unavailable'],
    ['openai', { choices: [{ message: { content: 'partial', refusal: 'private-refusal' } }] }, 'unavailable'],
    ['anthropic', { content: [{ text: 'partial' }], stop_reason: 'refusal' }, 'unavailable'],
    ['gemini', { candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'SAFETY' }] }, 'unavailable'],
    ['gemini', { candidates: [{ content: { parts: [{ text: 'partial' }] } }], promptFeedback: { blockReason: 'SAFETY' } }, 'unavailable'],
  ] as const)('%s JSON回退拒绝截断或被过滤内容', async (provider, data, kind) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onTextDelta = vi.fn();
    await expect(invoke(provider, { onTextDelta })).rejects.toMatchObject({ kind, retryable: false });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onTextDelta).not.toHaveBeenCalled();
  });

  it.each([
    ['openai', { choices: [{ message: { content: 'partial' } }] }],
    ['anthropic', { content: [{ text: 'partial' }] }],
    ['gemini', { candidates: [{ content: { parts: [{ text: 'partial' }] } }] }],
  ] as const)('%s JSON回退不能接受同时带error的内容', async (provider, content) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...content, error: { message: 'private-payload test-api-key' } }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const error = await invoke(provider, { onTextDelta: vi.fn() }).catch(error => error);
    expect(error).toMatchObject({ kind: 'unavailable' });
    expect(error.message).not.toMatch(/private-payload|test-api-key/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('Anthropic请求stream并按message_stop结束', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(event({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }) + event({ type: 'message_stop' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(invoke('anthropic', { onTextDelta: vi.fn() })).resolves.toBe('ok');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
  });

  it('Gemini切换streamGenerateContent并保留key与alt=sse', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(event({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(invoke('gemini', { onTextDelta: vi.fn() })).resolves.toBe('ok');
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toContain(':streamGenerateContent');
    expect(url.searchParams.get('alt')).toBe('sse');
    expect(url.searchParams.get('key')).toBe('test-api-key');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('stream');
  });

  it('重试前重置增量状态，不能把上一attempt内容拼入最终结果', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamResponse(chunk('failed')))
      .mockResolvedValueOnce(streamResponse(chunk('success') + 'data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchMock);
    let text = '';
    const onStreamStart = vi.fn(() => { text = ''; });
    const result = await invoke('openai', { onStreamStart, onTextDelta: (delta: string) => { text += delta; } }, { maxRetries: 1, initialDelay: 0 } as { maxRetries: number });
    expect(result).toBe('success');
    expect(text).toBe('success');
    expect(onStreamStart).toHaveBeenCalledTimes(2);
  });

  it('百度原生保留JSON路由，不宣称支持增量协议', async () => {
    Reflect.set(TranslationApiService, 'baiduTokenCache', null);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: '百度JSON' })));
    vi.stubGlobal('fetch', fetchMock);
    const onTextDelta = vi.fn();
    try {
      const result = await TranslationApiService.callWithSystem('system', 'user', 'test-api-key',
        { ...settings('baidu'), secondaryApiKey: 'test-secondary' }, { maxRetries: 0 }, { onTextDelta });
      expect(result).toBe('百度JSON');
      expect(fetchMock.mock.calls[1][0]).toContain('wenxinworkshop/chat/');
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('stream');
      expect(onTextDelta).not.toHaveBeenCalled();
    } finally {
      Reflect.set(TranslationApiService, 'baiduTokenCache', null);
    }
  });

  it('快速单词翻译即使携带回调也不切换流式', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '单词' } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const onTextDelta = vi.fn();
    await expect(TranslationApiService.quickTranslate('word', 'test-api-key', settings('openai'), { onTextDelta })).resolves.toBe('单词');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('stream');
    expect(onTextDelta).not.toHaveBeenCalled();
  });

  it('HTTP错误仍走原分类且不触发正文解析', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'test-api-key user-secret' } }), { status: 401 })));
    const onTextDelta = vi.fn();
    const error = await invoke('openai', { onTextDelta }).catch(error => error);
    expect(error).toMatchObject({ kind: 'unavailable', statusCode: 401, retryable: false });
    expect(error.message).not.toContain('user-secret');
    expect(error.detail).not.toContain('test-api-key');
    expect(onTextDelta).not.toHaveBeenCalled();
  });
});
