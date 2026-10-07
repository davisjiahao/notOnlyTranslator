import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationApiService } from '@/background/translationApi';
import { logger } from '@/shared/utils';
import { TransportError } from '@/shared/utils/translationErrors';
import type { UserSettings } from '@/shared/types';

const settings = (apiProvider: UserSettings['apiProvider']): UserSettings => ({ apiProvider } as UserSettings);
const noRetry = { maxRetries: 0, initialDelay: 0, backoffMultiplier: 1, maxDelay: 0 };
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data } as Response);
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  Reflect.set(TranslationApiService, 'baiduTokenCache', null);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('真实请求构造和失败处理（只模拟 fetch，不调用付费网络）', () => {
  it.each([
    ['openai', { choices: [{ message: { content: '译文' } }] }, 'Bearer fake-key'],
    ['anthropic', { content: [{ text: '译文' }] }, undefined],
    ['gemini', { candidates: [{ content: { parts: [{ text: '译文' }] } }] }, undefined],
    ['alibaba', { choices: [{ message: { content: '译文' } }] }, 'Bearer fake-key'],
    ['ollama', { choices: [{ message: { content: '译文' } }] }, 'Bearer ollama'],
  ] as const)('%s 调用真实传输路径并提取结果', async (provider, data, authorization) => {
    fetchMock.mockResolvedValue(response(data));
    const result = await TranslationApiService.callWithSystem('system', 'user', 'fake-key', settings(provider), noRetry);
    expect(result).toBe('译文');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(provider === 'ollama' ? 'localhost:11434' : 'http');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe(authorization);
  });

  it.each([
    ['deepl', { translations: [{ text: '深度译文' }] }, '深度译文'],
    ['google_translate', { data: { translations: [{ translatedText: '谷歌译文' }] } }, '谷歌译文'],
    ['youdao', { translation: ['有道译文'] }, '有道译文'],
  ] as const)('%s 非 LLM 请求使用对应响应格式', async (provider, data, expected) => {
    fetchMock.mockResolvedValue(response(data));
    expect(await TranslationApiService.callWithSystem('system', 'word', provider === 'youdao' ? 'app:secret' : 'fake-key', settings(provider), noRetry)).toBe(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('免费 Google 多段响应完整拼接，快速翻译同样完整', async () => {
    fetchMock.mockResolvedValue(response([[['你好', 'hello'], ['，世界', ', world']], null, 'en']));
    expect(await TranslationApiService.callWithSystem('system', 'hello world', '', settings('free_google_translate'), noRetry)).toBe('你好，世界');
    expect(await TranslationApiService.quickTranslate('hello world', '', settings('free_google_translate'))).toBe('你好，世界');
    expect(fetchMock.mock.calls[0][0]).toContain('q=hello+world');
  });

  it('错误响应不向公共消息和重试日志回显密钥或用户正文', async () => {
    const secret = 'SYNTH-SECRET-123456';
    const text = 'SYNTH-PRIVATE-USER-TEXT';
    const log = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(response({ error: { message: `${secret} ${text}` } }, 401));
    await expect(TranslationApiService.callWithSystem('system', text, secret, settings('openai'), noRetry))
      .rejects.toMatchObject({ kind: 'unavailable', statusCode: 401, message: 'API Key 无效或未授权' });
    expect(log.mock.calls.flat().join(' ')).not.toMatch(/SYNTH-SECRET|SYNTH-PRIVATE/);
  });

  it.each([{}, { choices: [] }, { choices: [{ message: { content: '' } }] }])('LLM 非法或空响应拒绝成功结果', async data => {
    fetchMock.mockResolvedValue(response(data));
    await expect(TranslationApiService.callWithSystem('system', 'text', 'fake-key', settings('openai'), noRetry))
      .rejects.toMatchObject({ kind: 'unavailable' });
  });

  it.each([
    ['null', null],
    ['数组', []],
    ['非空截断字符串', '{"paragraphs":'],
  ] as const)('输出耗尽（%s）尊重显式预算并拒绝原样重试', async (_name, content) => {
    const onRetry = vi.fn();
    fetchMock.mockResolvedValue(response({ choices: [{ finish_reason: 'length', message: { content } }] }));
    const customSettings = {
      ...settings('custom'),
      customApiUrl: 'https://translator.test/v1/chat/completions',
      customModelName: 'synthetic-model',
    };

    const error = await TranslationApiService.callWithSystem(
      'system', 'text', 'fake-key', customSettings,
      { ...noRetry, maxRetries: 3, onRetry }, { maxTokens: 2000 }
    ).catch((error: unknown) => error);

    expect.soft(error).toBeInstanceOf(TransportError);
    expect.soft(error).toMatchObject({ kind: 'output_limit', retryable: false });
    expect.soft(error).toHaveProperty('message', TransportError.outputLimit().message);
    expect.soft(fetchMock).toHaveBeenCalledTimes(1);
    expect.soft(onRetry).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).max_tokens).toBe(2000);
  });

  it.each([
    ['数组', []],
    ['对象', { text: '译文' }],
  ] as const)('非字符串 content（%s）不能作为成功译文返回', async (_name, content) => {
    fetchMock.mockResolvedValue(response({ choices: [{ finish_reason: 'stop', message: { content } }] }));

    await expect(TranslationApiService.callWithSystem('system', 'text', 'fake-key', settings('openai'), noRetry))
      .rejects.toBeInstanceOf(Error);
  });

  it('finish_reason 为 stop 且 content 为正常字符串时仍成功返回译文', async () => {
    fetchMock.mockResolvedValue(response({ choices: [{ finish_reason: 'stop', message: { content: '完整译文' } }] }));

    await expect(TranslationApiService.callWithSystem('system', 'text', 'fake-key', settings('openai'), noRetry))
      .resolves.toBe('完整译文');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('输出耗尽时省略 retryOptions 的默认重试配置也只请求一次', async () => {
    fetchMock.mockResolvedValue(response({ choices: [{ finish_reason: 'length', message: { content: null } }] }));

    await expect(TranslationApiService.callWithSystem('system', 'text', 'fake-key', settings('openai')))
      .rejects.toMatchObject({ kind: 'output_limit', retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('快译认证失败降级为空串，已取消的请求不发往网络', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { message: 'unauthorized' } }, 401));
    expect(await TranslationApiService.quickTranslate('word', 'fake-key', settings('openai'))).toBe('');
    const controller = new AbortController();
    controller.abort();
    await expect(TranslationApiService.quickTranslate('word', 'fake-key', settings('openai'), { signal: controller.signal }))
      .rejects.toMatchObject({ kind: 'cancelled' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('百度先取令牌、再请求翻译；缓存命中不重复取令牌', async () => {
    fetchMock.mockResolvedValueOnce(response({ access_token: 'synthetic-token', expires_in: 3600 }))
      .mockResolvedValue(response({ result: '译文' }));
    const baidu = { ...settings('baidu'), secondaryApiKey: 'fake-secret' };
    expect(await TranslationApiService.callWithSystem('system', 'word', 'fake-key', baidu, noRetry)).toBe('译文');
    expect(await TranslationApiService.callWithSystem('system', 'word', 'fake-key', baidu, noRetry)).toBe('译文');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/oauth/2.0/token');
    expect(String(fetchMock.mock.calls[1][0])).toContain('access_token=synthetic-token');
  });

  it.each([
    ['deepl', { translations: [{ text: '深度词义' }] }, '深度词义'],
    ['google_translate', { data: { translations: [{ translatedText: '谷歌词义' }] } }, '谷歌词义'],
    ['youdao', { translation: ['有道词义'], errorCode: '0' }, '有道词义'],
  ] as const)('%s 快译走真实请求路径', async (provider, data, expected) => {
    fetchMock.mockResolvedValue(response(data));
    expect(await TranslationApiService.quickTranslate('word', provider === 'youdao' ? 'app:secret' : 'fake-key', settings(provider))).toBe(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('百度快译获取令牌并提取译文', async () => {
    fetchMock.mockResolvedValueOnce(response({ access_token: 'synthetic-token', expires_in: 3600 }))
      .mockResolvedValue(response({ result: '百度词义' }));
    expect(await TranslationApiService.quickTranslate('word', 'fake-key', { ...settings('baidu'), secondaryApiKey: 'fake-secret' })).toBe('百度词义');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('带系统提示的快译构造请求，不发送 JSON 强制模式', async () => {
    fetchMock.mockResolvedValue(response({ choices: [{ message: { content: '译文' } }] }));
    expect(await TranslationApiService.quickTranslateWithSystem('system', 'user', 'fake-key', settings('openai'))).toBe('译文');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({ messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }] });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).not.toHaveProperty('response_format');
  });

  it('百度缺少二级密钥及有道密钥格式错误时拒绝请求', async () => {
    await expect(TranslationApiService.callWithSystem('system', 'text', 'fake-key', settings('baidu'), noRetry)).rejects.toThrow('Secret Key');
    await expect(TranslationApiService.callWithSystem('system', 'text', 'invalid', settings('youdao'), noRetry)).rejects.toThrow('appKey:appSecret');
    await expect(TranslationApiService.quickTranslate('text', 'invalid', settings('youdao'))).rejects.toThrow('appKey:appSecret');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('有道快译业务错误不重试并降级为空串', async () => {
    fetchMock.mockResolvedValue(response({ errorCode: '101', translation: [] }));
    expect(await TranslationApiService.quickTranslate('word', 'app:secret', settings('youdao'))).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('百度令牌在调用开始前已取消时不发出网络请求', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(TranslationApiService.callWithSystem('system', 'text', 'fake-key', { ...settings('baidu'), secondaryApiKey: 'fake-secret' }, noRetry, { signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['deepl', { translations: [] }],
    ['google_translate', { data: { translations: [] } }],
    ['youdao', { translation: [] }],
  ] as const)('%s 返回空列表时不将结果视为成功', async (provider, body) => {
    fetchMock.mockResolvedValue(response(body));
    await expect(TranslationApiService.callWithSystem('system', 'word', provider === 'youdao' ? 'app:secret' : 'fake-key', settings(provider), noRetry))
      .rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('有道业务错误码无法掩盖无效响应', async () => {
    fetchMock.mockResolvedValue(response({ errorCode: '101' }));
    await expect(TranslationApiService.callWithSystem('system', 'word', 'app:secret', settings('youdao'), noRetry))
      .rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('免费 Google 返回无效或空响应时拒绝成功结果，快译返回空串', async () => {
    fetchMock.mockResolvedValue(response({ unexpected: 'response' }));
    await expect(TranslationApiService.callWithSystem('system', 'word', '', settings('free_google_translate'), noRetry))
      .rejects.toMatchObject({ kind: 'unavailable' });
    expect(await TranslationApiService.quickTranslate('word', '', settings('free_google_translate'))).toBe('');
    fetchMock.mockResolvedValue(response([[], null, 'en']));
    await expect(TranslationApiService.callWithSystem('system', 'word', '', settings('free_google_translate'), noRetry))
      .rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('自定义响应格式及 token 预算传入真实 OpenAI 请求体', async () => {
    fetchMock.mockResolvedValue(response({ choices: [{ message: { content: '结果' } }] }));
    const responseFormat = { type: 'json_schema' as const, json_schema: { name: 'result', schema: { type: 'object' } } };
    expect(await TranslationApiService.call('text', 'fake-key', settings('openai'), noRetry, { responseFormat, maxTokens: 150 })).toBe('结果');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({ max_tokens: 150, response_format: responseFormat });
  });

  it('DeepL HTTP 错误保留固定的公共消息，不暴露用户原文', async () => {
    const privateText = 'SYNTH-PRIVATE-USER-TEXT';
    fetchMock.mockResolvedValue(response({ message: privateText }, 403));
    await expect(TranslationApiService.callWithSystem('system', privateText, 'fake-key', settings('deepl'), noRetry))
      .rejects.toMatchObject({ message: 'API Key 无效或未授权', statusCode: 403 });
  });
});
