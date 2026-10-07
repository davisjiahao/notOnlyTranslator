/**
 * BatchTranslationService 本地优先一致性测试
 *
 * 覆盖：
 * - inline-only 段落本地全可解时不需要 LLM（无 Key/断网也可用）
 * - 无 Key 仅在确实存在必须走 LLM 的段落时抛错（不伪装成功）
 * - 非 inline 模式行为保持不变
 * - 本地可解段落不进入合并 API 提示词
 * - options（signal/timeoutMs 等）贯穿到 callBatchAPI 的底层调用
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    getBatch: vi
      .fn()
      .mockImplementation((hashes: string[]) =>
        Promise.resolve({ hits: new Map(), misses: [...hashes] })
      ),
    generateHash: vi.fn().mockImplementation((text: string, mode: string) => `h:${mode}:${text}`),
  },
}));

// shared/utils 保留真实实现，仅静默 logger
vi.mock('@/shared/utils', async () => {
  const actual = await vi.importActual<typeof import('@/shared/utils')>('@/shared/utils');
  return {
    ...actual,
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
});

import { BatchTranslationService, BATCH_RETRY_OPTIONS } from '@/background/batchTranslation';
import { TransportError } from '@/shared/utils/translationErrors';
import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { logger } from '@/shared/utils';
import { enhancedCache } from '@/background/enhancedCache';
import { frequencyManager } from '@/background/frequencyManager';
import { setOfflineWordSource, clearWordSenseCache } from '@/background/localWordLookup';
import type {
  UserSettings,
  UserProfile,
  BatchTranslationRequest,
  BatchParagraphRequest,
  UnknownWordEntry,
} from '@/shared/types';

function makeEntry(word: string, context: string, translation: string): UnknownWordEntry {
  return { word, context, translation, markedAt: Date.now(), reviewCount: 0 };
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    examType: 'cet4',
    estimatedVocabulary: 99999, // C2：关闭难度通道
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

function makeRequest(overrides: Partial<BatchTranslationRequest> = {}): BatchTranslationRequest {
  const paragraphs: BatchParagraphRequest[] = [
    { id: 'p1', text: 'The ubiquitous smartphone is very good.', elementPath: '#p1' },
  ];
  return {
    paragraphs,
    mode: 'inline-only',
    pageUrl: 'https://example.com',
    userLevel: makeProfile({
      unknownWords: [makeEntry('ubiquitous', 'The ubiquitous smartphone is very good.', '无处不在的')],
    }),
    ...overrides,
  };
}

const mockedCallWithSystem = vi.mocked(TranslationApiService.callWithSystem);
const mockedGetSettings = vi.mocked(StorageManager.getSettings);
const mockedGetApiKey = vi.mocked(StorageManager.getApiKey);

beforeEach(async () => {
  vi.clearAllMocks();
  mockedCallWithSystem.mockReset();
  await frequencyManager.initialize();
  setOfflineWordSource({
    lookup: (lemma) => (lemma === 'book' ? { translation: '书；预订' } : undefined),
  });
  clearWordSenseCache();
  mockedGetSettings.mockResolvedValue(createMockSettings());
  mockedGetApiKey.mockResolvedValue('sk-test');
});

describe('敏感日志防护', () => {
  it.each([
    '```json\nSYNTH_PII\n```',
    '[SYNTH_PII]',
    JSON.stringify({ paragraphs: [{ id: '0', words: [null] }] }),
  ])('无效批量响应只记录固定文案，不传原始异常：%s', async content => {
    mockedCallWithSystem.mockResolvedValueOnce(content);

    await expect(BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' })))
      .rejects.toThrow('批量翻译响应格式无效');
    expect(enhancedCache.set).not.toHaveBeenCalled();
    const calls = vi.mocked(logger.error).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(args => args.length === 1 && typeof args[0] === 'string')).toBe(true);
    expect(calls.flatMap(args => args.map(String)).join('\n')).not.toContain('SYNTH_PII');
  });

  it.each([
    { name: '只返回第二段', raw: [{ id: '1', fullText: '第二段译文' }] },
    { name: '返回重复段落 ID', raw: [{ id: '1', fullText: '第一份' }, { id: '1', fullText: '第二份' }] },
  ])('请求两段时$name不允许错配并缓存', async ({ raw }) => {
    mockedCallWithSystem.mockResolvedValueOnce(JSON.stringify({ paragraphs: raw }));
    const request = makeRequest({ mode: 'bilingual', paragraphs: [
      { id: 'p1', text: 'The first sentence is a long sample.', elementPath: '#p1' },
      { id: 'p2', text: 'The second sentence is a different sample.', elementPath: '#p2' },
    ] });

    await expect(BatchTranslationService.translateBatch(request)).rejects.toThrow('批量翻译响应格式无效');
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each(['null', '{"id":"0"}'])('模型返回无有效翻译结构 %s 时拒绝并不缓存', async paragraph => {
    mockedCallWithSystem.mockResolvedValueOnce(`{"paragraphs":[${paragraph}]}`);

    await expect(BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' })))
      .rejects.toThrow('批量翻译响应格式无效');
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('inline-only 请求允许模型返回空词汇，不受全局双语模式影响', async () => {
    mockedGetSettings.mockResolvedValueOnce(createMockSettings({ translationMode: 'bilingual', phraseTranslationEnabled: true }));
    mockedCallWithSystem.mockResolvedValueOnce('{"paragraphs":[{"id":"0","words":[],"sentences":[]}]}');

    const response = await BatchTranslationService.translateBatch(makeRequest({ mode: 'inline-only' }));

    expect(response.results[0].result).toMatchObject({ words: [], sentences: [] });
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).toHaveBeenCalledTimes(1);
  });

  it('模型未返回任何段落时拒绝批次且不缓存空译文', async () => {
    mockedCallWithSystem.mockResolvedValueOnce('{"paragraphs":[]}');

    await expect(BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' })))
      .rejects.toThrow('批量翻译响应格式无效');
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('BATCH_RETRY_OPTIONS.onRetry 只记错误类别，不回显 error.message 正文', () => {
    const sentinel = 'SENTINEL-UPSTREAM-BODY';
    const warnCallsBefore = vi.mocked(logger.warn).mock.calls.length;

    BATCH_RETRY_OPTIONS.onRetry?.(new Error(`上游返回 ${sentinel}`), 1, 100);

    const calls = vi.mocked(logger.warn).mock.calls.slice(warnCallsBefore);
    const logged = calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(logged).toContain('第 1 次重试');
    expect(logged).not.toContain(sentinel);
  });
});

describe('行内输出耗尽后的批量候选词义恢复', () => {
  const paragraphs = [
    { id: 'p1', text: '  house book\n internationalization accelerated.', elementPath: '#p1' },
    { id: 'p2', text: 'The  internationalization of software accelerated.', elementPath: '#p2' },
  ];
  const request = () => makeRequest({ paragraphs, userLevel: makeProfile({
    estimatedVocabulary: 3000, knownWords: ['house', 'accelerated', 'software'],
    unknownWords: [makeEntry('book', paragraphs[0].text, '本地书义')],
  }) });
  const responseParagraphs = [
    { id: 'PARA_1', words: [
      { original: 'internationalization', translation: '软件国际化' },
      { original: 'book', translation: '跨段词' },
    ] },
    { id: 'PARA_0', words: [
      { original: 'internationalization', translation: '市场国际化', position: [0, 1] },
      { original: 'book', translation: '不覆盖本地' },
      { original: 'house', translation: '不翻译已知词' },
      { original: 'extraneous', translation: '候选外词' },
    ] },
  ];

  beforeEach(() => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'custom',
      customModelName: 'space-bunny', grammarTranslationEnabled: true, phraseTranslationEnabled: true }));
  });

  it('仅追加一次批量请求，按乱序ID隔离词义，保留本地词和未归一化位置且不缓存', async () => {
    const controller = new AbortController();
    const options = { signal: controller.signal, timeoutMs: 5000, maxTokens: 2000 };
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit())
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: responseParagraphs }));

    const result = await BatchTranslationService.translateBatch(request(), options);

    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    const [system, prompt, key, settings, retry, sentOptions] = mockedCallWithSystem.mock.calls[1];
    expect(system).toContain('禁止整句翻译');
    expect(prompt).toContain('PARA_0');
    expect(prompt).toContain('PARA_1');
    expect(prompt).not.toContain('fullText');
    expect(prompt).not.toContain('grammarPoints');
    expect(key).toBe('sk-test');
    expect(settings).toBe(mockedCallWithSystem.mock.calls[0][3]);
    expect(retry?.maxRetries).toBe(0);
    expect(sentOptions).toMatchObject(options);
    expect(result.apiCallCount).toBe(2);
    expect(result.results.map(item => item.id)).toEqual(['p1', 'p2']);
    expect(result.results.map(item => item.result.words.map(word => [word.original, word.translation]))).toEqual([
      [['book', '本地书义'], ['internationalization', '市场国际化']],
      [['internationalization', '软件国际化']],
    ]);
    for (const [index, item] of result.results.entries()) {
      for (const word of item.result.words) expect(paragraphs[index].text.slice(...word.position)).toBe(word.original);
      expect(item.result).toMatchObject({ sentences: [], grammarPoints: [], _source: 'llm' });
      expect(item.result.fullText).toBeUndefined();
    }
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('恢复请求逐段只列出未解候选，不截断超过三个的候选，也保留空候选段ID', async () => {
    const words = ['neologisma', 'neologismb', 'neologismc', 'neologismd', 'neologisme'];
    const text = `  ${words.join('  ')}.`;
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit()).mockResolvedValueOnce(JSON.stringify({ paragraphs: [
      { id: 'PARA_1', words: [{ original: 'house', translation: '不采纳已知词' }] },
      { id: 'PARA_0', words: words.map(original => ({ original, translation: '候选义' })) },
    ] }));
    const result = await BatchTranslationService.translateBatch(makeRequest({
      paragraphs: [
        { id: 'p1', text, elementPath: '#p1' },
        { id: 'p2', text: 'The house is already familiar.', elementPath: '#p2' },
      ],
      userLevel: makeProfile({ unknownWords: words.map(word => makeEntry(word, text, '')) }),
    }));
    const input = JSON.parse(mockedCallWithSystem.mock.calls[1][1]);
    expect(input.paragraphs).toEqual([
      { id: 'PARA_0', sentence: text, candidates: words },
      { id: 'PARA_1', sentence: 'The house is already familiar.', candidates: [] },
    ]);
    expect(result.results[0].result.words).toHaveLength(5);
    expect(result.results[1].result.words).toEqual([]);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each([
    'not json', 'null', '{}', '{"paragraphs":null}',
    '{"paragraphs":[null,null]}',
    '{"paragraphs":[{"id":"PARA_0","words":null},{"id":"PARA_1","words":[]}]}',
  ])('批量恢复结构非法 %s 时明确失败且不缓存', async content => {
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit()).mockResolvedValueOnce(content);
    await expect(BatchTranslationService.translateBatch(request())).rejects.toThrow('词汇恢复响应无效');
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each([
    { name: '重复', value: [responseParagraphs[0], responseParagraphs[0]] },
    { name: '缺少', value: [responseParagraphs[0]] },
    { name: '未知', value: [responseParagraphs[0], { ...responseParagraphs[1], id: 'PARA_7' }] },
    { name: '无ID', value: responseParagraphs.map(({ words }) => ({ words })) },
  ])('$name段落ID时拒绝恢复，不缓存也不继续请求', async ({ value }) => {
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit())
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: value }));
    await expect(BatchTranslationService.translateBatch(request())).rejects.toThrow('词汇恢复响应无效');
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each(['output_limit', 'timeout'] as const)('恢复再次失败 %s 时不递归、不拆成逐段请求', async kind => {
    const error = kind === 'output_limit' ? TransportError.outputLimit() : TransportError.timeout(5000);
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit()).mockRejectedValueOnce(error);
    await expect(BatchTranslationService.translateBatch(request())).rejects.toBe(error);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each(['首次失败', '恢复响应', '恢复失败'] as const)('%s时调用方取消优先，不接受迟到结果', async stage => {
    const controller = new AbortController();
    mockedCallWithSystem.mockImplementationOnce(async () => {
      if (stage === '首次失败') controller.abort();
      throw TransportError.outputLimit();
    }).mockImplementationOnce(async () => {
      controller.abort();
      if (stage === '恢复失败') throw TransportError.outputLimit();
      return JSON.stringify({ paragraphs: responseParagraphs });
    });
    await expect(BatchTranslationService.translateBatch(request(), { signal: controller.signal })).rejects.toThrow(/abort|取消/i);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(stage === '首次失败' ? 1 : 2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('所有段落本地可解时不追加API，计数只包含首次失败调用', async () => {
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit());
    const result = await BatchTranslationService.translateBatch(makeRequest({ paragraphs: [
      { id: 'p1', text: 'Read  this book carefully.', elementPath: '#p1' },
      { id: 'p2', text: 'The house is already familiar.', elementPath: '#p2' },
    ], userLevel: makeProfile({ unknownWords: [makeEntry('book', 'Read  this book carefully.', '本地书义')] }) }));
    expect(result.results[0].result.words[0].translation).toBe('本地书义');
    expect(result.results[1].result.words).toEqual([]);
    expect(result.apiCallCount).toBe(1);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('Ollama 恢复仅使用原整体截止时间的剩余预算', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama', grammarTranslationEnabled: true }));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    mockedCallWithSystem.mockImplementationOnce(async () => {
      clock.mockReturnValue(2200);
      throw TransportError.outputLimit();
    }).mockResolvedValueOnce(JSON.stringify({ paragraphs: responseParagraphs }));
    try {
      await BatchTranslationService.translateBatch(request(), { timeoutMs: 5000, maxTokens: 2000 });
      expect(mockedCallWithSystem.mock.calls[1][5]).toMatchObject({ timeoutMs: 3800, maxTokens: 2000 });
      expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('Ollama 恢复等待超过整体截止时间转换为timeout，不继续请求也不缓存', async () => {
    vi.useFakeTimers();
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama', grammarTranslationEnabled: true }));
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit())
      .mockImplementationOnce((_s, _p, _k, _settings, _retry, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(TransportError.cancelled()), { once: true });
      }));
    try {
      const outcome = BatchTranslationService.translateBatch(request(), { timeoutMs: 5000 }).catch(error => error);
      await vi.waitFor(() => expect(mockedCallWithSystem).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(5000);
      expect(await outcome).toMatchObject({ kind: 'timeout' });
      expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
      expect(enhancedCache.set).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('输出耗尽后的纯全文恢复', () => {
  const paragraphs = [
    { id: 'p1', text: 'The ubiquitous smartphone is very good.', elementPath: '#p1' },
    { id: 'p2', text: 'Read this book carefully.', elementPath: '#p2' },
  ];
  const recoveryRequest = (mode: BatchTranslationRequest['mode'] = 'bilingual') => makeRequest({
    paragraphs, mode,
    userLevel: makeProfile({ unknownWords: [
      makeEntry('ubiquitous', paragraphs[0].text, '无处不在的'),
      makeEntry('book', paragraphs[1].text, '书；预订'),
    ] }),
  });
  const fullTextResponse = JSON.stringify({ paragraphs: [
    { id: 'PARA_1', fullText: '仔细阅读这本书。' },
    { id: 'PARA_0', fullText: '无处不在的智能手机非常好。' },
  ] });

  it.each([
    { mode: 'bilingual', provider: 'custom', timeoutMs: undefined, fallbackTimeoutMs: undefined },
    { mode: 'full-translate', provider: 'custom', timeoutMs: 5000, fallbackTimeoutMs: 5000 },
    { mode: 'bilingual', provider: 'ollama', timeoutMs: undefined, fallbackTimeoutMs: 88800 },
  ] as const)('$mode/$provider 恢复按 PARA ID 对齐全文，保留既有超时语义且不缓存降级结果', async ({ mode, provider, timeoutMs, fallbackTimeoutMs }) => {
    const settings = createMockSettings({ apiProvider: provider, translationMode: mode, grammarTranslationEnabled: true });
    mockedGetSettings.mockResolvedValue(settings);
    const controller = new AbortController();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const performanceClock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    mockedCallWithSystem.mockImplementationOnce(async () => {
      clock.mockReturnValue(2200);
      performanceClock.mockReturnValue(2200);
      throw TransportError.outputLimit();
    }).mockResolvedValueOnce(fullTextResponse);

    try {
      const request = recoveryRequest(mode);
      const response = await BatchTranslationService.translateBatch(request, {
        signal: controller.signal, timeoutMs, maxTokens: 2000,
      });
      expect(response.results.map(item => item.id)).toEqual(['p1', 'p2']);
      expect(response.results.map(item => item.result.fullText)).toEqual(['无处不在的智能手机非常好。', '仔细阅读这本书。']);
      expect(response.results.map(item => item.result.words)).toEqual([
        [expect.objectContaining({ original: 'ubiquitous', translation: '无处不在的', position: [4, 14] })],
        [expect.objectContaining({ original: 'book', translation: '书；预订', position: [10, 14] })],
      ]);
      expect(response.results.every(item => item.result.sentences.length === 0 && item.result.grammarPoints === undefined)).toBe(true);
      expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
      const [system, prompt, key, snapshot, retry, options] = mockedCallWithSystem.mock.calls[1];
      expect(system).not.toMatch(/CET|grammar|语法|分析/i);
      expect(`${system}\n${prompt}`).toContain('fullText');
      for (const paragraph of paragraphs) expect(prompt).toContain(paragraph.text);
      expect(key).toBe('sk-test');
      expect(snapshot).toBe(settings);
      expect(retry).toMatchObject({ maxRetries: 0 });
      expect(options?.signal).toBe(mockedCallWithSystem.mock.calls[0][5]?.signal);
      if (provider === 'custom') expect(options?.signal).toBe(controller.signal);
      expect(options?.timeoutMs).toBe(fallbackTimeoutMs);
      expect(options?.maxTokens).toBe(2000);
      expect(enhancedCache.set).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      performanceClock.mockRestore();
    }
  });

  it.each([
    { name: '缺少完整全文', paragraphs: [{ id: 'PARA_0', fullText: '' }, { id: 'PARA_1', fullText: '第二段译文。' }] },
    { name: '缺少段落 ID', paragraphs: [{ fullText: '第一段译文。' }, { id: 'PARA_1', fullText: '第二段译文。' }] },
    { name: '任意段落 ID', paragraphs: [{ id: 'arbitrary-a', fullText: '第一段译文。' }, { id: 'arbitrary-b', fullText: '第二段译文。' }] },
    { name: '重复段落 ID', paragraphs: [{ id: 'PARA_0', fullText: '第一段译文。' }, { id: 'PARA_0', fullText: '第二段译文。' }] },
  ])('恢复响应$name 时拒绝部分结果、不再恢复且不缓存', async ({ paragraphs: returned }) => {
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit())
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: returned }));

    await expect.soft(BatchTranslationService.translateBatch(recoveryRequest())).rejects.toThrow();
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('纯全文恢复忽略夹带的无效分析数组，只保留逐段本地词汇', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ grammarTranslationEnabled: true }));
    const data = JSON.parse(fullTextResponse) as { paragraphs: Array<{ id: string; fullText: string }> };
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit()).mockResolvedValueOnce(JSON.stringify({
      paragraphs: data.paragraphs.map(paragraph => ({
        ...paragraph,
        words: [null, { original: 'book', translation: '伪造词义', position: [10, 14] }],
        sentences: [null],
        grammarPoints: [null],
      })),
    }));

    const response = await BatchTranslationService.translateBatch(recoveryRequest());

    expect(response.results.map(item => item.result.fullText)).toEqual(['无处不在的智能手机非常好。', '仔细阅读这本书。']);
    expect(response.results.map(item => item.result.words)).toEqual([
      [expect.objectContaining({ original: 'ubiquitous', translation: '无处不在的' })],
      [expect.objectContaining({ original: 'book', translation: '书；预订' })],
    ]);
    expect(response.results.every(item => item.result.sentences.length === 0 && item.result.grammarPoints === undefined)).toBe(true);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('Ollama 纯全文恢复等待期间达到服务截止时间，取消应还原为超时且不缓存', async () => {
    vi.useFakeTimers();
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama' }));
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit())
      .mockImplementationOnce((_system, _prompt, _key, _settings, _retry, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(TransportError.cancelled()), { once: true });
      }));

    try {
      const outcome = BatchTranslationService.translateBatch(recoveryRequest()).catch((error: unknown) => error);
      await vi.waitFor(() => expect(mockedCallWithSystem).toHaveBeenCalledTimes(2));
      expect(mockedCallWithSystem.mock.calls[1][5]?.signal).toBeInstanceOf(AbortSignal);
      await vi.advanceTimersByTimeAsync(90_000);

      expect.soft(await outcome).toMatchObject({ kind: 'timeout' });
      expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
      expect(enhancedCache.set).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('恢复任务期间取消后不接受迟到全文，不发第三次也不缓存', async () => {
    const controller = new AbortController();
    mockedCallWithSystem.mockRejectedValueOnce(TransportError.outputLimit()).mockImplementationOnce(async () => {
      controller.abort();
      return fullTextResponse;
    });

    await expect.soft(BatchTranslationService.translateBatch(recoveryRequest(), { signal: controller.signal }))
      .rejects.toThrow(/abort|取消/i);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });
});

describe('批次缓存与响应契约', () => {
  const translated = { words: [], sentences: [], fullText: '已翻译的段落。' };

  describe.each(['bilingual', 'full-translate'] as const)('%s 全文响应契约', mode => {
    it.each([undefined, '', ' \n\t', null, 42, false, { text: '译文' }, ['译文']].map(fullText => ({ fullText })))('拒绝无效 fullText：$fullText，且不缓存', async ({ fullText }) => {
      mockedCallWithSystem.mockResolvedValueOnce(JSON.stringify({ paragraphs: [{ id: '0', words: [], sentences: [], fullText }] }));

      await expect(BatchTranslationService.translateBatch(makeRequest({ mode })))
        .rejects.toThrow('批量翻译响应格式无效');
      expect(enhancedCache.set).not.toHaveBeenCalled();
    });

    it('不把 translatedText 别名当作完整译文', async () => {
      mockedCallWithSystem.mockResolvedValueOnce('{"paragraphs":[{"id":"0","words":[],"sentences":[],"translatedText":"合成译文"}]}');

      await expect(BatchTranslationService.translateBatch(makeRequest({ mode })))
        .rejects.toThrow('批量翻译响应格式无效');
      expect(enhancedCache.set).not.toHaveBeenCalled();
    });

    it('缺失全文的旧缓存不算命中，改用模型完整译文', async () => {
      const request = makeRequest({ mode });
      const hash = enhancedCache.generateHash(request.paragraphs[0].text, mode);
      vi.mocked(enhancedCache.getBatch).mockResolvedValueOnce({
        hits: new Map([[hash, { words: [], sentences: [] }]]), misses: [],
      });
      mockedCallWithSystem.mockResolvedValueOnce(JSON.stringify({ paragraphs: [{ id: '0', ...translated }] }));

      const response = await BatchTranslationService.translateBatch(request);

      expect(response.results[0]).toMatchObject({ result: translated, cached: false });
      expect(response.cacheHitCount).toBe(0);
      expect(response.apiCallCount).toBe(1);
      expect(enhancedCache.set).toHaveBeenCalledTimes(1);
    });
  });

  it('精确缓存命中时不发请求，并保留调用方段落 ID', async () => {
    const request = makeRequest({ mode: 'bilingual' });
    const hash = enhancedCache.generateHash(request.paragraphs[0].text, request.mode);
    vi.mocked(enhancedCache.getBatch).mockResolvedValueOnce({
      hits: new Map([[hash, translated]]), misses: [],
    });

    const response = await BatchTranslationService.translateBatch(request);

    expect(response.results).toEqual([{ id: 'p1', result: translated, cached: true }]);
    expect(response.cacheHitCount).toBe(1);
    expect(response.apiCallCount).toBe(0);
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
  });

  it('近似缓存不能短路批量 API 请求', async () => {
    vi.mocked(enhancedCache.fuzzyGet).mockResolvedValueOnce({ result: translated, similarity: 0.99 });
    mockedCallWithSystem.mockResolvedValueOnce('{"paragraphs":[{"id":"0","fullText":"新译文"}]}');

    const response = await BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' }));

    expect(response.results[0]).toMatchObject({ id: 'p1', result: { fullText: '新译文' }, cached: false });
    expect(enhancedCache.fuzzyGet).not.toHaveBeenCalled();
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).toHaveBeenCalledTimes(1);
  });

  it('未传等级时从存储读取，中文段落不发送到模型', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValueOnce(makeProfile());
    const response = await BatchTranslationService.translateBatch(makeRequest({
      userLevel: undefined,
      mode: 'bilingual',
      paragraphs: [{ id: 'zh', text: '这是一段中文，不需要再次翻译。', elementPath: '#zh' }],
    }));

    expect(StorageManager.getUserProfile).toHaveBeenCalledTimes(1);
    expect(response.results).toEqual([{ id: 'zh', result: { words: [], sentences: [] }, cached: false }]);
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
  });

  it.each(['array', 'results', 'data'] as const)('兼容 %s 响应包装并按顺序补足缺失 ID', async wrapper => {
    const paragraphs = [translated];
    mockedCallWithSystem.mockResolvedValueOnce(JSON.stringify(
      wrapper === 'array' ? paragraphs : { [wrapper]: paragraphs }
    ));

    const response = await BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' }));

    expect(response.results[0].result.fullText).toBe(translated.fullText);
    expect(response.results[0].id).toBe('p1');
  });

  it('模型返回非数字段落 ID 时按响应顺序回填', async () => {
    mockedCallWithSystem.mockResolvedValueOnce(JSON.stringify({ paragraphs: [{ ...translated, id: 'PARA_0' }] }));

    const response = await BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' }));

    expect(response.results[0].result.fullText).toBe(translated.fullText);
  });

  it('PARA_n 标记乱序时按标记对应段落而非数组位置回填', async () => {
    mockedCallWithSystem.mockResolvedValueOnce(JSON.stringify({ paragraphs: [
      { id: 'PARA_1', fullText: '第二段译文' },
      { id: 'PARA_0', fullText: '第一段译文' },
    ] }));
    const response = await BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual', paragraphs: [
      { id: 'p1', text: 'The first sentence is a long sample.', elementPath: '#p1' },
      { id: 'p2', text: 'The second sentence is a different sample.', elementPath: '#p2' },
    ] }));

    expect(response.results.map(item => item.result.fullText)).toEqual(['第一段译文', '第二段译文']);
    expect(vi.mocked(enhancedCache.set).mock.calls.map(call => call[1].fullText))
      .toEqual(['第一段译文', '第二段译文']);
  });

  it.each([true, false])('批量响应遵循短语与语法增强开关：%s', async enabled => {
    mockedGetSettings.mockResolvedValueOnce(createMockSettings({
      phraseTranslationEnabled: enabled, grammarTranslationEnabled: enabled,
    }));
    mockedCallWithSystem.mockResolvedValueOnce(JSON.stringify({ paragraphs: [{
      id: '0',
      fullText: '查阅这本书。读它。',
      words: [
        { original: 'look up', translation: '查阅', isPhrase: true, position: [0, 7], difficulty: 3 },
        { original: 'book', translation: '书' },
      ],
      sentences: [
        { original: 'Look up the book.', translation: '查阅这本书。', grammarNote: '祈使句' },
        { original: 'Read it.', translation: '读它。' },
      ],
      grammarPoints: [
        { original: 'Look up', explanation: '动词短语', type: '祈使句', position: [0, 7] },
        {},
      ],
    }] }));

    const response = await BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' }));
    const result = response.results[0].result;

    expect(result.words.map(word => word.original)).toEqual(enabled ? ['look up', 'book'] : ['book']);
    expect(result.sentences).toHaveLength(2);
    expect(result.sentences[0].grammarNote).toBe('祈使句');
    expect(result.grammarPoints).toHaveLength(enabled ? 2 : 0);
    expect(result.words.find(word => word.original === 'book')?.position).toEqual([0, 0]);
  });
});

describe('inline-only 段落本地解析', () => {
  it.each([
    { feature: 'phraseTranslationEnabled' as const, text: 'He gave up.' },
    { feature: 'grammarTranslationEnabled' as const, text: 'The book is good.' },
  ])('简单段落仍执行显式 $feature 增强', async ({ feature, text }) => {
    mockedGetSettings.mockResolvedValueOnce(createMockSettings({ [feature]: true }));
    mockedCallWithSystem.mockResolvedValueOnce(JSON.stringify({ paragraphs: [{
      id: '0', fullText: '合成增强结果。',
    }] }));
    expect(frequencyManager.hasPotentialUnknownWords(text, 3000)).toBe(false);

    const response = await BatchTranslationService.translateBatch(makeRequest({
      paragraphs: [{ id: 'simple', text, elementPath: '#simple' }],
      userLevel: makeProfile({ estimatedVocabulary: 3000, knownWords: [] }),
    }));

    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(response.apiCallCount).toBe(1);
  });

  it('简单段落保留个人生词并离线返回其义项', async () => {
    const text = 'The book is good.';
    mockedGetApiKey.mockResolvedValueOnce('');
    expect(frequencyManager.hasPotentialUnknownWords(text, 3000)).toBe(false);

    const response = await BatchTranslationService.translateBatch(makeRequest({
      paragraphs: [{ id: 'simple', text, elementPath: '#simple' }],
      userLevel: makeProfile({
        estimatedVocabulary: 3000,
        knownWords: ['the', 'is', 'good'],
        unknownWords: [makeEntry('book', text, '书')],
      }),
    }));

    expect(response.results[0].result.words).toEqual([
      expect.objectContaining({ original: 'book', translation: '书', position: [4, 8] }),
    ]);
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
  });

  it('无增强且全部已掌握的简单段落仍不调用模型', async () => {
    const response = await BatchTranslationService.translateBatch(makeRequest({
      paragraphs: [{ id: 'simple', text: 'The book is good.', elementPath: '#simple' }],
      userLevel: makeProfile({ estimatedVocabulary: 3000, knownWords: ['the', 'book', 'is', 'good'] }),
    }));

    expect(response.results[0].result.words).toEqual([]);
    expect(response.apiCallCount).toBe(0);
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
  });

  it('段落本地全可解且无 Key：成功返回且不调用 API（断网可用）', async () => {
    mockedGetApiKey.mockResolvedValue('');

    const response = await BatchTranslationService.translateBatch(makeRequest());

    expect(mockedCallWithSystem).not.toHaveBeenCalled();
    expect(response.apiCallCount).toBe(0);
    const words = response.results[0].result.words;
    expect(words).toHaveLength(1);
    expect(words[0].translation).toBe('无处不在的');
    expect(words[0].position).toEqual([4, 14]);
  });

  it('段落本地全可解且有 Key：依然不调用 API', async () => {
    const response = await BatchTranslationService.translateBatch(makeRequest());

    expect(mockedCallWithSystem).not.toHaveBeenCalled();
    expect(response.apiCallCount).toBe(0);
  });

  it.each(['grammarTranslationEnabled', 'phraseTranslationEnabled'] as const)('%s 开启时，本地词义命中不跳过显式增强', async feature => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ [feature]: true }));
    mockedCallWithSystem.mockResolvedValue(JSON.stringify({ paragraphs: [{
      id: '0', fullText: '智能手机非常好。', words: [], sentences: [],
    }] }));
    const result = await BatchTranslationService.translateBatch(makeRequest());
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(result.apiCallCount).toBe(1);
  });

  it('段落含无法本地解决的候选且无 Key：明确抛错，不伪装成功', async () => {
    mockedGetApiKey.mockResolvedValue('');

    const request = makeRequest({
      paragraphs: [
        {
          id: 'p1',
          text: 'The internationalization of markets accelerated.',
          elementPath: '#p1',
        },
      ],
      userLevel: makeProfile({ estimatedVocabulary: 3000, knownWords: [] }),
    });

    await expect(BatchTranslationService.translateBatch(request)).rejects.toThrow('API key');
  });

  it('本地可解与需 LLM 的段落混合：仅后者进入 API 提示词，结果按原始顺序返回', async () => {
    mockedCallWithSystem.mockResolvedValue(
      JSON.stringify({
        paragraphs: [
          {
            id: '0',
            fullText: '国际化的加速。',
            words: [
              {
                original: 'internationalization',
                translation: '国际化',
                position: [4, 24],
                difficulty: 8,
                isPhrase: false,
              },
            ],
            sentences: [],
          },
        ],
      })
    );

    const request = makeRequest({
      paragraphs: [
        { id: 'p1', text: 'The ubiquitous smartphone is very good.', elementPath: '#p1' },
        {
          id: 'p2',
          text: 'The internationalization of markets accelerated.',
          elementPath: '#p2',
        },
      ],
      userLevel: makeProfile({
        estimatedVocabulary: 3000,
        knownWords: [],
        unknownWords: [makeEntry('ubiquitous', 'The ubiquitous smartphone is very good.', '无处不在的')],
      }),
    });

    const response = await BatchTranslationService.translateBatch(request);

    // 仅 p2 需要 LLM
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    const callArgs = mockedCallWithSystem.mock.calls[0] as unknown as unknown[];
    const userPrompt = String(callArgs[1]);
    expect(userPrompt).toContain('internationalization');
    // p1 已本地解决，不应进入合并提示词
    expect(userPrompt).not.toContain('ubiquitous');

    expect(response.apiCallCount).toBe(1);
    expect(response.results).toHaveLength(2);
    expect(response.results[0].id).toBe('p1');
    expect(response.results[0].result.words.map((w) => w.original)).toContain('ubiquitous');
    expect(response.results[1].id).toBe('p2');
    expect(response.results[1].result.words.map((w) => w.original)).toContain('internationalization');
  });

  it('bilingual 模式无 Key：保持原有抛错行为（本地词表不接管全文翻译）', async () => {
    mockedGetApiKey.mockResolvedValue('');

    const request = makeRequest({ mode: 'bilingual' });

    await expect(BatchTranslationService.translateBatch(request)).rejects.toThrow('API key');
  });

  it.each(['inline-only', 'bilingual', 'full-translate'] as const)('Ollama 的 %s 批次无 Key 也能调用模型', async mode => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama' }));
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem.mockResolvedValue(JSON.stringify({ paragraphs: [{
      id: '0', fullText: '国际化。', words: [], sentences: [],
    }] }));
    const response = await BatchTranslationService.translateBatch(makeRequest({
      mode,
      paragraphs: [{ id: 'p1', text: 'The internationalization of markets accelerated.', elementPath: '#p1' }],
      userLevel: makeProfile({ estimatedVocabulary: 3000, knownWords: [] }),
    }));
    expect(response.apiCallCount).toBe(1);
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(mockedCallWithSystem.mock.calls[0][2]).toBe('');
  });

  it('免费 Google 的 inline-only 有待解析段落时拒绝不可见的纯文本翻译且不联网或缓存', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'free_google_translate' }));
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem.mockResolvedValue('模型译文不会被行内模式显示');
    const request = makeRequest({
      mode: 'inline-only',
      paragraphs: [{ id: 'p1', text: 'The internationalization of markets accelerated.', elementPath: '#p1' }],
      userLevel: makeProfile({ estimatedVocabulary: 3000, knownWords: [] }),
    });

    await expect(BatchTranslationService.translateBatch(request)).rejects.toThrow('不支持仅行内模式');
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('免费 Google 的 inline-only 本地全可解段落仍保持离线成功', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'free_google_translate' }));
    mockedGetApiKey.mockResolvedValue('');

    const response = await BatchTranslationService.translateBatch(makeRequest());

    expect(response.apiCallCount).toBe(0);
    expect(response.results[0].result.words).toHaveLength(1);
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
  });

  it.each(['bilingual', 'full-translate'] as const)('免费 Google 的 %s 批次无 Key 时逐段发送纯文本并映射全文译文', async mode => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'free_google_translate' }));
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem.mockImplementation(async (_system, text) => `译文：${text}`);
    const controller = new AbortController();
    const paragraphs = [
      { id: 'a', text: 'First paragraph.', elementPath: '#a' },
      { id: 'b', text: 'Second paragraph.', elementPath: '#b' },
    ];

    const response = await BatchTranslationService.translateBatch(makeRequest({
      mode, paragraphs,
    }), { signal: controller.signal, timeoutMs: 2500 });

    expect(response.apiCallCount).toBe(2);
    expect(response.results.map(item => item.id)).toEqual(['a', 'b']);
    expect(response.results.map(item => item.result)).toEqual(paragraphs.map(paragraph => ({
      words: [], sentences: [], fullText: `译文：${paragraph.text}`, _source: 'free_google',
    })));
    expect(mockedCallWithSystem.mock.calls.map(call => call[1])).toEqual(paragraphs.map(p => p.text));
    expect(mockedCallWithSystem.mock.calls.every(call => call[5]?.signal === controller.signal && call[5]?.timeoutMs === 2500)).toBe(true);
    expect(enhancedCache.set).toHaveBeenCalledTimes(2);
    expect(vi.mocked(enhancedCache.set).mock.calls.map(call => call[4]))
      .toEqual(['free_google', 'free_google']);
  });

  it('免费 Google 子段失败时不缓存先前译文，取消阻止后续请求', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'free_google_translate' }));
    mockedGetApiKey.mockResolvedValue('');
    const controller = new AbortController();
    mockedCallWithSystem.mockResolvedValueOnce('第一段译文').mockImplementationOnce(async () => {
      controller.abort();
      throw TransportError.cancelled();
    });
    const paragraphs = [
      { id: 'a', text: 'First paragraph.', elementPath: '#a' },
      { id: 'b', text: 'Second paragraph.', elementPath: '#b' },
      { id: 'c', text: 'Third paragraph.', elementPath: '#c' },
    ];

    await expect(BatchTranslationService.translateBatch(makeRequest({
      mode: 'bilingual', paragraphs,
    }), { signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('免费 Google 返回空译文时拒绝并不缓存', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'free_google_translate' }));
    mockedGetApiKey.mockResolvedValue('');
    mockedCallWithSystem.mockResolvedValue('  ');

    await expect(BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' })))
      .rejects.toMatchObject({ kind: 'unavailable' });
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('免费 Google 的批次经真实 API 适配器逐段请求原文并解码纯文本', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'free_google_translate' }));
    mockedGetApiKey.mockResolvedValue('');
    const actual = await vi.importActual<typeof import('@/background/translationApi')>('@/background/translationApi');
    mockedCallWithSystem.mockImplementation((...args) => actual.TranslationApiService.callWithSystem(...args));
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const text = new URL(url).searchParams.get('q');
      return new Response(JSON.stringify([[[`译文-${text}`, text]], null, 'en']));
    });
    vi.stubGlobal('fetch', fetchMock);
    const paragraphs = [
      { id: 'a', text: 'First paragraph.', elementPath: '#a' },
      { id: 'b', text: 'Second paragraph.', elementPath: '#b' },
    ];

    try {
      const response = await BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual', paragraphs }));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(call => new URL(call[0]).searchParams.get('q')))
        .toEqual(paragraphs.map(paragraph => paragraph.text));
      expect(response.results.map(item => item.result.fullText))
        .toEqual(paragraphs.map(paragraph => `译文-${paragraph.text}`));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Ollama 接近 10000 字符的 JSON 批次拆成有界请求，动态输出预算并保持结果顺序与超时', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama' }));
    mockedGetApiKey.mockResolvedValue('');
    const paragraphs = Array.from({ length: 15 }, (_, index) => ({
      id: `p${index}`,
      text: `Paragraph ${index} ${'longword '.repeat(71)}`,
      elementPath: `#p${index}`,
    }));
    const controller = new AbortController();
    mockedCallWithSystem.mockImplementation(async (_system, prompt) => {
      const ids = [...prompt.matchAll(/\[PARA_(\d+)\]\nParagraph (\d+)/g)];
      return JSON.stringify({ paragraphs: ids.map(([, id, original]) => ({ id, fullText: `译文 ${original}` })) });
    });

    const response = await BatchTranslationService.translateBatch(makeRequest({
      mode: 'bilingual', paragraphs,
    }), { signal: controller.signal, timeoutMs: 5000 });

    expect(paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0)).toBeLessThanOrEqual(10000);
    expect(mockedCallWithSystem.mock.calls.length).toBeGreaterThan(1);
    expect(response.apiCallCount).toBe(mockedCallWithSystem.mock.calls.length);
    expect(response.results.map(item => item.id)).toEqual(paragraphs.map(item => item.id));
    expect(response.results.map(item => item.result.fullText))
      .toEqual(paragraphs.map((_, index) => `译文 ${index}`));
    for (const call of mockedCallWithSystem.mock.calls) {
      const prompt = call[1];
      expect(prompt.length).toBeLessThan(3000);
      expect(call[5]?.signal).toBeInstanceOf(AbortSignal);
      expect(call[5]?.timeoutMs).toBeGreaterThan(0);
      expect(call[5]?.timeoutMs).toBeLessThanOrEqual(5000);
      expect(call[5]?.maxTokens).toBeGreaterThan(1024);
      expect(call[5]?.maxTokens).toBeLessThanOrEqual(4096);
    }
    expect(enhancedCache.set).toHaveBeenCalledTimes(15);
  });

  it('Ollama 后续子批次失败时不缓存先前子批次的部分译文', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama' }));
    mockedCallWithSystem
      .mockResolvedValueOnce('{"paragraphs":[{"id":"0","fullText":"第一段"}]}')
      .mockRejectedValueOnce(new Error('model unavailable'));
    const request = makeRequest({ mode: 'bilingual', paragraphs: [
      { id: 'p1', text: 'alpha '.repeat(350), elementPath: '#p1' },
      { id: 'p2', text: 'bravo '.repeat(350), elementPath: '#p2' },
    ] });

    await expect(BatchTranslationService.translateBatch(request)).rejects.toThrow('model unavailable');
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('Ollama 子批次共用超时预算，超时后不继续请求或缓存', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama' }));
    const start = Date.now();
    let elapsed = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => start + elapsed);
    mockedCallWithSystem.mockImplementationOnce(async () => {
      elapsed = 5001;
      return '{"paragraphs":[{"id":"0","fullText":"第一段"}]}';
    });
    const request = makeRequest({ mode: 'bilingual', paragraphs: [
      { id: 'p1', text: 'alpha '.repeat(350), elementPath: '#p1' },
      { id: 'p2', text: 'bravo '.repeat(350), elementPath: '#p2' },
    ] });

    try {
      await expect(BatchTranslationService.translateBatch(request, { timeoutMs: 5000 }))
        .rejects.toMatchObject({ kind: 'timeout' });
      expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
      expect(enhancedCache.set).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it('Ollama 的重试等待被批次截止时间中止，超时不误报取消或写入缓存', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama' }));
    mockedCallWithSystem.mockImplementationOnce((_system, _prompt, _key, _settings, retry, options) => {
      expect(retry.maxRetries).toBeGreaterThan(0);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve('{"paragraphs":[{"id":"0","fullText":"迟到的译文"}]}'), 150);
        options?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(TransportError.cancelled());
        }, { once: true });
      });
    });

    await expect(BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' }), { timeoutMs: 20 }))
      .rejects.toMatchObject({ kind: 'timeout' });
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('Ollama 真实传输层 503 重试等待也遵守批次截止时间，不发第二次请求', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama' }));
    const actual = await vi.importActual<typeof import('@/background/translationApi')>('@/background/translationApi');
    mockedCallWithSystem.mockImplementation((...args) => actual.TranslationApiService.callWithSystem(...args));
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":{"message":"retry"}}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' }), { timeoutMs: 25 }))
        .rejects.toMatchObject({ kind: 'timeout' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(enhancedCache.set).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Ollama 重试等待期间由调用方取消仍报告取消而不是超时', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama' }));
    const actual = await vi.importActual<typeof import('@/background/translationApi')>('@/background/translationApi');
    mockedCallWithSystem.mockImplementation((...args) => actual.TranslationApiService.callWithSystem(...args));
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":{"message":"retry"}}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    try {
      const request = BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' }), {
        signal: controller.signal, timeoutMs: 5000,
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      controller.abort();
      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
      expect(enhancedCache.set).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Ollama 末批完成时已超过截止时间也不返回成功或缓存', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama' }));
    mockedCallWithSystem.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 35));
      return '{"paragraphs":[{"id":"0","fullText":"迟到的译文"}]}';
    });

    await expect(BatchTranslationService.translateBatch(makeRequest({ mode: 'bilingual' }), { timeoutMs: 10 }))
      .rejects.toMatchObject({ kind: 'timeout' });
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('Ollama 单段超出子批次预算时仍限制输出 token，不放宽请求超时', async () => {
    mockedGetSettings.mockResolvedValue(createMockSettings({ apiProvider: 'ollama' }));
    mockedCallWithSystem.mockResolvedValue('{"paragraphs":[{"id":"0","fullText":"长段译文"}]}');
    const request = makeRequest({ mode: 'bilingual', paragraphs: [
      { id: 'large', text: 'example '.repeat(1100), elementPath: '#large' },
    ] });

    const response = await BatchTranslationService.translateBatch(request);

    expect(response.results[0].result.fullText).toBe('长段译文');
    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    expect(mockedCallWithSystem.mock.calls[0][5]?.maxTokens).toBe(4096);
    expect(mockedCallWithSystem.mock.calls[0][5]?.timeoutMs).toBeGreaterThan(0);
    expect(mockedCallWithSystem.mock.calls[0][5]?.timeoutMs).toBeLessThanOrEqual(90000);
  });

  it('首段缓存写入期间取消后，不写后续段落也不返回成功', async () => {
    const controller = new AbortController();
    mockedCallWithSystem.mockResolvedValue(JSON.stringify({ paragraphs: [
      { id: '0', fullText: '第一段', words: [], sentences: [] },
      { id: '1', fullText: '第二段', words: [], sentences: [] },
    ] }));
    vi.mocked(enhancedCache.set).mockImplementationOnce(async () => { controller.abort(); });
    await expect(BatchTranslationService.translateBatch(makeRequest({
      mode: 'bilingual', paragraphs: [
        { id: 'p1', text: 'The first paragraph.', elementPath: '#p1' },
        { id: 'p2', text: 'The second paragraph.', elementPath: '#p2' },
      ],
    }), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(enhancedCache.set).toHaveBeenCalledTimes(1);
  });

  it('预先取消的批次不读取配置、不查缓存', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(BatchTranslationService.translateBatch(makeRequest(), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(mockedGetSettings).not.toHaveBeenCalled();
    expect(enhancedCache.getBatch).not.toHaveBeenCalled();
  });

  it('读取批量缓存期间取消，即使命中也不返回成功', async () => {
    const controller = new AbortController();
    vi.mocked(enhancedCache.getBatch).mockImplementationOnce(async hashes => {
      controller.abort();
      return { hits: new Map([[hashes[0], { words: [], sentences: [] }]]), misses: [] };
    });
    await expect(BatchTranslationService.translateBatch(makeRequest(), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(mockedCallWithSystem).not.toHaveBeenCalled();
  });

  it('配置日志不含 API Key 及其前缀', async () => {
    const secret = 'SENTINEL-BATCH-KEY';
    mockedGetApiKey.mockResolvedValue(secret);
    await BatchTranslationService.translateBatch(makeRequest());
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(secret.slice(0, 8));
  });

  it('options 透传到 callWithSystem 末位参数', async () => {
    mockedCallWithSystem.mockResolvedValue(
      JSON.stringify({
        paragraphs: [{ id: '0', fullText: 'x', words: [], sentences: [] }],
      })
    );

    const controller = new AbortController();
    const request = makeRequest({
      paragraphs: [
        { id: 'p1', text: 'The internationalization of markets accelerated.', elementPath: '#p1' },
      ],
      userLevel: makeProfile({ estimatedVocabulary: 3000, knownWords: [] }),
    });

    await BatchTranslationService.translateBatch(request, {
      signal: controller.signal,
      timeoutMs: 5000,
    });

    expect(mockedCallWithSystem).toHaveBeenCalledTimes(1);
    const callArgs = mockedCallWithSystem.mock.calls[0] as unknown as unknown[];
    expect(callArgs[5]).toMatchObject({ signal: controller.signal, timeoutMs: 5000 });
  });
});
