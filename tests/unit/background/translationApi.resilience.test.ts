/**
 * TranslationApiService 传输健壮性测试
 *
 * 覆盖：options（signal/timeoutMs/responseFormat/maxTokens）透传到底层 fetch、
 * 取消/超时不盲重试、Ollama 兼容参数（reasoning_effort / response_format）、
 * max_tokens 有界化、错误脱敏与分类、Ollama 推荐模型列表。
 * 仅使用 mock fetch，不请求任何远程 API。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranslationApiService, type TranslationApiRequestOptions } from '@/background/translationApi';
import { TRANSPORT_DEFAULTS } from '@/background/translationRequest';
import { classifyTranslationError, TranslationErrorType } from '@/shared/utils/translationErrors';
import { PROVIDER_CONFIGS } from '@/shared/constants/providers';
import { logger } from '@/shared/utils';
import type { UserSettings } from '@/shared/types';

function createSettings(provider: UserSettings['apiProvider']): UserSettings {
  return {
    enabled: true,
    autoHighlight: true,
    vocabHighlightEnabled: false,
    phraseTranslationEnabled: false,
    grammarTranslationEnabled: false,
    translationMode: 'inline-only',
    showDifficulty: false,
    highlightColor: '#ffffff',
    fontSize: 14,
    apiProvider: provider,
    blacklist: [],
    apiConfigs: [],
    hoverDelay: 0,
    theme: 'system',
  };
}

function openaiOkResponse() {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '译文' } }] }) };
}

describe('TranslationApiService — 传输健壮性', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let loggerInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('旧签名（无 options）保持兼容，成功返回译文', async () => {
    fetchMock.mockResolvedValue(openaiOkResponse());

    const result = await TranslationApiService.callWithSystem('sys', 'user', 'sk-key', createSettings('openai'));

    expect(result).toBe('译文');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('配置日志不输出可能含凭据的自定义 URL', async () => {
    const sentinel = 'SYNTHETIC-URL-KEY';
    fetchMock.mockResolvedValue(openaiOkResponse());
    const settings = {
      ...createSettings('openai'),
      customApiUrl: `https://x.test/?key=${sentinel}`,
    };

    await TranslationApiService.callWithSystem('sys', 'user', 'sk-key', settings);

    expect(JSON.stringify(loggerInfoSpy.mock.calls)).not.toContain(sentinel);
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('TranslationApiService: 调用'),
      expect.objectContaining({ hasCustomApiUrl: true })
    );
  });

  it('options.signal 中途取消：只请求一次，抛 cancelled 错误', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const controller = new AbortController();
    const promise = TranslationApiService.callWithSystem(
      'sys', 'user', 'sk-key', createSettings('openai'),
      undefined,
      { signal: controller.signal }
    );
    setTimeout(() => controller.abort(), 10);

    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('options.timeoutMs 控制超时并中止请求，且不盲重试', async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });

    const promise = TranslationApiService.callWithSystem(
      'sys', 'user', 'sk-key', createSettings('openai'),
      undefined,
      { timeoutMs: 30 }
    );

    await expect(promise).rejects.toMatchObject({ kind: 'timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 5000);

  it('百度 OAuth 令牌请求使用同一超时预算', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const settings = {
      ...createSettings('baidu'),
      secondaryApiKey: 'baidu-secret',
    };

    await expect(TranslationApiService.callWithSystem(
      'sys', 'user', 'baidu-key', settings, undefined, { timeoutMs: 30 }
    )).rejects.toMatchObject({ kind: 'timeout' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/oauth/2.0/token');
  }, 5000);

  it('重试等待期间取消：立即返回 cancelled，不发起下一次请求', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const controller = new AbortController();
    const promise = TranslationApiService.callWithSystem(
      'sys', 'user', 'sk-key', createSettings('openai'),
      { maxRetries: 3, initialDelay: 60_000, maxDelay: 60_000 },
      { signal: controller.signal }
    );
    setTimeout(() => controller.abort(), 20);

    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('options.maxTokens 透传到请求体（有界）', async () => {
    fetchMock.mockResolvedValue(openaiOkResponse());

    await TranslationApiService.callWithSystem(
      'sys', 'user', 'sk-key', createSettings('openai'),
      undefined,
      { maxTokens: 3000 }
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(3000);
  });

  it('ollama：reasoning_effort=none + json_object，走 /v1/chat/completions', async () => {
    fetchMock.mockResolvedValue(openaiOkResponse());

    await TranslationApiService.callWithSystem('sys', 'user', 'ollama', createSettings('ollama'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/chat/completions');
    const body = JSON.parse(init.body);
    // 兼容接口参数：关闭 Qwen3 思考阶段；非思考模型会忽略
    expect(body.reasoning_effort).toBe('none');
    expect(body.response_format).toEqual({ type: 'json_object' });
    // 不允许出现原生接口参数（think/format/keep_alive 属于 /api/chat，不能塞进兼容端点）
    expect(body).not.toHaveProperty('think');
    expect(body).not.toHaveProperty('keep_alive');
    // Ollama 冷加载（模型未驻留时）默认超时放宽到 90s；驻留默认约 5 分钟，并非每次冷加载
    expect(TRANSPORT_DEFAULTS.localLlmTimeoutMs).toBe(90_000);
  });

  it('ollama 纯文本请求 max_tokens 有界默认值（不再固定 100）', async () => {
    fetchMock.mockResolvedValue(openaiOkResponse());

    await TranslationApiService.quickTranslate('hello world', 'ollama', createSettings('ollama'));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(TRANSPORT_DEFAULTS.defaultTextMaxTokens);
    expect(body.max_tokens).not.toBe(100);
    expect(body.reasoning_effort).toBe('none');
    expect(body.response_format).toBeUndefined();
  });

  it('ollama options.maxTokens=2048 生效', async () => {
    fetchMock.mockResolvedValue(openaiOkResponse());

    await TranslationApiService.quickTranslate('hello world', 'ollama', createSettings('ollama'), { maxTokens: 2048 });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(2048);
  });

  it('ollama JSON 请求也携带有界 max_tokens', async () => {
    fetchMock.mockResolvedValue(openaiOkResponse());

    await TranslationApiService.callWithSystem(
      'sys', 'user', 'ollama', createSettings('ollama'), undefined, { maxTokens: 3000 }
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(3000);
  });

  it('Anthropic 请求使用 options.maxTokens', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: '译文' }] }),
    });

    await TranslationApiService.callWithSystem(
      'sys', 'user', 'key', createSettings('anthropic'), undefined, { maxTokens: 3000 }
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(3000);
  });

  it('快速翻译在取消后重新抛出 cancelled，而非降级为空字符串', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const promise = TranslationApiService.quickTranslate(
      'hello', 'key', createSettings('openai'), { signal: controller.signal }
    );
    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('调用方 shouldRetry 返回 false 时不重试', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    await expect(TranslationApiService.callWithSystem(
      'sys', 'user', 'key', createSettings('openai'),
      { maxRetries: 2, shouldRetry: () => false }
    )).rejects.toMatchObject({ kind: 'unavailable' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('options.responseFormat 支持 json_schema 透传', async () => {
    fetchMock.mockResolvedValue(openaiOkResponse());
    const responseFormat = {
      type: 'json_schema',
      json_schema: { name: 'result', schema: { type: 'object' } },
    } as const;

    await TranslationApiService.callWithSystem(
      'sys', 'user', 'sk-key', createSettings('openai'),
      undefined,
      { responseFormat } satisfies TranslationApiRequestOptions
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual(responseFormat);
  });

  it('gemini 纯文本 maxOutputTokens 不再固定 100', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'g' }] } }] }),
    });

    await TranslationApiService.quickTranslate('hello', 'key', createSettings('gemini'));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThan(100);
  });

  it('错误信息不泄露 API Key，且可按状态码分类', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'unauthorized sk-live-abcdef123456' } }),
    });

    const error = await TranslationApiService
      .callWithSystem('sys', 'user', 'sk-live-abcdef123456', createSettings('openai'))
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('sk-live-abcdef123456');

    const info = classifyTranslationError(error);
    expect(info.type).toBe(TranslationErrorType.INVALID_API_KEY);
  });

  it('服务不可用（503）可分类为 SERVICE_UNAVAILABLE', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    const error = await TranslationApiService
      .callWithSystem('sys', 'user', 'sk-key', createSettings('openai'), { maxRetries: 0 })
      .catch((e: Error) => e);

    expect(classifyTranslationError(error).type).toBe(TranslationErrorType.SERVICE_UNAVAILABLE);
  });
});

describe('providers — Ollama 推荐列表', () => {
  it('默认 qwen3:4b，qwen3.5:4b/9b 备选，chat 端点仍为 OpenAI 兼容', () => {
    const ollama = PROVIDER_CONFIGS.ollama;
    expect(ollama.recommendedModel).toBe('qwen3:4b');
    expect(ollama.defaultModels[0].id).toBe('qwen3:4b');
    expect(ollama.defaultModels[0].isRecommended).toBe(true);

    const ids = ollama.defaultModels.map((m) => m.id);
    expect(ids).toContain('qwen3.5:4b');
    expect(ids).toContain('qwen3.5:9b');
    expect(ollama.chatEndpoint).toContain('/v1/chat/completions');
  });
});
