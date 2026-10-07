/**
 * 翻译传输层 helper 测试
 *
 * 覆盖：超时中止、调用方取消、重试策略（不盲重试 / 等待可中断）、
 * 错误脱敏、资源清理、max_tokens 有界化与 response_format 解析。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  executeTransportRequest,
  boundedMaxTokens,
  resolveResponseFormat,
  TRANSPORT_DEFAULTS,
} from '@/background/translationRequest';
import { TransportError } from '@/shared/utils/translationErrors';
import { logger } from '@/shared/utils/logger';

describe('boundedMaxTokens', () => {
  it('默认 1024（替代旧固定值 100，避免长句截断）', () => {
    expect(boundedMaxTokens(undefined)).toBe(TRANSPORT_DEFAULTS.defaultTextMaxTokens);
    expect(boundedMaxTokens(undefined)).toBe(1024);
  });

  it('请求值在界内则透传', () => {
    expect(boundedMaxTokens(2048)).toBe(2048);
  });

  it('过小抬高到下界', () => {
    expect(boundedMaxTokens(10)).toBe(TRANSPORT_DEFAULTS.minTokens);
  });

  it('过大压到上界', () => {
    expect(boundedMaxTokens(99999)).toBe(TRANSPORT_DEFAULTS.maxTokens);
  });

  it('非法值回退默认', () => {
    expect(boundedMaxTokens(Number.NaN)).toBe(1024);
  });
});

describe('resolveResponseFormat', () => {
  it('JSON 模式默认 json_object', () => {
    expect(resolveResponseFormat(undefined, true)).toEqual({ type: 'json_object' });
  });

  it('非 JSON 模式返回 undefined', () => {
    expect(resolveResponseFormat(undefined, false)).toBeUndefined();
  });

  it('透传调用方 responseFormat（含 json_schema）', () => {
    const schemaFormat = {
      type: 'json_schema',
      json_schema: { name: 'result', schema: { type: 'object' } },
    } as const;
    expect(resolveResponseFormat({ responseFormat: schemaFormat }, true)).toEqual(schemaFormat);
  });
});

describe('TRANSPORT_DEFAULTS', () => {
  it('云端 LLM 默认 60s，本地 Ollama 冷加载放宽到 90s', () => {
    expect(TRANSPORT_DEFAULTS.llmTimeoutMs).toBe(60_000);
    expect(TRANSPORT_DEFAULTS.localLlmTimeoutMs).toBe(90_000);
    expect(TRANSPORT_DEFAULTS.legacyEngineTimeoutMs).toBe(15_000);
  });
});

describe('executeTransportRequest', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okInit = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  const baseOptions = { onSuccess: (data: unknown) => String((data as { content: string }).content) };

  it('成功返回解析结果，并把 AbortSignal 传给 fetch', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: 'ok' }) });

    const result = await executeTransportRequest('https://api.example.dev/v1', okInit, { ...baseOptions });

    expect(result).toBe('ok');
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });

  it('预先取消的 signal：立即抛 cancelled 且不发起请求', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeTransportRequest('https://api.example.dev/v1', okInit, { ...baseOptions, signal: controller.signal })
    ).rejects.toMatchObject({ kind: 'cancelled' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('调用方中途取消：fetch 收到的 signal 被中止，错误为 cancelled', async () => {
    let capturedSignal: AbortSignal | undefined;
    // 模拟挂起的 fetch：仅捕获 signal，验证调用方取消时它被中止
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      capturedSignal = init.signal;
      return new Promise(() => {});
    });

    const controller = new AbortController();
    const promise = executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('超时：中止请求并抛 timeout 错误', async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });

    const promise = executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
      timeoutMs: 30,
    });

    await expect(promise).rejects.toMatchObject({ kind: 'timeout' });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  }, 5000);

  it('读取响应 body 阶段超时同样被中止（清理覆盖 body 读取）', async () => {
    // fetch 正常返回，但 json() 永不完成
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) });

    await expect(
      executeTransportRequest('https://api.example.dev/v1', okInit, { ...baseOptions, timeoutMs: 30 })
    ).rejects.toMatchObject({ kind: 'timeout' });
  }, 5000);

  it('超时后不盲重试', async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });

    await expect(
      executeTransportRequest('https://api.example.dev/v1', okInit, {
        ...baseOptions,
        timeoutMs: 30,
        retry: { maxRetries: 3, initialDelay: 1 },
      })
    ).rejects.toMatchObject({ kind: 'timeout' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 5000);

  it('取消后不盲重试（即使 fetch 不响应 signal 也能及时返回）', async () => {
    // 模拟不遵守 signal 的 fetch：promise 永不 resolve/reject
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const controller = new AbortController();
    const promise = executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
      signal: controller.signal,
      retry: { maxRetries: 3, initialDelay: 1 },
    });
    setTimeout(() => controller.abort(), 10);

    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 503 按重试配置重试后成功', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ content: 'ok' }) });

    const result = await executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
      retry: { maxRetries: 2, initialDelay: 1 },
    });

    expect(result).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('重试等待期间可被 signal 取消（不再阻塞 60s）', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    const controller = new AbortController();
    const promise = executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
      signal: controller.signal,
      retry: { maxRetries: 3, initialDelay: 60_000 },
    });
    setTimeout(() => controller.abort(), 20);

    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 错误使用固定 public 文案，服务端 detail 独立字段且脱敏', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'bad key sk-test-secret-123' } }),
    });

    const error = await executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
      secrets: ['sk-test-secret-123'],
      // 真实调用中由 provider 提取器提供，这里模拟 OpenAI 风格的错误提取
      extractErrorMessage: (data) => (data as { error?: { message?: string } }).error?.message,
    }).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    // public 文案固定，不回显服务端原文（哪怕已脱敏）
    expect(error.message).toBe('API Key 无效或未授权');
    expect(error.message).not.toContain('bad key');
    expect(error.message).not.toContain('sk-test-secret-123');
    // 服务端细节降级到独立 detail 字段，且必须脱敏
    expect((error as { detail?: string }).detail).toBeDefined();
    expect((error as { detail?: string }).detail).not.toContain('sk-test-secret-123');
    expect((error as { detail?: string }).detail).toContain('已脱敏');
  });

  it('未提供错误提取器时，仅暴露状态码固定文案且无 detail', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const error = await executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
    }).catch((e: Error) => e);

    expect(error.message).toBe('API Key 无效或未授权');
    expect((error as { detail?: string }).detail).toBeUndefined();
  });

  it('完成后清理监听器：外部再 abort 不影响已完成的请求', async () => {
    const removeSpy = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: 'ok' }) });

    const controller = new AbortController();
    await executeTransportRequest('https://api.example.dev/v1', okInit, { ...baseOptions, signal: controller.signal });

    expect(removeSpy).toHaveBeenCalled();
    controller.abort(); // 若未解绑会触发残留监听
    removeSpy.mockRestore();
  });

  it('onSuccess 抛出的 TransportError（百度 200+error_msg 场景）同样脱敏', async () => {
    // HTTP 200 但业务层报错：error_msg 由服务端返回，可能回显密钥
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error_code: 1, error_msg: 'invalid sk-synth-key-999999' }),
    });

    const error = await executeTransportRequest('https://api.example.dev/v1', okInit, {
      onSuccess: (data) => {
        const d = data as { error_code?: number; error_msg?: string };
        if (d.error_code) {
          throw TransportError.unavailable(d.error_msg || '未知错误');
        }
        return '';
      },
      secrets: ['sk-synth-key-999999'],
      retry: { maxRetries: 1, initialDelay: 1 },
    }).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('sk-synth-key-999999');
  });

  it('200 响应 JSON 解析失败（SyntaxError）使用固定文案，不携带正文片段', async () => {
    // SyntaxError 消息可能包含响应正文片段（如回显的用户正文）
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token 用户正文片段 in JSON at position 3');
      },
    });

    const error = await executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
    }).catch((e: Error) => e);

    expect(error.message).toBe('响应解析失败：invalid JSON response');
    expect(error.message).not.toContain('用户正文片段');
  });

  it('provider 错误回显用户正文时，正文只进脱敏后的 detail，不进 public 文案', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: 'cannot translate: MySecretSentence' } }),
    });

    const error = await executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
      redactTexts: ['MySecretSentence'],
      extractErrorMessage: (data) => (data as { error?: { message?: string } }).error?.message,
      retry: { maxRetries: 0 },
    }).catch((e: Error) => e);

    // 5xx 固定文案
    expect(error.message).toBe('翻译服务暂时不可用 (HTTP 503)');
    expect(error.message).not.toContain('MySecretSentence');
    const detail = (error as { detail?: string }).detail ?? '';
    expect(detail).not.toContain('MySecretSentence');
    expect(detail).toContain('已脱敏');
  });

  it('sentinel 回归：伪密钥与正文片段不得出现在 message/detail/日志任何出口', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const SENTINEL_KEY = 'sk-FAKE-SENTINEL-000111';
    const SENTINEL_BODY = 'SENTINEL-USER-BODY-TEXT';

    // 百度式 200 + error_msg 回显密钥；随后 503 回显正文
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ error_code: 1, error_msg: `invalid ${SENTINEL_KEY}` }),
      })
      .mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: { message: `echo ${SENTINEL_BODY} ${SENTINEL_KEY}` } }),
      });

    const onSuccessError = await executeTransportRequest('https://api.example.dev/v1', okInit, {
      onSuccess: (data) => {
        const d = data as { error_code?: number; error_msg?: string };
        if (d.error_code) {
          throw TransportError.unavailable('服务端业务错误', undefined, d.error_msg);
        }
        return '';
      },
      secrets: [SENTINEL_KEY],
      retry: { maxRetries: 1, initialDelay: 1 },
    }).catch((e: Error) => e);

    const httpError = await executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
      secrets: [SENTINEL_KEY],
      redactTexts: [SENTINEL_BODY],
      extractErrorMessage: (data) => (data as { error?: { message?: string } }).error?.message,
      retry: { maxRetries: 0 },
    }).catch((e: Error) => e);

    for (const error of [onSuccessError, httpError]) {
      const whole = JSON.stringify({
        message: (error as Error).message,
        detail: (error as { detail?: string }).detail,
      });
      expect(whole).not.toContain(SENTINEL_KEY);
      expect(whole).not.toContain(SENTINEL_BODY);
    }

    expect(warnSpy).toHaveBeenCalled();
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain(SENTINEL_KEY);
    expect(logged).not.toContain(SENTINEL_BODY);
    warnSpy.mockRestore();
  });

  it('网络层错误的 message 使用固定文案，不回显底层错误原文', async () => {
    // fetch 网络失败的 TypeError 原文可能携带 URL 查询参数或正文片段
    fetchMock.mockRejectedValue(
      new TypeError(
        "Failed to fetch 'https://api.example.dev/v1?key=sk-FAKE-SENTINEL-000111': SENTINEL-USER-BODY-TEXT"
      )
    );

    const error = await executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
      secrets: ['sk-FAKE-SENTINEL-000111'],
      redactTexts: ['SENTINEL-USER-BODY-TEXT'],
    }).catch((e: Error) => e);

    expect(error.message).toBe('网络请求失败，无法连接翻译服务');
    expect(error.message).not.toContain('SENTINEL-USER-BODY-TEXT');
  });

  it('onSuccess 抛出的 TransportError message 统一重建为固定 public 文案', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: 'ok' }) });

    const error = await executeTransportRequest('https://api.example.dev/v1', okInit, {
      onSuccess: () => {
        throw TransportError.unavailable('服务端拒绝：SENTINEL-BUSINESS-TEXT');
      },
    }).catch((e: Error) => e);

    expect(error.message).toBe('翻译服务暂时不可用，请稍后重试');
    expect(error.message).not.toContain('SENTINEL-BUSINESS-TEXT');
  });

  it('onSuccess 抛出的带状态码 TransportError 重建为对应固定文案并保留状态码', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: 'ok' }) });

    const error = await executeTransportRequest('https://api.example.dev/v1', okInit, {
      onSuccess: () => {
        throw TransportError.unavailable('quota exceeded: SENTINEL-QUOTA-TEXT', 429);
      },
    }).catch((e: Error) => e);

    expect(error.message).toBe('请求过于频繁');
    expect(error.statusCode).toBe(429);
    expect(error.message).not.toContain('SENTINEL-QUOTA-TEXT');
  });

  it('重试回调收到的 error.message 为固定文案：调用方只记 message 也不泄露正文', async () => {
    // 模拟批量翻译调用方的 onRetry：直接记录 error.message；底层错误原文含 redactTexts 未覆盖的片段
    const seen: string[] = [];
    fetchMock.mockRejectedValue(new TypeError('connection reset while reading SENTINEL-PRIVATE-FRAGMENT'));

    await executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
      retry: {
        maxRetries: 1,
        initialDelay: 1,
        onRetry: (error) => {
          seen.push(error.message);
        },
      },
    }).catch(() => undefined);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe('网络请求失败，无法连接翻译服务');
    expect(seen.join('\n')).not.toContain('SENTINEL-PRIVATE-FRAGMENT');
  });

  it('重试日志只含 kind/状态码等固定信息，不含错误详情', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: 'sensitive-detail-sk-secret-987654' } }),
    });

    await executeTransportRequest('https://api.example.dev/v1', okInit, {
      ...baseOptions,
      secrets: ['sk-secret-987654'],
      retry: { maxRetries: 1, initialDelay: 1 },
    }).catch(() => {});

    expect(warnSpy).toHaveBeenCalled(); // 确保断言有实际覆盖
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain('sensitive-detail');
    expect(logged).not.toContain('sk-secret-987654');
    warnSpy.mockRestore();
  });
});
