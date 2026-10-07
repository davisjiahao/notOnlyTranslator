/**
 * TranslationService 本地优先（local-first）行为测试
 *
 * 覆盖：
 * - 单词级查询先走本地链（生词本/语境缓存/离线词典），不因等级低拒绝查词
 * - 断网/无 Key 时基础词典命中可用；未授权 Google 不外发，显式选择后才允许免费引擎
 * - Ollama 轻量词汇模式：仅译本地候选词，位置/难度本地计算并验证，语境释义写缓存避免重复调用
 * - options（signal/timeoutMs 等）贯穿到 TranslationApiService.callWithSystem
 * - translatePlainText 纯文本专用 MT 小接口
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing（沿用现有 translation.test.ts 风格）
vi.mock('@/background/storage', () => ({
  StorageManager: {
    getSettings: vi.fn(),
    getApiKey: vi.fn(),
    getUserProfile: vi.fn(),
  },
}));

vi.mock('@/background/translationApi', () => ({
  TranslationApiService: {
    callWithSystem: vi.fn(),
  },
}));

vi.mock('@/shared/performance', () => ({
  MetricType: {
    CACHE_OPERATION: 'cache_operation',
    API_RESPONSE_TIME: 'api_response_time',
    TRANSLATION_TOTAL_TIME: 'translation_total_time',
  },
  recordMetric: vi.fn(),
}));

vi.mock('@/background/enhancedCache', () => ({
  enhancedCache: {
    getGeneration: vi.fn(() => 0),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    fuzzyGet: vi.fn().mockResolvedValue(null),
    generateHash: vi.fn().mockImplementation((text: string, mode: string) => `h:${mode}:${text}`),
  },
}));

vi.mock('@/background/hybridTranslation', () => ({
  HybridTranslationService: {
    translate: vi.fn(),
  },
}));

vi.mock('@/background/deeplTranslation', () => ({
  DeepLTranslationService: {
    translate: vi.fn(),
    quickTranslate: vi.fn(),
  },
}));

// shared/utils 保留真实实现（generateCacheKey 是语境缓存正确性的关键），仅静默 logger
vi.mock('@/shared/utils', async () => {
  const actual = await vi.importActual<typeof import('@/shared/utils')>('@/shared/utils');
  return {
    ...actual,
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
});

import { TranslationService } from '@/background/translation';
import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { HybridTranslationService } from '@/background/hybridTranslation';
import { DeepLTranslationService } from '@/background/deeplTranslation';
import { enhancedCache } from '@/background/enhancedCache';
import { logger } from '@/shared/utils';
import { TransportError } from '@/shared/utils/translationErrors';
import {
  setOfflineWordSource,
  clearWordSenseCache,
  storeWordSense,
} from '@/background/localWordLookup';
import type { UserSettings, UserProfile, TranslationRequest, UnknownWordEntry } from '@/shared/types';

// 离线词典 fixture
const FIXTURE_DICT: Record<string, { translation: string; phonetic?: string }> = {
  book: { translation: '书；预订', phonetic: '/bʊk/' },
  house: { translation: '房子', phonetic: '/haʊs/' },
};

function makeEntry(word: string, context: string, translation: string): UnknownWordEntry {
  return { word, context, translation, markedAt: Date.now(), reviewCount: 0 };
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    examType: 'cet4',
    estimatedVocabulary: 99999, // C2：关闭难度通道，走确定性通道
    knownWords: ['house', 'car'],
    unknownWords: [],
    levelConfidence: 0.8,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    enabled: true,
    autoHighlight: true,
    vocabHighlightEnabled: true,
    phraseTranslationEnabled: false,
    grammarTranslationEnabled: false,
    translationMode: 'inline-only',
    showDifficulty: true,
    highlightColor: '#ffff00',
    fontSize: 14,
    apiProvider: 'openai',
    blacklist: [],
    apiConfigs: [],
    hoverDelay: 300,
    theme: 'system',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<TranslationRequest> = {}): TranslationRequest {
  return {
    text: 'house',
    context: 'the house is big',
    userLevel: makeProfile(),
    mode: 'inline-only',
    ...overrides,
  };
}

const mockedCallWithSystem = vi.mocked(TranslationApiService.callWithSystem);
const mockedGetSettings = vi.mocked(StorageManager.getSettings);
const mockedGetApiKey = vi.mocked(StorageManager.getApiKey);

beforeEach(() => {
  vi.clearAllMocks();
  mockedCallWithSystem.mockReset();
  setOfflineWordSource({ lookup: (lemma) => FIXTURE_DICT[lemma] });
  clearWordSenseCache();
  // 默认配置：openai + 有 Key
  mockedGetSettings.mockResolvedValue(createMockSettings());
  mockedGetApiKey.mockResolvedValue('sk-test');
});

describe('单词级本地优先查询', () => {
  it('生词本命中的单词：无任何网络调用即返回释义', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings());
    const request = makeRequest({
      text: 'ubiquitous,',
      context: 'the ubiquitous smartphone',
      userLevel: makeProfile({
        unknownWords: [makeEntry('ubiquitous', 'the ubiquitous smartphone', '无处不在的')],
      }),
    });

    const result = await TranslationService.translate(request);

    expect(result.words).toHaveLength(1);
    expect(result.words[0].translation).toBe('无处不在的');
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
    expect(HybridTranslationService.translate).not.toHaveBeenCalled();
  });

  it('低级已知词手动查词不被拒绝：knownWords 词落到离线词典', async () => {
    const result = await TranslationService.translate(makeRequest({ text: 'house' }));

    expect(result.words[0].translation).toBe('房子');
    expect(result.words[0].position).toEqual([0, 5]);
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
  });

  it('单词本地命中优先于混合翻译模式', async () => {
    // hybridTranslation 配置项未进 UserSettings 类型，生产代码以交叉类型读取
    const settings = createMockSettings();
    (settings as { hybridTranslation?: { enabled: boolean } }).hybridTranslation = { enabled: true };
    mockedGetSettings.mockResolvedValue(settings);

    await TranslationService.translate(makeRequest({ text: 'house' }));

    expect(HybridTranslationService.translate).not.toHaveBeenCalled();
  });

  it('词典未命中且有 Key：回退到 LLM 完整流程（fallback 保留）', async () => {
    mockedCallWithSystem.mockResolvedValue(
      JSON.stringify({
        fullText: '机缘巧合',
        words: [
          { original: 'serendipity', translation: '机缘巧合', position: [0, 11], difficulty: 8, isPhrase: false },
        ],
        sentences: [],
      })
    );

    const result = await TranslationService.translate(makeRequest({ text: 'serendipity' }));

    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(result.words[0].translation).toBe('机缘巧合');
  });

  it('词典未命中且无 Key：默认模式只返回本地状态，不自动发送正文给 Google', async () => {
    mockedGetApiKey.mockResolvedValue('');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await TranslationService.translate(makeRequest({ text: 'cottage' }));

      expect(result).toMatchObject({ _source: 'local', words: [] });
      expect(result.fullText).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('显式选择免费 Google 且网络失败：诚实抛错，不伪装成成功', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'free_google_translate' }));
    mockedGetApiKey.mockResolvedValue('');
    const fetchMock = vi.fn().mockRejectedValue(new Error('网络不可用'));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(TranslationService.translate(makeRequest({ text: 'cottage' }))).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('输出耗尽后的纯全文恢复', () => {
  const text = 'Read  this book carefully.';
  const recoveryRequest = (mode: TranslationRequest['mode'] = 'bilingual') => makeRequest({
    text, context: '', mode,
    userLevel: makeProfile({ unknownWords: [makeEntry('book', text, '书；预订')] }),
  });

  it.each([
    { mode: 'bilingual', provider: 'custom', timeoutMs: 5000 },
    { mode: 'full-translate', provider: 'ollama', timeoutMs: undefined },
  ] as const)('$mode 保留原 signal、每次尝试超时及本地词汇，不缓存降级结果', async ({ mode, provider, timeoutMs }) => {
    const settings = createMockSettings({ apiProvider: provider, translationMode: mode, grammarTranslationEnabled: true });
    mockedGetSettings.mockResolvedValue(settings);
    const controller = new AbortController();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const performanceClock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    mockedCallWithSystem.mockImplementationOnce(async () => {
      clock.mockReturnValue(2200);
      performanceClock.mockReturnValue(2200);
      throw TransportError.outputLimit();
    }).mockResolvedValueOnce(JSON.stringify({ fullText: '仔细阅读这本书。' }));

    try {
      const result = await TranslationService.translate(recoveryRequest(mode), {
        signal: controller.signal, timeoutMs, maxTokens: 2000,
      });
      expect(result).toMatchObject({ fullText: '仔细阅读这本书。', sentences: [] });
      expect(result.grammarPoints).toBeUndefined();
      expect(result.words).toEqual([expect.objectContaining({ original: 'book', translation: '书；预订', position: [11, 15] })]);
      expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
      const [system, prompt, key, snapshot, retry, options] = mockedCallWithSystem.mock.calls[1];
      expect(system).not.toMatch(/CET|grammar|语法|分析/i);
      expect(`${system}\n${prompt}`).toContain('fullText');
      expect(prompt).toContain(text);
      expect(key).toBe('sk-test');
      expect(snapshot).toBe(settings);
      expect(retry).toMatchObject({ maxRetries: 0 });
      expect(options).toMatchObject({ signal: controller.signal, maxTokens: 2000 });
      expect(options?.timeoutMs).toBe(timeoutMs);
      expect(enhancedCache.set).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      performanceClock.mockRestore();
    }
  });

  it('恢复沿用轻量词汇作用域中的语境释义，词位置基于未归一化原文', async () => {
    const originalText = 'The  internationalization accelerated.';
    const profile = makeProfile({ unknownWords: [makeEntry('internationalization', originalText, '')] });
    const settings = createMockSettings({ apiProvider: 'custom', translationMode: 'bilingual' });
    mockedGetSettings.mockResolvedValue(settings);
    const scope = enhancedCache.generateHash('', 'inline-only', { settings, userLevel: profile, engine: 'llm' });
    storeWordSense('internationalization', originalText, '国际化', scope);
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit())
      .mockResolvedValueOnce(JSON.stringify({ fullText: '国际化加速了。' }));

    const result = await TranslationService.translate(makeRequest({ text: originalText, context: '', mode: 'bilingual', userLevel: profile }));

    expect(result.words).toEqual([expect.objectContaining({ original: 'internationalization', translation: '国际化', position: [5, 25] })]);
    expect(result.fullText).toBe('国际化加速了。');
    expect(result.grammarPoints).toBeUndefined();
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('纯全文恢复忽略夹带的无效分析数组，只保留本地词汇', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ grammarTranslationEnabled: true }));
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit()).mockResolvedValueOnce(JSON.stringify({
      fullText: '仔细阅读这本书。',
      words: [null, { original: 'book', translation: '伪造词义', position: [11, 15] }],
      sentences: [null],
      grammarPoints: [null],
    }));

    const result = await TranslationService.translate(recoveryRequest());

    expect(result.fullText).toBe('仔细阅读这本书。');
    expect(result.words).toEqual([expect.objectContaining({ original: 'book', translation: '书；预订', position: [11, 15] })]);
    expect(result.sentences).toEqual([]);
    expect(result.grammarPoints).toBeUndefined();
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('inline-only 输出耗尽且候选均有本地释义时直接恢复，不再请求也不缓存', async () => {
    mockedCallWithSystem.mockRejectedValue(TransportError.outputLimit());

    const result = await TranslationService.translate(recoveryRequest('inline-only'));
    expect(result.words).toEqual([expect.objectContaining({ original: 'book', translation: '书；预订' })]);
    expect(result.fullText).toBeUndefined();
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('非输出耗尽错误不切换任务也不缓存', async () => {
    const error = TransportError.unavailable('服务不可用');
    mockedCallWithSystem.mockRejectedValue(error);

    await expect(TranslationService.translate(recoveryRequest())).rejects.toBe(error);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('恢复任务再次输出耗尽后终止，最多调用两次且不缓存', async () => {
    const recoveryError = TransportError.outputLimit();
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit()).mockRejectedValueOnce(recoveryError);

    await expect.soft(TranslationService.translate(recoveryRequest())).rejects.toBe(recoveryError);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('首次任务耗尽时原 signal 已取消，不发起恢复也不缓存', async () => {
    const controller = new AbortController();
    mockedCallWithSystem.mockImplementationOnce(async () => {
      controller.abort();
      throw TransportError.outputLimit();
    });

    await expect.soft(TranslationService.translate(recoveryRequest(), { signal: controller.signal }))
      .rejects.toThrow(/abort|取消/i);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });
});

describe('增强缓存短路', () => {
  const request = makeRequest({
    text: 'The unexpected serendipity changed everything overnight.',
    mode: 'bilingual',
  });
  const cachedResult = { words: [], sentences: [], fullText: '已有译文' };

  it('有 Key 时精确命中不触发模糊查询或模型请求', async () => {
    vi.mocked(enhancedCache.get).mockResolvedValueOnce(cachedResult);

    const result = await TranslationService.translate(request);

    expect(result).toBe(cachedResult);
    expect(enhancedCache.fuzzyGet).not.toHaveBeenCalled();
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('即使近似缓存声称命中，仍重新请求并写入新精确项', async () => {
    vi.mocked(enhancedCache.fuzzyGet).mockResolvedValueOnce({ result: cachedResult, similarity: 0.96 });
    mockedCallWithSystem.mockResolvedValueOnce(JSON.stringify({ fullText: '新译文', words: [], sentences: [] }));

    const result = await TranslationService.translate(request);

    expect(result.fullText).toBe('新译文');
    expect(enhancedCache.fuzzyGet).not.toHaveBeenCalled();
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).toHaveBeenCalledTimes(1);
  });

  it('无 Key 时精确命中不请求免费翻译网络', async () => {
    mockedGetApiKey.mockResolvedValue('');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      vi.mocked(enhancedCache.get).mockResolvedValueOnce(cachedResult);

      const result = await TranslationService.translate(request);

      expect(result).toBe(cachedResult);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(enhancedCache.set).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('行内输出耗尽后的候选词义恢复', () => {
  const text = '  house  book\n internationalization accelerated.';
  const request = () => makeRequest({ text, context: '', userLevel: makeProfile({
    estimatedVocabulary: 3000, knownWords: ['house', 'accelerated'],
    unknownWords: [makeEntry('book', text, '本地书义')],
  }) });
  const content = JSON.stringify({ words: [
    { original: 'internationalization', translation: '国际化', position: [0, 1] },
    { original: 'house', translation: '不应重新翻译' },
    { original: 'book', translation: '不应覆盖本地' },
    { original: 'extraneous', translation: '候选外词' },
  ], fullText: '不应采纳全文', grammarPoints: [{ original: 'house' }] });

  it('只恢复未解候选，保留原设置和选项、本地释义及原文位置，不缓存分析', async () => {
    const settings = createMockSettings({ apiProvider: 'custom', customModelName: 'space-bunny',
      grammarTranslationEnabled: true, phraseTranslationEnabled: true });
    mockedGetSettings.mockResolvedValue(settings);
    const controller = new AbortController();
    const options = { signal: controller.signal, timeoutMs: 5000, maxTokens: 2000 };
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit()).mockResolvedValueOnce(content);

    const result = await TranslationService.translate(request(), options);

    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    const [system, prompt, key, sentSettings, retry, sentOptions] = mockedCallWithSystem.mock.calls[1];
    expect(system).toContain('禁止整句翻译');
    expect(prompt).not.toContain('fullText');
    expect(prompt).not.toContain('grammarPoints');
    expect(prompt.split('候选词：')[1]).not.toMatch(/house|book|extraneous/);
    expect(key).toBe('sk-test');
    expect(sentSettings).toBe(settings);
    expect(retry?.maxRetries).toBe(0);
    expect(sentOptions).toMatchObject(options);
    expect(result.words.map(word => [word.original, word.translation])).toEqual([
      ['book', '本地书义'], ['internationalization', '国际化'],
    ]);
    for (const word of result.words) expect(text.slice(...word.position)).toBe(word.original);
    expect(result).toMatchObject({ sentences: [], grammarPoints: [], _source: 'llm' });
    expect(result.fullText).toBeUndefined();
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each(['output_limit', 'timeout'] as const)('恢复再次失败 %s 时终止，不递归也不缓存', async kind => {
    const error = kind === 'output_limit' ? TransportError.outputLimit() : TransportError.timeout(5000);
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit()).mockRejectedValueOnce(error);
    await expect(TranslationService.translate(request())).rejects.toBe(error);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each(['首次失败', '恢复响应', '恢复失败'] as const)('%s时取消优先，不接纳迟到结果', async stage => {
    const controller = new AbortController();
    mockedCallWithSystem.mockImplementationOnce(async () => {
      if (stage === '首次失败') controller.abort();
      throw TransportError.outputLimit();
    }).mockImplementationOnce(async () => {
      controller.abort();
      if (stage === '恢复失败') throw TransportError.outputLimit();
      return content;
    });
    await expect(TranslationService.translate(request(), { signal: controller.signal })).rejects.toThrow(/abort|取消/i);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(stage === '首次失败' ? 1 : 2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('本地恢复完成与返回调用方之间取消时，仍优先取消', async () => {
    const controller = new AbortController();
    vi.mocked(enhancedCache.generateHash).mockReturnValueOnce('request-cache').mockImplementationOnce(() => {
      queueMicrotask(() => controller.abort());
      return 'sense-scope';
    });
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit());
    await expect(TranslationService.translate(makeRequest({
      text: 'The house is already familiar.', context: '', userLevel: makeProfile(),
    }), { signal: controller.signal })).rejects.toThrow(/abort|取消/i);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each(['not json', 'null', '{}', '{"words":null}', '{"words":[]}',
    '{"words":[null,{"original":"internationalization","translation":123}]}',
    '{"words":[{"original":"house","translation":"已知词"},{"original":"extraneous","translation":"无关词"}]}',
  ])('恢复返回无有效目标词义 %s 且没有本地结果时明确失败', async value => {
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit()).mockResolvedValueOnce(value);
    await expect(TranslationService.translate(makeRequest({
      text: 'The internationalization of markets accelerated.', context: '',
      userLevel: makeProfile({ estimatedVocabulary: 3000, knownWords: ['house', 'markets', 'accelerated'] }),
    }))).rejects.toThrow();
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('没有本地候选时原地恢复空词表，不凭空请求', async () => {
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit());
    const result = await TranslationService.translate(makeRequest({
      text: 'The house is already familiar.', context: '', userLevel: makeProfile(),
    }));
    expect(result.words).toEqual([]);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });
});

describe('Ollama 轻量词汇模式（仅译候选词）', () => {
  function makeOllamaSettings(overrides: Partial<UserSettings> = {}): UserSettings {
    return createMockSettings({
      apiProvider: 'ollama',
      phraseTranslationEnabled: false,
      grammarTranslationEnabled: false,
      ...overrides,
    });
  }

  const HARD_TEXT = 'The internationalization of markets accelerated.';
  const HARD_PROFILE = makeProfile({ estimatedVocabulary: 3000, knownWords: [] });

  it('候选词仅请求语境释义：提示词不含位置/难度/全文要求，位置由本地计算并验证', async () => {
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem.mockResolvedValue(
      JSON.stringify({ words: [{ original: 'internationalization', translation: '国际化' }] })
    );

    const request = makeRequest({ text: HARD_TEXT, context: '', userLevel: HARD_PROFILE });
    const result = await TranslationService.translate(request);

    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    const [systemPrompt, userPrompt] = mockedCallWithSystem.mock.calls[0];
    expect(userPrompt).toContain('internationalization');
    expect(userPrompt).toContain(HARD_TEXT);
    // 轻量模式不要求模型生成位置、难度、全文
    expect(userPrompt).not.toContain('position');
    expect(userPrompt).not.toContain('fullText');
    expect(userPrompt).not.toContain('难度');
    expect(systemPrompt).not.toContain('难度等级');
    // 实测反馈：明确要求短义项，禁止整句翻译（JSON 合规 ≠ 语义正确）
    expect(systemPrompt).toContain('禁止整句翻译');
    expect(userPrompt).toContain('简短中文义项');

    // 模型只返回了词与释义（无位置/难度），位置应由本地计算得出并验证
    const word = result.words.find((w) => w.original.toLowerCase() === 'internationalization');
    expect(word).toBeDefined();
    expect(word!.translation).toBe('国际化');
    expect(HARD_TEXT.slice(word!.position[0], word!.position[1]).toLowerCase()).toBe(
      'internationalization'
    );
    expect(word!.difficulty).toBeGreaterThanOrEqual(1);
    expect(word!.difficulty).toBeLessThanOrEqual(10);
    // 模型语境释义被采纳：来源标记为 llm，不伪称纯 local
    expect(result._source).toBe('llm');
  });

  it('模型的语境释义写入语境缓存：同词同语境再次查询不再调用模型', async () => {
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem.mockResolvedValue(
      JSON.stringify({ words: [{ original: 'internationalization', translation: '国际化' }] })
    );

    const request = makeRequest({ text: HARD_TEXT, context: '', userLevel: HARD_PROFILE });
    await TranslationService.translate(request);
    await TranslationService.translate(request);

    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
  });

  it('段落写入的模型义可供同用户同设置的原句查词复用', async () => {
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem.mockResolvedValue(JSON.stringify({
      words: [{ original: 'internationalization', translation: '国际化' }],
    }));

    await TranslationService.translate(makeRequest({ text: HARD_TEXT, context: '', userLevel: HARD_PROFILE }));
    const result = await TranslationService.translate(makeRequest({
      text: 'internationalization', context: HARD_TEXT, userLevel: HARD_PROFILE,
    }));

    expect(result.words[0].translation).toBe('国际化');
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
  });

  it('配置或用户等级切换后，同句同词必须重新获取模型语境释义', async () => {
    const generateHash = vi.mocked(enhancedCache.generateHash);
    generateHash.mockImplementation((text, mode, scope) =>
      JSON.stringify([text, mode, scope?.settings.customModelName, scope?.userLevel?.estimatedVocabulary]));
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem
      .mockResolvedValueOnce(JSON.stringify({ words: [{ original: 'internationalization', translation: '用户甲义' }] }))
      .mockResolvedValueOnce(JSON.stringify({ words: [{ original: 'internationalization', translation: '用户乙义' }] }))
      .mockResolvedValueOnce(JSON.stringify({ words: [{ original: 'internationalization', translation: '新模型义' }] }));
    try {
      mockedGetSettings.mockResolvedValue(makeOllamaSettings({ customModelName: 'model-a' }));
      const request = makeRequest({ text: HARD_TEXT, context: '', userLevel: HARD_PROFILE });
      await TranslationService.translate(request);
      const otherProfile = await TranslationService.translate({
        ...request, userLevel: makeProfile({ estimatedVocabulary: 2000, knownWords: [] }),
      });
      mockedGetSettings.mockResolvedValue(makeOllamaSettings({ customModelName: 'model-b' }));
      const otherModel = await TranslationService.translate(request);

      expect(otherProfile.words[0].translation).toBe('用户乙义');
      expect(otherModel.words[0].translation).toBe('新模型义');
      expect(mockedCallWithSystem).toHaveBeenCalledTimes(3);
    } finally {
      generateHash.mockImplementation((text, mode) => `h:${mode}:${text}`);
    }
  });

  it('清空缓存之前启动的轻量请求，迟到结果不得回填词义缓存', async () => {
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');
    let generation = 0;
    const getGeneration = vi.mocked(enhancedCache.getGeneration);
    getGeneration.mockImplementation(() => generation);
    let complete!: (value: string) => void;
    mockedCallWithSystem
      .mockImplementationOnce(() => new Promise<string>((resolve) => { complete = resolve; }))
      .mockResolvedValueOnce(JSON.stringify({ words: [{ original: 'internationalization', translation: '新义' }] }));
    try {
      const request = makeRequest({ text: HARD_TEXT, context: '', userLevel: HARD_PROFILE });
      const pending = TranslationService.translate(request);
      await vi.waitFor(() => expect(mockedCallWithSystem).toHaveBeenCalledTimes(1));
      generation = 1;
      clearWordSenseCache();
      complete(JSON.stringify({ words: [{ original: 'internationalization', translation: '旧义' }] }));
      await pending;
      const next = await TranslationService.translate(request);

      expect(next.words[0].translation).toBe('新义');
      expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    } finally {
      getGeneration.mockImplementation(() => 0);
    }
  });

  it('等待段落缓存读取期间清空后，旧请求不得写回词义', async () => {
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');
    let generation = 0;
    const getGeneration = vi.mocked(enhancedCache.getGeneration);
    const get = vi.mocked(enhancedCache.get);
    getGeneration.mockImplementation(() => generation);
    let release!: (value: null) => void;
    get.mockImplementationOnce(() => new Promise<null>(resolve => { release = resolve; }));
    mockedCallWithSystem.mockResolvedValue(JSON.stringify({
      words: [{ original: 'internationalization', translation: '国际化' }],
    }));
    try {
      const request = makeRequest({ text: HARD_TEXT, context: '', userLevel: HARD_PROFILE });
      const pending = TranslationService.translate(request);
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
      generation = 1;
      clearWordSenseCache();
      release(null);
      await pending;
      await TranslationService.translate(makeRequest({
        text: 'internationalization', context: HARD_TEXT, userLevel: HARD_PROFILE,
      }));

      expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    } finally {
      getGeneration.mockImplementation(() => 0);
    }
  });

  it.each(['', 'This article describes internationalization.'])('外部语境为 %s 时，不同原句不共用词义缓存', async context => {
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem
      .mockResolvedValueOnce(JSON.stringify({ words: [{ original: 'internationalization', translation: '市场国际化' }] }))
      .mockResolvedValueOnce(JSON.stringify({ words: [{ original: 'internationalization', translation: '软件国际化' }] }));

    await TranslationService.translate(makeRequest({ text: HARD_TEXT, context, userLevel: HARD_PROFILE }));
    const other = await TranslationService.translate(makeRequest({
      text: 'The internationalization of software accelerated.', context, userLevel: HARD_PROFILE,
    }));

    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(other.words.find(word => word.original === 'internationalization')?.translation).toBe('软件国际化');
  });

  it.each([null, {}, [], 123, '', '   '].map(translation => ({ translation })))('拒绝非法释义 $translation，不把它字符串化或伪装为本地成功', async ({ translation }) => {
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem.mockResolvedValue(JSON.stringify({ words: [{ original: 'internationalization', translation }] }));
    await expect(TranslationService.translate(makeRequest({
      text: HARD_TEXT, context: '', userLevel: HARD_PROFILE,
    }))).rejects.toThrow('语境释义');
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each(['not json', '{}', '{"words":[]}', '{"words":[null]}', '{"words":[{"original":"unrelated","translation":"其他"}]}'])('无有效目标词义的响应 %s 明确失败', async content => {
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem.mockResolvedValue(content);
    await expect(TranslationService.translate(makeRequest({
      text: HARD_TEXT, context: '', userLevel: HARD_PROFILE,
    }))).rejects.toThrow('语境释义');
  });

  it('单个非法条目不丢弃其他有效词义', async () => {
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem.mockResolvedValue(JSON.stringify({ words: [
      null, { original: 123, translation: '无效' },
      { original: 'internationalization', translation: ' 国际化 ' },
    ] }));
    const result = await TranslationService.translate(makeRequest({ text: HARD_TEXT, context: '', userLevel: HARD_PROFILE }));
    expect(result.words).toHaveLength(1);
    expect(result.words[0].translation).toBe('国际化');
    expect(result._source).toBe('llm');
  });

  it('候选全部本地可解时不调用模型', async () => {
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');

    const profile = makeProfile({
      estimatedVocabulary: 99999,
      unknownWords: [makeEntry('ubiquitous', 'The ubiquitous smartphone is very good.', '无处不在的')],
    });
    const request = makeRequest({
      text: 'The ubiquitous smartphone is very good.',
      context: '',
      userLevel: profile,
    });

    const result = await TranslationService.translate(request);

    expect(mockedCallWithSystem).not.toHaveBeenCalled();
    expect(result.words).toHaveLength(1);
    expect(result.words[0].translation).toBe('无处不在的');
    // 纯本地解决：来源标记为 local
    expect(result._source).toBe('local');
  });

  it('轻量响应解析失败：没有可用释义时明确失败，日志不含模型正文', async () => {
    const sentinel = 'SENTINEL-MODEL-RESPONSE';
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');
    // 非法 JSON（JSON.parse 的 SyntaxError 在部分运行时会附带原文片段）
    mockedCallWithSystem.mockResolvedValue(`{ ${sentinel} }`);

    await expect(TranslationService.translate(
      makeRequest({ text: HARD_TEXT, context: '', userLevel: HARD_PROFILE })
    )).rejects.toThrow('语境释义');

    // 解析失败只允许固定文案单参数日志，不得传入原始 error 对象
    const logged = vi.mocked(logger.warn).mock.calls
      .map((c) => c.map(String).join(' '))
      .join('\n');
    expect(logged).not.toContain(sentinel);
    const parseFailureCalls = vi.mocked(logger.warn).mock.calls.filter((c) =>
      String(c[0]).includes('轻量词汇响应解析失败')
    );
    expect(parseFailureCalls.length).toBeGreaterThan(0);
    for (const call of parseFailureCalls) {
      expect(call).toHaveLength(1);
    }
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('模型返回的候选之外词汇被丢弃（候选闭环校验）', async () => {
    mockedGetSettings.mockResolvedValue(makeOllamaSettings());
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem.mockResolvedValue(
      JSON.stringify({
        words: [
          { original: 'internationalization', translation: '国际化' },
          { original: 'marketsqq', translation: '幻觉词' },
        ],
      })
    );

    const request = makeRequest({ text: HARD_TEXT, context: '', userLevel: HARD_PROFILE });
    const result = await TranslationService.translate(request);

    expect(result.words.find((w) => w.original === 'marketsqq')).toBeUndefined();
    expect(result.words).toHaveLength(1);
  });

  it.each(['grammarTranslationEnabled', 'phraseTranslationEnabled'] as const)('%s 开启时不进入轻量模式', async feature => {
    mockedGetSettings.mockResolvedValue(
      makeOllamaSettings({ [feature]: true })
    );
    mockedCallWithSystem.mockResolvedValue(
      JSON.stringify({ fullText: '全文', words: [], sentences: [], grammarPoints: [] })
    );

    const request = makeRequest({ text: HARD_TEXT, context: '', userLevel: HARD_PROFILE });
    await TranslationService.translate(request);

    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    const [systemPrompt] = mockedCallWithSystem.mock.calls[0];
    // 完整流程的系统提示词包含难度评级要求，轻量模式没有
    expect(systemPrompt).toContain('难度等级');
  });
});

describe('options 贯穿与小接口', () => {
  it('预先取消的单词查询不读配置或返回本地命中', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(TranslationService.translate(makeRequest(), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(mockedGetSettings).not.toHaveBeenCalled();
  });

  it.each(['hybrid', 'deepl'] as const)('%s 入口透传取消选项', async provider => {
    const settings = provider === 'hybrid'
      ? { ...createMockSettings(), hybridTranslation: { enabled: true } }
      : createMockSettings({ apiProvider: 'deepl', apiConfigs: [{ id: 'deepl', name: 'DeepL', provider: 'deepl', apiKey: 'fixture', tested: false, createdAt: 0 }] });
    mockedGetSettings.mockResolvedValue(settings as UserSettings);
    const options = { signal: new AbortController().signal, timeoutMs: 42 };
    const request = makeRequest({ text: 'An entire paragraph for this test.' });
    const service = provider === 'hybrid' ? HybridTranslationService : DeepLTranslationService;
    vi.mocked(service.translate).mockResolvedValue({ words: [], sentences: [] });
    await TranslationService.translate(request, options);
    expect(service.translate).toHaveBeenCalledWith(request, options);
  });

  it('读取配置期间取消不再进入混合服务', async () => {
    const controller = new AbortController();
    mockedGetSettings.mockImplementationOnce(async () => {
      controller.abort();
      return { ...createMockSettings(), hybridTranslation: { enabled: true } } as UserSettings;
    });
    await expect(TranslationService.translate(makeRequest({ text: 'A complete paragraph.' }), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(HybridTranslationService.translate).not.toHaveBeenCalled();
  });

  it('缓存读取期间取消，命中结果也不能作为成功返回', async () => {
    const controller = new AbortController();
    vi.mocked(enhancedCache.get).mockImplementationOnce(async () => {
      controller.abort();
      return { words: [], sentences: [] };
    });
    await expect(TranslationService.translate(makeRequest({ text: 'serendipity' }), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
  });

  it('配置日志不输出可能含凭据的自定义 URL', async () => {
    const sentinel = 'SENTINEL-URL-CREDENTIAL';
    mockedGetSettings.mockResolvedValue(createMockSettings({ customApiUrl: `https://example.test/v1?key=${sentinel}` }));
    mockedCallWithSystem.mockResolvedValue(JSON.stringify({ words: [], sentences: [] }));
    await TranslationService.translate(makeRequest({ text: 'serendipity' }));
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(sentinel);
  });

  it('标准 LLM 解析失败时，日志不输出 SyntaxError 中的响应正文', async () => {
    const sentinel = 'SYNTH_PII';
    mockedCallWithSystem.mockResolvedValue(sentinel);
    await expect(TranslationService.translate(makeRequest({ text: 'serendipity' })))
      .rejects.toThrow('Failed to parse translation response');
    const logged = vi.mocked(logger.error).mock.calls.flatMap(args => args.map(String)).join('\n');
    expect(logged).not.toContain(sentinel);
  });

  it('quickTranslate 预先取消时不返回本地结果', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(TranslationService.quickTranslate('house', '', createMockSettings(), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(DeepLTranslationService.quickTranslate).not.toHaveBeenCalled();
  });

  it('quickTranslate 的 fallback 透传 options', async () => {
    vi.mocked(DeepLTranslationService.quickTranslate).mockResolvedValue('机缘巧合');
    const options = { signal: new AbortController().signal, timeoutMs: 123 };
    const settings = createMockSettings();
    await TranslationService.quickTranslate('serendipity', 'sk-test', settings, options);
    expect(DeepLTranslationService.quickTranslate).toHaveBeenCalledWith('serendipity', options, settings);
  });

  it('取消后不落缓存且不吞掉取消错误', async () => {
    const controller = new AbortController();
    mockedCallWithSystem.mockImplementation(async () => {
      controller.abort();
      return JSON.stringify({ fullText: 'ok', words: [], sentences: [] });
    });

    await expect(
      TranslationService.translate(makeRequest({ text: 'serendipity' }), { signal: controller.signal })
    ).rejects.toThrow();

    // 已取消：不得把结果写入缓存（后续重试也不该读到被取消请求的产物）
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('translate 的 options 透传到 callWithSystem 末位参数', async () => {
    mockedCallWithSystem.mockResolvedValue(
      JSON.stringify({ fullText: 'ok', words: [], sentences: [] })
    );

    const controller = new AbortController();
    await TranslationService.translate(makeRequest({ text: 'serendipity' }), {
      signal: controller.signal,
      timeoutMs: 5000,
    });

    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    // 第 6 参为 requestOptions（llm-transport 落地 TranslationApiRequestOptions 前，先以运行时位置传递）
    const callArgs = mockedCallWithSystem.mock.calls[0] as unknown as unknown[];
    const requestOptions = callArgs[5] as { signal?: AbortSignal; timeoutMs?: number } | undefined;
    expect(requestOptions).toMatchObject({ signal: controller.signal, timeoutMs: 5000 });
  });

  it('quickTranslate 本地命中时不调用 DeepL', async () => {
    const result = await TranslationService.quickTranslate('house', '', createMockSettings());

    expect(result).toBe('房子');
    expect(DeepLTranslationService.quickTranslate).not.toHaveBeenCalled();
  });

  it('快速查词沿用请求配置快照，不在回退时重读切换后的服务商', async () => {
    const settings = createMockSettings({ apiProvider: 'deepl', apiConfigs: [
      { id: 'deepl', name: 'DeepL', provider: 'deepl', apiKey: 'KEY_A', tested: true },
    ] });
    setOfflineWordSource(null);
    vi.mocked(DeepLTranslationService.quickTranslate).mockResolvedValue('译文');

    await TranslationService.quickTranslate('serendipity', 'KEY_A', settings);

    expect(DeepLTranslationService.quickTranslate).toHaveBeenCalledWith('serendipity', undefined, settings);
  });

  it('quickTranslate 本地未命中时回退 DeepL', async () => {
    vi.mocked(DeepLTranslationService.quickTranslate).mockResolvedValue('机缘巧合');

    const settings = createMockSettings();
    const result = await TranslationService.quickTranslate('serendipity', 'k', settings);

    expect(result).toBe('机缘巧合');
    expect(DeepLTranslationService.quickTranslate).toHaveBeenCalledWith('serendipity', undefined, settings);
  });

  it('translatePlainText 解析 Google 标准响应，完整保留各句译文', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'free_google_translate' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      [['你好世界。', 'Hello world.', null, null, 1], ['再见。', 'Goodbye.', null, null, 1]], null, 'en',
    ]))));
    try {
      await expect(TranslationService.translatePlainText('Hello world. Goodbye.')).resolves.toBe('你好世界。再见。');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('translatePlainText 的超时预算涵盖不返回的免费引擎', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'free_google_translate' }));
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const pending = TranslationService.translatePlainText('hello world', { timeoutMs: 25 });
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
      expect(enhancedCache.set).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('translatePlainText：纯文本 MT 小接口，取消信号贯穿 fetch', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'free_google_translate' }));
    mockedGetApiKey.mockResolvedValue('');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([[[['你好世界', 'hello world', null, null, 3]]], null, 'en']), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const text = await TranslationService.translatePlainText('hello world', {
      signal: controller.signal,
    });

    expect(text).toBe('你好世界');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('translate.googleapis.com');
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    expect((init as RequestInit).signal?.aborted).toBe(false);
    vi.unstubAllGlobals();
  });

  it('storeWordSense 预置的同设置同用户语境缓存可直接服务单词查词', async () => {
    const request = makeRequest({ text: 'bank', context: 'sat by the river bank' });
    const settings = createMockSettings();
    mockedGetSettings.mockResolvedValue(settings);
    const cacheScope = enhancedCache.generateHash('', 'inline-only', {
      settings, userLevel: request.userLevel, engine: 'llm',
    });
    storeWordSense('bank', request.context, '河岸', cacheScope);

    const result = await TranslationService.translate(request);

    expect(result.words[0].translation).toBe('河岸');
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
  });
});
