import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationRequest, UserProfile, UserSettings } from '@/shared/types';

vi.mock('@/background/storage', () => ({ StorageManager: {
  getSettings: vi.fn(), getApiKey: vi.fn(), getUserProfile: vi.fn(),
} }));
vi.mock('@/background/translationApi', () => ({ TranslationApiService: {
  callWithSystem: vi.fn(), quickTranslate: vi.fn(),
} }));
vi.mock('@/shared/performance', () => ({ MetricType: {
  CACHE_OPERATION: 'cache', API_RESPONSE_TIME: 'api', TRANSLATION_TOTAL_TIME: 'total',
}, recordMetric: vi.fn() }));
vi.mock('@/shared/utils', async () => ({
  ...await vi.importActual<typeof import('@/shared/utils')>('@/shared/utils'),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { enhancedCache } from '@/background/enhancedCache';
import { TranslationService } from '@/background/translation';
import { BatchTranslationService } from '@/background/batchTranslation';
import { DeepLTranslationService } from '@/background/deeplTranslation';
import { HybridTranslationService } from '@/background/hybridTranslation';
import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { setOfflineWordSource, clearWordSenseCache } from '@/background/localWordLookup';

const userLevel: UserProfile = {
  examType: 'cet4', estimatedVocabulary: 3000, knownWords: [], unknownWords: [],
  levelConfidence: 0.5, createdAt: 0, updatedAt: 0,
};
const baseSettings = {
  apiProvider: 'openai', customModelName: 'model-a', apiConfigs: [],
  phraseTranslationEnabled: false, grammarTranslationEnabled: false,
  translationMode: 'bilingual',
} as UserSettings;
const text = 'This unusually long sentence is not the same after a minor revision.';
const request: TranslationRequest = { text, context: 'first', userLevel, mode: 'bilingual' };
let settings: UserSettings;
let serial: number;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  } } });
  await enhancedCache.clearAll();
  settings = { ...baseSettings };
  serial = 0;
  setOfflineWordSource({ lookup: () => undefined });
  clearWordSenseCache();
  vi.mocked(StorageManager.getSettings).mockImplementation(async () => settings);
  vi.mocked(StorageManager.getApiKey).mockResolvedValue('TEST-KEY');
  vi.mocked(TranslationApiService.callWithSystem).mockImplementation(async () =>
    JSON.stringify({ fullText: `译文${++serial}`, words: [], sentences: [], paragraphs: [{ id: '0', fullText: `译文${serial}` }] }));
  vi.mocked(TranslationApiService.quickTranslate).mockImplementation(async () => `DeepL${++serial}`);
});

