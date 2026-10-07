import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserSettings } from '@/shared/types';

vi.mock('@/background/enhancedCache', () => ({ enhancedCache: {
  initialize: vi.fn(async () => undefined),
  getGeneration: vi.fn(() => 0),
  generateHash: vi.fn(() => 'deepl-fallback-key'),
  get: vi.fn(async () => null),
  set: vi.fn(async () => undefined),
} }));
vi.mock('@/shared/performance', () => ({
  MetricType: { CACHE_OPERATION: 'cache', API_RESPONSE_TIME: 'api', TRANSLATION_TOTAL_TIME: 'total' },
  recordMetric: vi.fn(),
}));

import { DeepLTranslationService } from '@/background/deeplTranslation';
import { enhancedCache } from '@/background/enhancedCache';

const text = 'Hello world';
const request = { text, mode: 'bilingual' as const, userLevel: { estimatedVocabulary: 3000 } };
const deeplConfig = { id: 'deepl', name: 'DeepL', provider: 'deepl' as const, apiKey: 'DEEPL_A', tested: true, createdAt: 0 };
const llmConfig = {
  id: 'llm', name: '模型 A', provider: 'custom' as const, apiKey: 'LLM_A',
  apiUrl: 'https://a.example/v1/chat/completions', modelName: 'model-a', tested: true, createdAt: 0,
};
const settingsA: UserSettings = {
  ...DEFAULT_SETTINGS, apiConfigs: [deeplConfig, llmConfig], activeApiConfigId: 'deepl',
};
const settingsB: UserSettings = {
  ...DEFAULT_SETTINGS,
  apiConfigs: [{ ...llmConfig, id: 'b', apiUrl: 'https://b.example/v1/chat/completions', apiKey: 'LLM_B' }],
  activeApiConfigId: 'b',
};

function stubSettings(first: UserSettings, second: UserSettings = settingsB) {
  let reads = 0;
  const syncGet = vi.fn(async (key: string) => {
    if (key === 'settings') return { settings: reads++ === 0 ? first : second };
    if (key === 'apiKey') return { apiKey: 'LEGACY_KEY' };
    return {};
  });
  vi.stubGlobal('chrome', { storage: { sync: { get: syncGet } } });
  return { syncGet, reads: () => reads };
}

function stubFetch(deeplResult?: string) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://api-free.deepl.com/v2/translate') {
      return deeplResult
        ? Response.json({ translations: [{ text: deeplResult }] })
        : new Response('不可用', { status: 403 });
    }
    if (url === 'https://a.example/v1/chat/completions') {
      const body = JSON.parse(String(init?.body)) as { response_format?: unknown };
      const isJson = Boolean(body.response_format);
      return Response.json({ choices: [{ message: { content: isJson
        ? JSON.stringify({ fullText: '模型译文', words: [], sentences: [] })
        : '模型译文' } }] });
    }
    throw new Error(`测试禁止访问未预期端点：${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeepL 故障后的真实 API 路由', () => {
  it.each(['translate', 'quickTranslate'] as const)('%s 只把独立 LLM 配置的 A 密钥发送到 A 端点', async method => {
    const storage = stubSettings(settingsA);
    const fetchMock = stubFetch();

    if (method === 'translate') {
      expect((await DeepLTranslationService.translate(request)).fullText).toBe('模型译文');
      expect(enhancedCache.set).not.toHaveBeenCalled();
    } else {
      expect(await DeepLTranslationService.quickTranslate(text)).toBe('模型译文');
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api-free.deepl.com/v2/translate');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'DeepL-Auth-Key DEEPL_A' });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://a.example/v1/chat/completions');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer LLM_A' });
    expect(storage.reads()).toBe(1);
    expect(storage.syncGet).not.toHaveBeenCalledWith('apiKey');
  });

  it.each(['translate', 'quickTranslate'] as const)('%s 没有独立 LLM 配置时受控报错且绝不重试 DeepL', async method => {
    const storage = stubSettings({ ...settingsA, apiConfigs: [deeplConfig] });
    const fetchMock = stubFetch();

    await expect(method === 'translate'
      ? DeepLTranslationService.translate(request)
      : DeepLTranslationService.quickTranslate(text)).rejects.toThrow('No LLM fallback configured');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api-free.deepl.com/v2/translate');
    expect(storage.reads()).toBe(1);
    expect(storage.syncGet).not.toHaveBeenCalledWith('apiKey');
  });

  it('独立 LLM 配置缺少密钥时不借用 B 或旧版密钥', async () => {
    const storage = stubSettings({
      ...settingsA, apiConfigs: [deeplConfig, { ...llmConfig, apiKey: '' }],
    });
    const fetchMock = stubFetch();

    await expect(DeepLTranslationService.translate(request)).rejects.toThrow('No LLM fallback configured');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(storage.reads()).toBe(1);
    expect(storage.syncGet).not.toHaveBeenCalledWith('apiKey');
  });

  it('DeepL 成功后的生词分析也使用独立 LLM 密钥和同一设置快照', async () => {
    const storage = stubSettings(settingsA);
    const fetchMock = stubFetch('DeepL 译文');

    expect((await DeepLTranslationService.translate(request)).fullText).toBe('DeepL 译文');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://a.example/v1/chat/completions');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer LLM_A' });
    expect(storage.reads()).toBe(1);
  });

  it('传统供应商为有道时不把有道密钥发送给 DeepL，直接调用独立 LLM', async () => {
    const storage = stubSettings({
      ...settingsA, apiConfigs: [llmConfig], activeApiConfigId: 'llm',
      hybridTranslation: { ...DEFAULT_SETTINGS.hybridTranslation!, traditionalProvider: 'youdao', traditionalApiKey: 'YOUDAO_SECRET' },
    });
    const fetchMock = stubFetch();

    expect(await DeepLTranslationService.quickTranslate(text)).toBe('模型译文');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://a.example/v1/chat/completions');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer LLM_A' });
    expect(storage.reads()).toBe(1);
  });

  it('传统供应商未明确标记 DeepL 时也不发送来源不明的传统密钥', async () => {
    stubSettings({
      ...settingsA, apiConfigs: [llmConfig], activeApiConfigId: 'llm',
      hybridTranslation: { ...DEFAULT_SETTINGS.hybridTranslation!, traditionalProvider: undefined!, traditionalApiKey: 'UNKNOWN_SECRET' },
    });
    const fetchMock = stubFetch();

    expect(await DeepLTranslationService.quickTranslate(text)).toBe('模型译文');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://a.example/v1/chat/completions');
  });

  it('有道密钥不能遮蔽独立配置的 DeepL 密钥', async () => {
    stubSettings({
      ...settingsA,
      hybridTranslation: { ...DEFAULT_SETTINGS.hybridTranslation!, traditionalProvider: 'youdao', traditionalApiKey: 'YOUDAO_SECRET' },
    });
    const fetchMock = stubFetch();

    expect(await DeepLTranslationService.quickTranslate(text)).toBe('模型译文');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'DeepL-Auth-Key DEEPL_A' });
  });
});
