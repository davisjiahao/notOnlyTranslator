import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserProfile, UserSettings } from '@/shared/types';

const cacheState = vi.hoisted(() => ({ generation: 0, writes: 0 }));
vi.mock('@/background/enhancedCache', () => ({ enhancedCache: {
  initialize: vi.fn(async () => undefined),
  getGeneration: vi.fn(() => cacheState.generation),
  generateHash: vi.fn(() => 'cache-key'),
  get: vi.fn(async () => null),
  getBatch: vi.fn(async () => ({ hits: new Map(), misses: ['cache-key'] })),
  set: vi.fn(async (...args: unknown[]) => {
    if (args[5] === cacheState.generation) cacheState.writes += 1;
  }),
} }));
vi.mock('@/background/translationRequest', async () => ({
  ...await vi.importActual<typeof import('@/background/translationRequest')>('@/background/translationRequest'),
  executeTransportRequest: vi.fn(async () => '免费译文'),
}));
vi.mock('@/background/translationApi', () => ({ TranslationApiService: {
  callWithSystem: vi.fn(async () => JSON.stringify({
    fullText: '译文', words: [], sentences: [],
    paragraphs: [{ id: '0', fullText: '译文' }],
  })),
  quickTranslate: vi.fn(async () => '传统译文'),
} }));
vi.mock('@/shared/performance', () => ({ MetricType: {
  CACHE_OPERATION: 'cache', API_RESPONSE_TIME: 'api', TRANSLATION_TOTAL_TIME: 'total',
}, recordMetric: vi.fn() }));
vi.mock('@/shared/utils', async () => ({
  ...await vi.importActual<typeof import('@/shared/utils')>('@/shared/utils'),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { TranslationService } from '@/background/translation';
import { BatchTranslationService } from '@/background/batchTranslation';
import { DeepLTranslationService } from '@/background/deeplTranslation';
import { HybridTranslationService } from '@/background/hybridTranslation';
import { TranslationApiService } from '@/background/translationApi';
import { executeTransportRequest } from '@/background/translationRequest';
import { enhancedCache } from '@/background/enhancedCache';
import { resetOfflineWordSource, setOfflineWordSource, clearWordSenseCache } from '@/background/localWordLookup';

const profile: UserProfile = {
  examType: 'cet4', estimatedVocabulary: 3000, knownWords: [], unknownWords: [],
  levelConfidence: 0.5, createdAt: 0, updatedAt: 0,
};
const text = 'This unusually long sentence needs a careful translation.';
const configA: UserSettings = {
  ...DEFAULT_SETTINGS,
  apiConfigs: [{ id: 'a', name: 'A', provider: 'custom', apiUrl: 'https://a.example/v1', modelName: 'model-a', apiKey: 'KEY_A' }],
  activeApiConfigId: 'a',
};
const configB: UserSettings = {
  ...DEFAULT_SETTINGS,
  apiConfigs: [{ id: 'b', name: 'B', provider: 'custom', apiUrl: 'https://b.example/v1', modelName: 'model-b', apiKey: 'KEY_B' }],
  activeApiConfigId: 'b',
};

function switchSettings(first: Partial<UserSettings>, second: Partial<UserSettings>, legacyKey = '') {
  let settingsReads = 0;
  const syncGet = vi.fn(async (key: string | string[]) => {
    const keys = Array.isArray(key) ? key : [key];
    return {
      ...(keys.includes('settings') ? { settings: settingsReads++ === 0 ? first : second } : {}),
      ...(keys.includes('apiKey') ? { apiKey: legacyKey } : {}),
    };
  });
  vi.stubGlobal('chrome', { storage: { sync: { get: syncGet } } });
  return { syncGet, settingsReads: () => settingsReads };
}

beforeEach(() => {
  vi.clearAllMocks();
  cacheState.generation = 0;
  cacheState.writes = 0;
  setOfflineWordSource({ lookup: () => undefined });
  clearWordSenseCache();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
});

describe('翻译请求的配置与密钥快照', () => {
  it('单段：配置 A 读取后切换至 B，仍仅将 A 密钥传给 A 端点', async () => {
    const storage = switchSettings(configA, configB);
    await TranslationService.translate({ text, userLevel: profile, mode: 'bilingual' });
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 'KEY_A',
      expect.objectContaining({ apiProvider: 'custom', customApiUrl: 'https://a.example/v1' }),
      undefined, undefined,
    );
    expect(storage.settingsReads()).toBe(1);
  });

  it('批量：配置 A 读取后切换至 B，仍仅将 A 密钥传给 A 端点', async () => {
    const storage = switchSettings(configA, configB);
    await BatchTranslationService.translateBatch({
      paragraphs: [{ id: 'p1', text, elementPath: '#p1' }],
      pageUrl: 'https://page.example', mode: 'bilingual', userLevel: profile,
    });
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 'KEY_A',
      expect.objectContaining({ apiProvider: 'custom', customApiUrl: 'https://a.example/v1' }),
      expect.any(Object), expect.objectContaining({
        onStreamStart: expect.any(Function),
        onTextDelta: expect.any(Function),
      }),
    );
    expect(storage.settingsReads()).toBe(1);
  });

  it('单段旧版快照：切换至 B 并覆盖旧密钥字段后拒绝外发', async () => {
    const storage = switchSettings({ ...DEFAULT_SETTINGS, apiConfigs: [] }, configB, 'KEY_B');
    await expect(TranslationService.translate({ text, userLevel: profile, mode: 'bilingual' }))
      .rejects.toThrow('请先配置翻译服务');
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    expect(TranslationApiService.quickTranslate).not.toHaveBeenCalled();
    expect(executeTransportRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.settingsReads()).toBe(2);
    expect(storage.syncGet).toHaveBeenNthCalledWith(2, ['settings', 'apiKey', 'legacyApiKeyInvalidated']);
  });

  it('批量旧版快照：切换至 B 并覆盖旧密钥字段后拒绝外发', async () => {
    const storage = switchSettings({ ...DEFAULT_SETTINGS, apiConfigs: [] }, configB, 'KEY_B');
    await expect(BatchTranslationService.translateBatch({
      paragraphs: [{ id: 'p1', text, elementPath: '#p1' }],
      pageUrl: 'https://page.example', mode: 'bilingual', userLevel: profile,
    })).rejects.toThrow('API key not configured');
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    expect(TranslationApiService.quickTranslate).not.toHaveBeenCalled();
    expect(executeTransportRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.settingsReads()).toBe(2);
    expect(storage.syncGet).toHaveBeenNthCalledWith(2, ['settings', 'apiKey', 'legacyApiKeyInvalidated']);
  });

  it('批量新端点没有密钥时不借用旧密钥，不外发', async () => {
    const storage = switchSettings({
      ...configA, apiConfigs: [{ ...configA.apiConfigs[0], apiKey: '' }],
    }, configB, 'LEGACY_KEY');
    await expect(BatchTranslationService.translateBatch({
      paragraphs: [{ id: 'p1', text, elementPath: '#p1' }],
      pageUrl: 'https://page.example', mode: 'bilingual', userLevel: profile,
    })).rejects.toThrow('API key not configured');
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    expect(storage.syncGet).not.toHaveBeenCalledWith('apiKey');
  });

  it.each(['translate', 'quickTranslate'] as const)('DeepL %s 的 LLM 回退在配置切换后仍用 A 密钥搭配 A 端点', async method => {
    const storage = switchSettings(configA, configB);
    if (method === 'translate') {
      await DeepLTranslationService.translate({ text, userLevel: profile, mode: 'bilingual' });
      expect(TranslationApiService.callWithSystem).toHaveBeenCalledWith(
        expect.any(String), expect.any(String), 'KEY_A',
        expect.objectContaining({ apiProvider: 'custom', customApiUrl: 'https://a.example/v1' }),
        undefined, undefined,
      );
    } else {
      await DeepLTranslationService.quickTranslate(text);
      expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(
        text, 'KEY_A', expect.objectContaining({ customApiUrl: 'https://a.example/v1' }), undefined,
      );
    }
    expect(storage.settingsReads()).toBe(1);
  });

  it('DeepL 生词分析在等待传统翻译时切配置，仍只将 A 密钥发送到 A 端点', async () => {
    const settingsA = { ...configA, hybridTranslation: { traditionalProvider: 'deepl' as const, traditionalApiKey: 'DEEPL_A' } };
    const storage = switchSettings(settingsA, configB);
    let release!: (value: string) => void;
    vi.mocked(TranslationApiService.quickTranslate).mockImplementationOnce(() =>
      new Promise(resolve => { release = resolve; })
    );
    const pending = DeepLTranslationService.translate({ text, userLevel: profile, mode: 'bilingual' });
    await vi.waitFor(() => expect(TranslationApiService.quickTranslate).toHaveBeenCalledOnce());
    release('传统译文');
    await pending;
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 'KEY_A',
      expect.objectContaining({ customApiUrl: 'https://a.example/v1' }), undefined, undefined,
    );
    expect(storage.settingsReads()).toBe(1);
  });

  it.each(['llm', 'traditional'] as const)('Hybrid %s 路径切配置后仍用 A 密钥搭配 A 端点', async engine => {
    const storage = switchSettings({ ...configA, hybridTranslation: { defaultEngine: engine } }, configB);
    await HybridTranslationService.translate({ text, userLevel: profile, mode: 'bilingual' });
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 'KEY_A',
      expect.objectContaining({ customApiUrl: 'https://a.example/v1' }), undefined, undefined,
    );
    expect(storage.settingsReads()).toBe(1);
  });

  it('Hybrid 传统路径在配置切换后不使用 B 的传统密钥，生词分析也不用 B 的 LLM 密钥', async () => {
    const settingsA = { ...configA, hybridTranslation: { defaultEngine: 'traditional' as const, traditionalProvider: 'deepl' as const, traditionalApiKey: 'TRAD_A' } };
    const settingsB = { ...configB, hybridTranslation: { traditionalProvider: 'youdao' as const, traditionalApiKey: 'TRAD_B' } };
    const storage = switchSettings(settingsA, settingsB);
    await HybridTranslationService.translate({ text, userLevel: profile, mode: 'bilingual' });
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(
      text, 'TRAD_A', expect.any(Object), undefined,
    );
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 'KEY_A',
      expect.objectContaining({ customApiUrl: 'https://a.example/v1' }), undefined, undefined,
    );
    expect(storage.settingsReads()).toBe(1);
  });

  describe.each(['translate', 'quickTranslate'] as const)('Hybrid %s 的真实端点构建', method => {
    it.each(['独立密钥', 'apiConfigs 自定义端点'] as const)('%s 不将 DeepL 凭据送往当前 LLM 端点', async source => {
      const independent = source === '独立密钥';
      const traditional = {
        id: 'deepl-a', name: 'DeepL A', provider: 'deepl' as const, apiKey: 'DEEPL_CONFIG_A',
        apiUrl: 'https://deepl-a.example/v2/translate', tested: true, createdAt: 0,
      };
      const storage = switchSettings({
        ...configA,
        secondaryApiKey: 'LLM_SECONDARY_A',
        apiConfigs: [{ ...configA.apiConfigs[0], secondaryApiKey: 'LLM_SECONDARY_A' }, traditional],
        hybridTranslation: {
          defaultEngine: 'traditional', traditionalProvider: 'deepl',
          traditionalApiKey: independent ? 'DEEPL_INDEPENDENT_A' : undefined,
        },
      }, configB);
      const actual = await vi.importActual<typeof import('@/background/translationApi')>('@/background/translationApi');
      vi.mocked(TranslationApiService.quickTranslate).mockImplementationOnce(
        actual.TranslationApiService.quickTranslate.bind(actual.TranslationApiService),
      );
      const fetchMock = vi.fn(() => { throw new Error('测试禁止真实网络请求'); });
      vi.stubGlobal('fetch', fetchMock);
      const options = { signal: new AbortController().signal, timeoutMs: 1234 };

      if (method === 'translate') {
        await HybridTranslationService.translate({ text, userLevel: profile, mode: 'bilingual' }, options);
        expect(TranslationApiService.callWithSystem).toHaveBeenCalledWith(
          expect.any(String), expect.any(String), 'KEY_A',
          expect.objectContaining({ customApiUrl: 'https://a.example/v1', secondaryApiKey: 'LLM_SECONDARY_A' }),
          undefined, options,
        );
      } else {
        await HybridTranslationService.quickTranslate(text, options);
      }

      expect(executeTransportRequest).toHaveBeenCalledExactlyOnceWith(
        independent ? 'https://api-free.deepl.com/v2/translate' : traditional.apiUrl,
        expect.objectContaining({ headers: expect.objectContaining({
          Authorization: `DeepL-Auth-Key ${independent ? 'DEEPL_INDEPENDENT_A' : traditional.apiKey}`,
        }) }),
        expect.objectContaining({ signal: options.signal, timeoutMs: options.timeoutMs }),
      );
      expect(storage.settingsReads()).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('Hybrid 快速翻译切配置后不借用 B 的密钥', async () => {
    const storage = switchSettings(configA, configB);
    await HybridTranslationService.quickTranslate(text);
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(
      text, 'KEY_A', expect.objectContaining({ customApiUrl: 'https://a.example/v1' }), undefined,
    );
    expect(storage.settingsReads()).toBe(1);
  });

  it('单段与批量在请求期间清空缓存后不使用新代次写入', async () => {
    switchSettings(configA, configA);
    vi.mocked(TranslationApiService.callWithSystem).mockImplementation(async () => {
      cacheState.generation += 1;
      return JSON.stringify({ fullText: '译文', words: [], paragraphs: [{ id: '0', fullText: '译文' }] });
    });
    await TranslationService.translate({ text, userLevel: profile, mode: 'bilingual' });
    expect(enhancedCache.set).toHaveBeenLastCalledWith(
      'cache-key', expect.any(Object), 'bilingual', expect.any(String), 'llm', 0,
    );
    expect(cacheState.writes).toBe(0);
    vi.mocked(enhancedCache.set).mockClear();
    cacheState.generation = 0;
    await BatchTranslationService.translateBatch({
      paragraphs: [{ id: 'p1', text, elementPath: '#p1' }],
      pageUrl: 'https://page.example', mode: 'bilingual', userLevel: profile,
    });
    expect(enhancedCache.set).toHaveBeenLastCalledWith(
      'cache-key', expect.any(Object), 'bilingual', 'https://page.example', undefined, 0,
    );
    expect(cacheState.writes).toBe(0);
  });

  it('显式免费 Google 单段在清空后不回填缓存，且不读取密钥', async () => {
    const storage = switchSettings({ ...DEFAULT_SETTINGS, apiProvider: 'free_google_translate' }, configB);
    vi.mocked(executeTransportRequest).mockImplementation(async () => {
      cacheState.generation += 1;
      return '免费译文';
    });
    await TranslationService.translate({ text, userLevel: profile, mode: 'bilingual' });
    expect(enhancedCache.set).toHaveBeenLastCalledWith(
      'cache-key', expect.any(Object), 'bilingual', expect.any(String), 'free_google', 0,
    );
    expect(cacheState.writes).toBe(0);
    expect(storage.syncGet).not.toHaveBeenCalledWith('apiKey');
  });

  it('默认 OpenAI 归属不变时，旧密钥轮换使单段和批量缓存键使用实际密钥的摘要输入', async () => {
    const legacySettings = { ...DEFAULT_SETTINGS, apiConfigs: [] };
    for (const apiKey of ['LEGACY_KEY', 'ROTATED_KEY']) {
      switchSettings(legacySettings, legacySettings, apiKey);
      await TranslationService.translate({ text, userLevel: profile, mode: 'bilingual' });
      expect(enhancedCache.generateHash).toHaveBeenLastCalledWith(text, 'bilingual',
        expect.objectContaining({ context: expect.stringContaining(apiKey) }));
      await BatchTranslationService.translateBatch({
        paragraphs: [{ id: 'p1', text, elementPath: '#p1' }],
        pageUrl: 'https://page.example', mode: 'bilingual', userLevel: profile,
      });
      expect(enhancedCache.generateHash).toHaveBeenLastCalledWith(text, 'bilingual',
        expect.objectContaining({ context: apiKey }));
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('新端点没有密钥时即使有旧密钥也不外发', async () => {
    const storage = switchSettings({
      ...configA, apiConfigs: [{ ...configA.apiConfigs[0], apiKey: '' }],
    }, configB, 'LEGACY_KEY');
    await expect(TranslationService.translate({ text, userLevel: profile, mode: 'bilingual' }))
      .rejects.toThrow('请先配置翻译服务');
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    expect(storage.syncGet).not.toHaveBeenCalledWith('apiKey');
  });
});

afterEach(() => {
  resetOfflineWordSource();
  vi.unstubAllGlobals();
});