describe('真实翻译路径的段落缓存', () => {
  it('单段词汇标记与桶内微调保持命中，切换模型/增强/等级桶/语境后重新翻译', async () => {
    const run = (input = request) => TranslationService.translate(input);
    expect((await run()).fullText).toBe('译文1');
    expect((await run()).fullText).toBe('译文1');
    settings = { ...settings, customModelName: 'model-b' };
    expect((await run()).fullText).toBe('译文2');
    settings = { ...settings, phraseTranslationEnabled: true };
    expect((await run()).fullText).toBe('译文3');
    settings = { ...settings, grammarTranslationEnabled: true };
    expect((await run()).fullText).toBe('译文4');
    expect((await run({ ...request, userLevel: { ...userLevel, knownWords: ['same'], estimatedVocabulary: 3050 } })).fullText).toBe('译文4');
    expect((await run({ ...request, userLevel: { ...userLevel, estimatedVocabulary: 9000 } })).fullText).toBe('译文5');
    expect((await run({ ...request, context: 'second' })).fullText).toBe('译文6');
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(6);
  });

  it('批量同文本精确命中，但 provider、model 与用户等级切换时不复用', async () => {
    const batch = (profile = userLevel) => BatchTranslationService.translateBatch({
      paragraphs: [{ id: 'a', text, elementPath: '#a' }], mode: 'bilingual', pageUrl: 'background', userLevel: profile,
    });
    expect((await batch()).results[0].result.fullText).toBe('译文1');
    expect((await batch()).results[0].cached).toBe(true);
    settings = { ...settings, apiProvider: 'anthropic' };
    expect((await batch()).results[0].result.fullText).toBe('译文2');
    settings = { ...settings, customModelName: 'model-b' };
    expect((await batch()).results[0].result.fullText).toBe('译文3');
    expect((await batch({ ...userLevel, knownWords: ['same'], estimatedVocabulary: 3050 })).results[0].result.fullText).toBe('译文3');
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(3);
  });

  it.each(['known', 'unknown'] as const)('批量标记一个 %s 词并在桶内微调后全命中且零外发，4499→4500 则未命中', async marking => {
    const batch = (profile: UserProfile) => BatchTranslationService.translateBatch({
      paragraphs: [
        { id: '0', text, elementPath: '#a' },
        { id: '1', text: `${text} Another paragraph.`, elementPath: '#b' },
      ], mode: 'bilingual', pageUrl: 'background', userLevel: profile,
    });
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(JSON.stringify({
      paragraphs: [{ id: '0', fullText: '首段', words: [] }, { id: '1', fullText: '次段', words: [] }],
    }));
    const profile = { ...userLevel, estimatedVocabulary: 4450 };
    const marked = {
      ...profile, estimatedVocabulary: 4499,
      knownWords: marking === 'known' ? ['same'] : [],
      unknownWords: marking === 'unknown'
        ? [{ word: 'same', translation: '相同', context: text, markedAt: 1, reviewCount: 0 }] : [],
    };
    const first = await batch(profile);
    expect(first.results).toHaveLength(2);
    expect(TranslationApiService.callWithSystem).toHaveBeenCalled();
    vi.mocked(TranslationApiService.callWithSystem).mockClear();
    vi.mocked(TranslationApiService.quickTranslate).mockClear();
    const cached = await batch(marked);
    expect(cached.results).toHaveLength(2);
    expect(cached.results.every(item => item.cached)).toBe(true);
    expect(cached.results.map(item => item.result.fullText)).toEqual(first.results.map(item => item.result.fullText));
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    expect(TranslationApiService.quickTranslate).not.toHaveBeenCalled();
    const crossed = await batch({ ...marked, estimatedVocabulary: 4500 });
    expect(crossed.results.every(item => !item.cached)).toBe(true);
    expect(TranslationApiService.callWithSystem).toHaveBeenCalled();
  });

  it.each(['llm', 'deepl', 'hybrid'] as const)('%s 路径词表与桶内微调后命中，跨桶后重新外发', async engine => {
    settings = { ...baseSettings, hybridTranslation: {
      enabled: engine === 'hybrid', defaultEngine: 'llm', traditionalProvider: 'deepl',
      traditionalApiKey: 'TEST-DEEPL-KEY', simpleTextThreshold: 10, enableSmartRouting: false, priority: 'quality',
    } };
    const service = engine === 'llm' ? TranslationService : engine === 'deepl' ? DeepLTranslationService : HybridTranslationService;
    const input = { ...request, userLevel: { ...userLevel, estimatedVocabulary: 4450 } };
    const first = await service.translate(input);
    const marked = { ...input, userLevel: { ...input.userLevel, estimatedVocabulary: 4499,
      knownWords: ['same'], unknownWords: [{ word: 'revision', translation: '修订', context: text, markedAt: 1, reviewCount: 0 }],
    } };
    vi.mocked(TranslationApiService.callWithSystem).mockClear();
    vi.mocked(TranslationApiService.quickTranslate).mockClear();
    expect(await service.translate(marked)).toMatchObject({ cached: true, fullText: first.fullText });
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    expect(TranslationApiService.quickTranslate).not.toHaveBeenCalled();
    expect((await service.translate({ ...marked, userLevel: { ...marked.userLevel, estimatedVocabulary: 4500 } })).cached).not.toBe(true);
    expect(vi.mocked(TranslationApiService.callWithSystem).mock.calls.length
      + vi.mocked(TranslationApiService.quickTranslate).mock.calls.length).toBeGreaterThan(0);
  });

  it('DeepL 先回退 LLM，后来配置 DeepL 密钥时不能复用回退译文', async () => {
    const hybridTranslation = {
      enabled: false, defaultEngine: 'traditional' as const, traditionalProvider: 'deepl' as const,
      simpleTextThreshold: 10, enableSmartRouting: false, priority: 'speed' as const,
    };
    settings = { ...baseSettings, apiProvider: 'deepl', hybridTranslation, apiConfigs: [
      { id: 'llm', name: 'LLM', provider: 'openai', apiKey: 'LLM-KEY', tested: true },
    ] };
    expect((await DeepLTranslationService.translate(request)).fullText).toBe('译文1');
    settings = { ...settings, hybridTranslation: { ...hybridTranslation, traditionalApiKey: 'DEEPL-KEY' } };
    expect((await DeepLTranslationService.translate(request)).fullText).toBe('DeepL2');
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledTimes(1);
  });

  it('DeepL 请求发出后清空缓存，迟到的 DeepL 译文不得回填', async () => {
    settings = { ...baseSettings, apiProvider: 'deepl', apiConfigs: [
      { id: 'deepl', name: 'DeepL', provider: 'deepl', apiKey: 'TEST-DEEPL-KEY', tested: true },
    ] };
    vi.mocked(StorageManager.getApiKey).mockResolvedValue(null);
    let release!: (value: string) => void;
    vi.mocked(TranslationApiService.quickTranslate)
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValueOnce('新译文');

    const pending = DeepLTranslationService.translate(request);
    await vi.waitFor(() => expect(TranslationApiService.quickTranslate).toHaveBeenCalledOnce());
    await enhancedCache.clearAll();
    release('旧译文');

    expect((await pending).fullText).toBe('旧译文');
    expect((await DeepLTranslationService.translate(request)).fullText).toBe('新译文');
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledTimes(2);
  });

  it('DeepL 无密钥时 LLM 回退在清空缓存后不能迟到回填', async () => {
    settings = { ...baseSettings, apiProvider: 'deepl', apiConfigs: [
      { id: 'llm', name: 'LLM', provider: 'openai', apiKey: 'LLM-KEY', tested: true },
    ] };
    let release!: (value: string) => void;
    vi.mocked(TranslationApiService.callWithSystem).mockImplementationOnce(() =>
      new Promise(resolve => { release = resolve; })
    );

    const pending = DeepLTranslationService.translate(request);
    await vi.waitFor(() => expect(TranslationApiService.callWithSystem).toHaveBeenCalledOnce());
    await enhancedCache.clearAll();
    release(JSON.stringify({ fullText: '旧译文', words: [], sentences: [] }));

    expect((await pending).fullText).toBe('旧译文');
    expect((await DeepLTranslationService.translate(request)).cached).not.toBe(true);
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(2);
  });

  it.each(['llm', 'traditional'] as const)('Hybrid %s 路径清空缓存后不回填迟到的 LLM 结果', async engine => {
    settings = { ...baseSettings, hybridTranslation: {
      enabled: true, defaultEngine: engine, traditionalProvider: 'deepl', simpleTextThreshold: 10,
      enableSmartRouting: false, priority: 'quality',
    } };
    let release!: (value: string) => void;
    vi.mocked(TranslationApiService.callWithSystem).mockImplementationOnce(() =>
      new Promise(resolve => { release = resolve; })
    );

    const pending = HybridTranslationService.translate(request);
    await vi.waitFor(() => expect(TranslationApiService.callWithSystem).toHaveBeenCalledOnce());
    await enhancedCache.clearAll();
    release(JSON.stringify({ fullText: '旧译文', words: [], sentences: [] }));

    expect((await pending).fullText).toBe('旧译文');
    expect((await HybridTranslationService.translate(request)).cached).not.toBe(true);
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(2);
  });

  it('Hybrid 并行返回传统译文后，未结束的 LLM 不能在清空缓存后回填', async () => {
    const previousConfig = HybridTranslationService.getConfig();
    HybridTranslationService.updateConfig({
      defaultEngine: 'hybrid', traditionalProvider: 'deepl', enableSmartRouting: false,
      enableParallelTranslation: true, enableEnhancedAnalysis: false,
    });
    settings = { ...baseSettings, hybridTranslation: {
      enabled: true, defaultEngine: 'hybrid', traditionalProvider: 'deepl', traditionalApiKey: 'TEST-DEEPL-KEY',
      simpleTextThreshold: 10, enableSmartRouting: false, priority: 'speed',
    } };
    let release!: (value: string) => void;
    vi.mocked(TranslationApiService.callWithSystem).mockImplementation((_system, user) =>
      user.includes('Analyze these English words')
        ? Promise.resolve('{"words":[]}')
        : new Promise(resolve => { release = resolve; })
    );
    const cacheSet = vi.spyOn(enhancedCache, 'set');
    try {
      const pending = HybridTranslationService.translate(request);
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      expect((await pending).fullText).toMatch(/^DeepL/);
      await enhancedCache.clearAll();
      release(JSON.stringify({ fullText: '迟到译文', words: [], sentences: [] }));
      await vi.waitFor(() => expect(cacheSet).toHaveBeenCalledOnce());
      expect(await enhancedCache.get(cacheSet.mock.calls[0][0])).toBeNull();
    } finally {
      cacheSet.mockRestore();
      HybridTranslationService.updateConfig(previousConfig);
    }
  });

  it('DeepL 与 Hybrid LLM 不读取单段 LLM 缓存，也不互相串模型', async () => {
    await TranslationService.translate(request);
    settings = { ...settings, apiProvider: 'deepl', hybridTranslation: {
      enabled: false, traditionalApiKey: 'DEEPL-KEY', defaultEngine: 'traditional',
      traditionalProvider: 'deepl', simpleTextThreshold: 10, enableSmartRouting: false, priority: 'speed',
    } };
    const firstDeepL = await DeepLTranslationService.translate(request);
    expect(firstDeepL.fullText).toMatch(/^DeepL/);
    expect((await DeepLTranslationService.translate(request)).cached).toBe(true);
    settings = { ...settings, customModelName: 'other' };
    const secondDeepL = await DeepLTranslationService.translate(request);
    expect(secondDeepL.fullText).toMatch(/^DeepL/);
    expect(secondDeepL.fullText).not.toBe(firstDeepL.fullText);
    settings = { ...baseSettings, hybridTranslation: {
      enabled: true, defaultEngine: 'llm', traditionalProvider: 'deepl', simpleTextThreshold: 10,
      enableSmartRouting: false, priority: 'quality',
    } };
    const firstHybrid = await HybridTranslationService.translate(request);
    expect(firstHybrid.fullText).toMatch(/^译文/);
    expect(firstHybrid.fullText).not.toBe('译文1');
    expect((await HybridTranslationService.translate(request)).cached).toBe(true);
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledTimes(2);
  });
});
