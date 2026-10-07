/**
 * DeepLTranslationService 测试
 *
 * 覆盖纯函数部分：extractWordsFromText, isCommonWord, parseWordAnalysis, parseResponse
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepLTranslationService } from '@/background/deeplTranslation';

// Mock dependencies
vi.mock('@/background/storage', () => ({
  StorageManager: {
    getSettings: vi.fn(),
    getApiKey: vi.fn(),
  },
}));

vi.mock('@/background/translationApi', () => ({
  TranslationApiService: {
    quickTranslate: vi.fn(),
    callWithSystem: vi.fn(),
  },
}));

vi.mock('@/background/enhancedCache', () => ({
  enhancedCache: {
    initialize: vi.fn(),
    getGeneration: vi.fn().mockReturnValue(0),
    generateHash: vi.fn().mockReturnValue('test-cache-key'),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('@/shared/performance', () => ({
  recordMetric: vi.fn(),
  MetricType: {
    CACHE_OPERATION: 'cache_operation',
    API_RESPONSE_TIME: 'api_response_time',
    TRANSLATION_TOTAL_TIME: 'translation_total_time',
  },
}));

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    generateCacheKey: vi.fn((text: string) => `cache:${text}`),
    retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
});

vi.mock('@/background/textComplexityAnalyzer', () => ({
  TextComplexityAnalyzer: {
    analyze: vi.fn(() => ({ level: 'intermediate' })),
  },
}));

vi.mock('@/shared/prompts', () => ({
  TranslationPromptBuilder: class {
    build() {
      return { systemPrompt: 'system', userPrompt: 'user' };
    }
    constructor() {}
  },
  promptVersionManager: {
    hasVersion: vi.fn(() => false),
    getTemplate: vi.fn(),
  },
}));

import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { enhancedCache } from '@/background/enhancedCache';
import { TransportError } from '@/shared/utils/translationErrors';
import { logger } from '@/shared/utils';
import type { TranslationRequest, TranslationResult, UserSettings } from '@/shared/types';

const defaultSettings: UserSettings = {
  apiProvider: 'openai',
  theme: 'system',
  phraseTranslationEnabled: true,
  grammarTranslationEnabled: true,
  apiConfigs: [],
};

describe('DeepLTranslationService — 取消与超时', () => {
  const request: TranslationRequest = {
    text: 'Hello world',
    mode: 'bilingual',
    userLevel: { estimatedVocabulary: 3000 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('DeepL 请求取消时不回退到 LLM，也不写缓存', async () => {
    const settingsWithDeepLKey = {
      ...defaultSettings,
      hybridTranslation: { traditionalProvider: 'deepl', traditionalApiKey: 'deepl-key' },
    };
    const controller = new AbortController();
    vi.mocked(StorageManager.getSettings).mockResolvedValue(settingsWithDeepLKey);
    vi.mocked(StorageManager.getApiKey).mockResolvedValue('llm-key');
    vi.mocked(enhancedCache.initialize).mockResolvedValue(undefined);
    vi.mocked(enhancedCache.get).mockResolvedValue(null);
    vi.mocked(TranslationApiService.quickTranslate).mockRejectedValue(TransportError.cancelled());
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue('{"words":[],"sentences":[]}');

    await expect(DeepLTranslationService.translate(request, { signal: controller.signal }))
      .rejects.toMatchObject({ kind: 'cancelled' });

    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(
      request.text,
      'deepl-key',
      expect.objectContaining({ apiProvider: 'deepl' }),
      { signal: controller.signal }
    );
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('快速翻译取消时不降级到 LLM', async () => {
    const settingsWithDeepLKey = {
      ...defaultSettings,
      hybridTranslation: { traditionalProvider: 'deepl', traditionalApiKey: 'deepl-key' },
    };
    const controller = new AbortController();
    vi.mocked(StorageManager.getSettings).mockResolvedValue(settingsWithDeepLKey);
    vi.mocked(StorageManager.getApiKey).mockResolvedValue('llm-key');
    vi.mocked(TranslationApiService.quickTranslate).mockRejectedValue(TransportError.cancelled());

    await expect(DeepLTranslationService.quickTranslate('hello', { signal: controller.signal }))
      .rejects.toMatchObject({ kind: 'cancelled' });

    expect(TranslationApiService.quickTranslate).toHaveBeenCalledTimes(1);
  });
});

describe('DeepLTranslationService — DeepL 回退缓存', () => {
  const request: TranslationRequest = {
    text: 'Hello world',
    mode: 'bilingual',
    userLevel: { estimatedVocabulary: 3000 },
  };
  const settingsWithDeepLKey: UserSettings = {
    ...defaultSettings,
    hybridTranslation: { traditionalProvider: 'deepl', traditionalApiKey: 'deepl-key' },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(StorageManager.getSettings).mockResolvedValue(settingsWithDeepLKey);
    vi.mocked(StorageManager.getApiKey).mockResolvedValue('llm-key');
    vi.mocked(enhancedCache.initialize).mockResolvedValue(undefined);
    vi.mocked(enhancedCache.getGeneration).mockReturnValue(0);
    vi.mocked(enhancedCache.generateHash).mockReturnValue('deepl-cache-key');
    vi.mocked(enhancedCache.get).mockResolvedValue(null);
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(
      JSON.stringify({ fullText: 'LLM 译文', words: [], sentences: [] })
    );
  });

  it('已配置 DeepL 密钥时临时失败的回退不污染缓存，恢复后缓存 DeepL 结果', async () => {
    let stored: TranslationResult | null = null;
    vi.mocked(enhancedCache.get).mockImplementation(async () => stored);
    vi.mocked(enhancedCache.set).mockImplementation(async (_key, result) => {
      stored = { ...result, cached: true };
    });
    vi.mocked(TranslationApiService.quickTranslate)
      .mockRejectedValueOnce(new Error('DeepL 暂时不可用'))
      .mockResolvedValue('DeepL 译文');

    expect((await DeepLTranslationService.translate(request)).fullText).toBe('LLM 译文');
    expect(enhancedCache.set).not.toHaveBeenCalled();

    expect((await DeepLTranslationService.translate(request)).fullText).toBe('DeepL 译文');
    expect(enhancedCache.set).toHaveBeenCalledWith(
      'deepl-cache-key', expect.objectContaining({ fullText: 'DeepL 译文' }),
      request.mode, expect.any(String), 'deepl', 0
    );
    expect((await DeepLTranslationService.translate(request)).fullText).toBe('DeepL 译文');
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledTimes(2);
  });

  it('已配置 DeepL 密钥时跳过旧的 LLM 回退缓存并重新尝试 DeepL', async () => {
    vi.mocked(enhancedCache.get).mockResolvedValue({
      words: [], sentences: [], fullText: '旧的 LLM 译文', cached: true, _source: 'llm',
    });
    vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('恢复的 DeepL 译文');

    const result = await DeepLTranslationService.translate(request);

    expect(result.fullText).toBe('恢复的 DeepL 译文');
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledOnce();
    expect(enhancedCache.set).toHaveBeenCalledWith(
      'deepl-cache-key', expect.objectContaining({ fullText: '恢复的 DeepL 译文' }),
      request.mode, expect.any(String), 'deepl', 0
    );
  });

  it('旧回退缓存存在且 DeepL 仍故障时重新回退，不再次污染缓存', async () => {
    vi.mocked(enhancedCache.get).mockResolvedValue({
      words: [], sentences: [], fullText: '旧的 LLM 译文', cached: true, _source: 'llm',
    });
    vi.mocked(TranslationApiService.quickTranslate).mockRejectedValue(new Error('DeepL 暂时不可用'));

    expect((await DeepLTranslationService.translate(request)).fullText).toBe('LLM 译文');

    expect(TranslationApiService.quickTranslate).toHaveBeenCalledOnce();
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledOnce();
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('DeepL 返回空译文时回退，但不缓存 LLM 译文', async () => {
    vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('');

    expect((await DeepLTranslationService.translate(request)).fullText).toBe('LLM 译文');

    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('未配置 DeepL 密钥时保留 LLM 回退缓存', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue(defaultSettings);

    expect((await DeepLTranslationService.translate(request)).fullText).toBe('LLM 译文');

    expect(TranslationApiService.quickTranslate).not.toHaveBeenCalled();
    expect(enhancedCache.set).toHaveBeenCalledWith(
      'deepl-cache-key', expect.objectContaining({ fullText: 'LLM 译文' }),
      request.mode, expect.any(String), 'llm', 0
    );
  });

  it('从 apiConfigs 读取密钥时也不缓存临时回退', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue({
      ...defaultSettings,
      apiConfigs: [
        { id: 'deepl', name: 'DeepL', provider: 'deepl', apiKey: 'config-key', tested: true },
        { id: 'llm', name: '模型', provider: 'openai', apiKey: 'separate-llm-key', tested: true },
      ],
      activeApiConfigId: 'deepl',
    });
    vi.mocked(TranslationApiService.quickTranslate).mockRejectedValue(new Error('DeepL 暂时不可用'));

    expect((await DeepLTranslationService.translate(request)).fullText).toBe('LLM 译文');
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 'separate-llm-key',
      expect.objectContaining({ apiProvider: 'openai' }), undefined, undefined
    );

    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(
      request.text, 'config-key', expect.objectContaining({ apiProvider: 'deepl' }), undefined
    );
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each(['translate', 'quickTranslate'] as const)('%s 的 DeepL 密钥不继承 LLM 自定义端点', async (method) => {
    const settings: UserSettings = {
      ...settingsWithDeepLKey,
      customApiUrl: 'https://llm-gateway.example/v1', secondaryApiKey: 'LLM-SECRET',
    };
    vi.mocked(StorageManager.getSettings).mockResolvedValue(settings);
    vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('DeepL 译文');

    if (method === 'translate') await DeepLTranslationService.translate(request);
    else await DeepLTranslationService.quickTranslate('hello');

    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(
      method === 'translate' ? request.text : 'hello', 'deepl-key',
      expect.objectContaining({ apiProvider: 'deepl', customApiUrl: '', secondaryApiKey: '', activeApiConfigId: undefined }), undefined
    );
  });

  it.each(['google_translate', 'youdao'] as const)('显式选中的 %s 可用于快速查词，不要求 LLM 回退', async provider => {
    const settings: UserSettings = {
      ...defaultSettings, apiProvider: provider, activeApiConfigId: 'selected',
      customApiUrl: 'https://unrelated-llm.example/v1',
      apiConfigs: [{ id: 'selected', name: '传统翻译', provider, apiKey: 'TRAD_KEY', tested: true }],
    };
    vi.mocked(StorageManager.getSettings).mockResolvedValue(settings);
    vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('传统词义');

    expect(await DeepLTranslationService.quickTranslate('unknownword')).toBe('传统词义');
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(
      'unknownword', 'TRAD_KEY', expect.objectContaining({ apiProvider: provider, customApiUrl: '' }), undefined
    );
  });

  it('独立有道密钥不能继承无密钥的有道配置端点', async () => {
    const settings: UserSettings = {
      ...defaultSettings, apiProvider: 'youdao', activeApiConfigId: 'empty',
      apiConfigs: [{ id: 'empty', name: '旧端点', provider: 'youdao', apiKey: '', apiUrl: 'https://untrusted.example/v1', tested: false }],
      hybridTranslation: { traditionalProvider: 'youdao', traditionalApiKey: 'INDEPENDENT_KEY' },
    };
    vi.mocked(StorageManager.getSettings).mockResolvedValue(settings);
    vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('词义');

    await DeepLTranslationService.quickTranslate('unknownword');
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(
      'unknownword', 'INDEPENDENT_KEY', expect.objectContaining({ customApiUrl: '' }), undefined
    );
  });

  it('两个 DeepL 配置共用密钥时优先使用激活项的端点', async () => {
    const settings: UserSettings = {
      ...defaultSettings, apiProvider: 'deepl', activeApiConfigId: 'b',
      apiConfigs: [
        { id: 'a', name: 'A', provider: 'deepl', apiKey: 'SAME_KEY', apiUrl: 'https://a.example/v2/translate', tested: true },
        { id: 'b', name: 'B', provider: 'deepl', apiKey: 'SAME_KEY', apiUrl: 'https://b.example/v2/translate', tested: true },
      ],
    };
    vi.mocked(StorageManager.getSettings).mockResolvedValue(settings);
    vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('译文');

    await DeepLTranslationService.quickTranslate('hello');
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(
      'hello', 'SAME_KEY', expect.objectContaining({ customApiUrl: 'https://b.example/v2/translate', activeApiConfigId: 'b' }), undefined
    );
  });

  it('传入快速翻译配置快照时不读取后来切换的服务商设置', async () => {
    const settingsA: UserSettings = { ...defaultSettings, apiProvider: 'deepl', apiConfigs: [
      { id: 'a', name: 'DeepL A', provider: 'deepl', apiKey: 'DEEPL_A', tested: true },
    ] };
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...defaultSettings, apiProvider: 'openai' });
    vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('A 译文');

    expect(await DeepLTranslationService.quickTranslate('hello', undefined, settingsA)).toBe('A 译文');
    expect(StorageManager.getSettings).not.toHaveBeenCalled();
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(
      'hello', 'DEEPL_A', expect.objectContaining({ apiProvider: 'deepl' }), undefined
    );
  });

  it('快速翻译在 DeepL 成功时不调用 LLM', async () => {
    vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('DeepL 译文');

    expect(await DeepLTranslationService.quickTranslate('hello')).toBe('DeepL 译文');

    expect(TranslationApiService.quickTranslate).toHaveBeenCalledOnce();
    expect(StorageManager.getApiKey).not.toHaveBeenCalled();
  });

  it.each(['异常', '空译文'])('快速翻译 DeepL %s时只回退一次 LLM', async (failure) => {
    const deeplCall = vi.mocked(TranslationApiService.quickTranslate);
    if (failure === '异常') {
      deeplCall.mockRejectedValueOnce(new Error('DeepL 暂时不可用'));
    } else {
      deeplCall.mockResolvedValueOnce('');
    }
    deeplCall.mockResolvedValueOnce('LLM 译文');

    expect(await DeepLTranslationService.quickTranslate('hello')).toBe('LLM 译文');

    expect(deeplCall).toHaveBeenNthCalledWith(
      1, 'hello', 'deepl-key', expect.objectContaining({ apiProvider: 'deepl' }), undefined
    );
    expect(deeplCall).toHaveBeenNthCalledWith(2, 'hello', 'llm-key', settingsWithDeepLKey, undefined);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('快速翻译未配置 DeepL 时直接使用 LLM', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue(defaultSettings);
    vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('LLM 译文');

    expect(await DeepLTranslationService.quickTranslate('hello')).toBe('LLM 译文');
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledOnce();
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith('hello', 'llm-key', defaultSettings, undefined);
  });

  it('快速翻译无 LLM 密钥且 DeepL 故障时抛错', async () => {
    vi.mocked(StorageManager.getApiKey).mockResolvedValue('');
    vi.mocked(TranslationApiService.quickTranslate).mockRejectedValue(new Error('DeepL 暂时不可用'));

    await expect(DeepLTranslationService.quickTranslate('hello')).rejects.toThrow('No LLM fallback configured');

    expect(TranslationApiService.quickTranslate).toHaveBeenCalledOnce();
  });
});

describe('DeepLTranslationService — isCommonWord', () => {
  it('identifies common articles', () => {
    expect((DeepLTranslationService as any).isCommonWord('the')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('and')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('for')).toBe(true);
  });

  it('identifies common pronouns', () => {
    expect((DeepLTranslationService as any).isCommonWord('they')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('their')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('she')).toBe(true);
  });

  it('identifies common modals', () => {
    expect((DeepLTranslationService as any).isCommonWord('could')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('should')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('might')).toBe(true);
  });

  it('rejects uncommon words', () => {
    expect((DeepLTranslationService as any).isCommonWord('serendipity')).toBe(false);
    expect((DeepLTranslationService as any).isCommonWord('ubiquitous')).toBe(false);
    expect((DeepLTranslationService as any).isCommonWord('juxtapose')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect((DeepLTranslationService as any).isCommonWord('THE')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('And')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('Should')).toBe(true);
  });
});

describe('DeepLTranslationService — extractWordsFromText', () => {
  it('extracts words with 4+ characters', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'The quick brown fox jumps over the lazy dog'
    );
    expect(words).toContain('quick');
    expect(words).toContain('brown');
    expect(words).toContain('jumps');
    expect(words).toContain('lazy');
  });

  it('excludes common words', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'the quick and brown'
    );
    expect(words).not.toContain('the');
    expect(words).not.toContain('and');
    expect(words).toContain('quick');
    expect(words).toContain('brown');
  });

  it('filters out short words (less than 4 chars)', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'cat dog fox elephant'
    );
    expect(words).not.toContain('cat');
    expect(words).not.toContain('dog');
    expect(words).not.toContain('fox');
    expect(words).toContain('elephant');
  });

  it('deduplicates words', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'quick quick quick brown brown'
    );
    expect(words).toEqual(['quick', 'brown']);
  });

  it('limits to 20 words', () => {
    const text = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const words = (DeepLTranslationService as any).extractWordsFromText(text);
    expect(words.length).toBeLessThanOrEqual(20);
  });

  it('removes punctuation and special characters', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'Hello, world! This is a test-case with "quotes" and (parentheses).'
    );
    expect(words).toContain('hello');
    expect(words).toContain('world');
    expect(words).toContain('testcase'); // hyphen removed, words merge
    expect(words).toContain('quotes');
    expect(words).toContain('parentheses');
  });

  it('handles empty input', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText('');
    expect(words).toEqual([]);
  });

  it('handles input with only common words', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'the and or but this that they their'
    );
    expect(words).toEqual([]);
  });
});

describe('DeepLTranslationService — parseWordAnalysis', () => {
  it('parses JSON word analysis from code block', () => {
    const content = `Here is the analysis:
\`\`\`json
{
  "words": [
    {"original": "serendipity", "translation": "偶然发现", "difficulty": 8, "isPhrase": false, "phonetic": "/ˌserənˈdɪpɪti/", "partOfSpeech": "noun", "examples": ["Finding this book was pure serendipity."]}
  ]
}
\`\`\``;

    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      original: 'serendipity',
      translation: '偶然发现',
      difficulty: 8,
      isPhrase: false,
      phonetic: '/ˌserənˈdɪpɪti/',
      partOfSpeech: 'noun',
      examples: ['Finding this book was pure serendipity.'],
    });
    expect(result[0].position).toEqual([0, 0]);
  });

  it('parses raw JSON without code block', () => {
    const content = JSON.stringify({
      words: [
        { original: 'ubiquitous', translation: '无处不在的', difficulty: 7 },
        { original: 'juxtapose', translation: '并列', difficulty: 9 },
      ],
    });

    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toHaveLength(2);
    expect(result[0].original).toBe('ubiquitous');
    expect(result[1].original).toBe('juxtapose');
  });

  it('handles empty words array', () => {
    const content = JSON.stringify({ words: [] });
    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toEqual([]);
  });

  it('returns empty array for missing words key', () => {
    const content = JSON.stringify({ data: 'something' });
    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    const content = 'this is not json at all';
    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toEqual([]);
  });

  it('applies defaults for missing fields', () => {
    const content = JSON.stringify({
      words: [
        { original: 'test' },
        { original: 'test2', translation: '测试', difficulty: null },
      ],
    });

    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result[0].translation).toBe('');
    expect(result[0].difficulty).toBe(5);
    expect(result[0].isPhrase).toBe(false);
    expect(result[0].phonetic).toBeUndefined();
    expect(result[1].difficulty).toBe(5);
  });

  it('handles malformed code block content', () => {
    const content = '```json\n{ invalid json }\n```';
    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toEqual([]);
  });

  it.each(['SYNTH_PII', '```json\nSYNTH_PII\n```'])('解析失败日志不回显词汇响应：%s', (content) => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    errorSpy.mockClear();

    expect((DeepLTranslationService as any).parseWordAnalysis(content)).toEqual([]);

    expect(errorSpy).toHaveBeenCalledWith('DeepLTranslationService: 词汇分析响应解析失败');
    expect(errorSpy.mock.calls[0]?.some(arg => arg instanceof Error)).toBe(false);
    expect(errorSpy.mock.calls[0]?.map(String).join(' ')).not.toContain('SYNTH_PII');
  });
});

describe('DeepLTranslationService — parseResponse', () => {
  const defaultSettings = {
    phraseTranslationEnabled: true,
    grammarTranslationEnabled: false,
  };

  it('parses full translation response with code block', () => {
    const content = `\`\`\`json
{
  "fullText": "这是一段翻译",
  "words": [
    {"original": "serendipity", "translation": "偶然发现", "position": [10, 21], "difficulty": 8, "isPhrase": false}
  ],
  "sentences": [
    {"original": "Hello world", "translation": "你好世界", "grammarNote": "simple greeting"}
  ],
  "grammarPoints": [
    {"original": "Hello world", "explanation": "greeting pattern", "type": "greeting", "position": [0, 11]}
  ]
}
\`\`\``;

    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.fullText).toBe('这是一段翻译');
    expect(result.words).toHaveLength(1);
    expect(result.words[0].original).toBe('serendipity');
    expect(result.words[0].position).toEqual([10, 21]);
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0].original).toBe('Hello world');
    expect(result.grammarPoints).toEqual([]); // grammarTranslationEnabled is false
  });

  it('parses words with defaults for missing fields', () => {
    const content = JSON.stringify({
      words: [
        { original: 'test', translation: '测试' },
        { original: 'test2', translation: '测试2', position: [0, 5], difficulty: 3, isPhrase: true, phonetic: '/test/', partOfSpeech: 'noun', examples: ['example'] },
      ],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.words).toHaveLength(2);
    // First word: defaults
    expect(result.words[0].difficulty).toBe(5);
    expect(result.words[0].position).toEqual([0, 0]);
    expect(result.words[0].isPhrase).toBe(false);
    // Second word: explicit values
    expect(result.words[1].difficulty).toBe(3);
    expect(result.words[1].position).toEqual([0, 5]);
    expect(result.words[1].phonetic).toBe('/test/');
    expect(result.words[1].examples).toEqual(['example']);
  });

  it('filters phrases when phraseTranslationEnabled is false', () => {
    const settings = { phraseTranslationEnabled: false, grammarTranslationEnabled: false };
    const content = JSON.stringify({
      words: [
        { original: 'word', translation: '词', isPhrase: false },
        { original: 'in spite of', translation: '尽管', isPhrase: true },
        { original: 'another', translation: '另一个', isPhrase: false },
      ],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, settings);
    expect(result.words).toHaveLength(2);
    expect(result.words[0].original).toBe('word');
    expect(result.words[1].original).toBe('another');
  });

  it('includes phrases when phraseTranslationEnabled is true', () => {
    const content = JSON.stringify({
      words: [
        { original: 'word', translation: '词', isPhrase: false },
        { original: 'in spite of', translation: '尽管', isPhrase: true },
      ],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.words).toHaveLength(2);
  });

  it('includes grammar points when grammarTranslationEnabled is true', () => {
    const settings = { phraseTranslationEnabled: true, grammarTranslationEnabled: true };
    const content = JSON.stringify({
      grammarPoints: [
        { original: 'If I were', explanation: '虚拟语气', type: 'subjunctive', position: [0, 9] },
        { original: 'had been', explanation: '过去完成时', type: 'tense' },
      ],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, settings);
    expect(result.grammarPoints).toHaveLength(2);
    expect(result.grammarPoints[0]).toMatchObject({
      original: 'If I were',
      explanation: '虚拟语气',
      type: 'subjunctive',
      position: [0, 9],
    });
    expect(result.grammarPoints[1].position).toEqual([0, 0]); // default
  });

  it('parses sentences correctly', () => {
    const content = JSON.stringify({
      sentences: [
        { original: 'Sentence one', translation: '第一句' },
        { original: 'Sentence two', translation: '第二句', grammarNote: 'note' },
      ],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.sentences).toHaveLength(2);
    expect(result.sentences[0]).toMatchObject({
      original: 'Sentence one',
      translation: '第一句',
    });
    expect(result.sentences[0].grammarNote).toBeUndefined();
    expect(result.sentences[1].grammarNote).toBe('note');
  });

  it('throws error for invalid JSON', () => {
    const content = 'not valid json';
    expect(() =>
      (DeepLTranslationService as any).parseResponse(content, defaultSettings)
    ).toThrow('Failed to parse translation response');
  });

  it('throws error for malformed code block JSON', () => {
    const content = '```json\n{ broken\n```';
    expect(() =>
      (DeepLTranslationService as any).parseResponse(content, defaultSettings)
    ).toThrow('Failed to parse translation response');
  });

  it.each(['SYNTH_PII', '```json\nSYNTH_PII\n```'])('解析失败日志不回显翻译响应：%s', (content) => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    errorSpy.mockClear();

    expect(() => (DeepLTranslationService as any).parseResponse(content, defaultSettings))
      .toThrow('Failed to parse translation response');

    expect(errorSpy).toHaveBeenCalledWith('DeepLTranslationService: 翻译响应解析失败');
    expect(errorSpy.mock.calls[0]?.some(arg => arg instanceof Error)).toBe(false);
    expect(errorSpy.mock.calls[0]?.map(String).join(' ')).not.toContain('SYNTH_PII');
  });

  it('handles response without code block (raw JSON)', () => {
    const content = JSON.stringify({
      fullText: 'raw json response',
      words: [],
      sentences: [],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.fullText).toBe('raw json response');
  });

  it('handles empty arrays gracefully', () => {
    const content = JSON.stringify({});
    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.words).toEqual([]);
    expect(result.sentences).toEqual([]);
    expect(result.grammarPoints).toEqual([]);
    expect(result.fullText).toBeUndefined();
  });
});
