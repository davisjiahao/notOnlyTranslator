import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 仅隔离持久化、日志和未使用的引擎；单段、批量、恢复、本地词典、难度和传输均使用真实实现。
vi.mock('@/background/storage', () => ({ StorageManager: {
  getSettings: vi.fn(), getApiKey: vi.fn(), getUserProfile: vi.fn(),
} }));
vi.mock('@/background/pendingRequestQueue', () => ({ pendingRequestQueue: {
  add: vi.fn().mockResolvedValue(undefined), trackCleanup: vi.fn(),
} }));
vi.mock('@/background/hybridTranslation', () => ({ HybridTranslationService: { translate: vi.fn() } }));
vi.mock('@/background/deeplTranslation', () => ({ DeepLTranslationService: { translate: vi.fn() } }));
vi.mock('@/background/enhancedCache', () => ({ enhancedCache: {
  getGeneration: vi.fn(() => 0),
  get: vi.fn().mockResolvedValue(null),
  getBatch: vi.fn(async (hashes: string[]) => ({ hits: new Map(), misses: [...hashes] })),
  generateHash: vi.fn((text: string, mode: string) => `${mode}:${text}`),
  set: vi.fn().mockResolvedValue(undefined),
} }));
vi.mock('@/shared/performance', () => ({
  MetricType: { CACHE_OPERATION: 'cache_operation', API_RESPONSE_TIME: 'api_response_time',
    TRANSLATION_TOTAL_TIME: 'translation_total_time' },
  recordMetric: vi.fn(),
}));
vi.mock('@/shared/utils', async () => ({
  ...await vi.importActual<typeof import('@/shared/utils')>('@/shared/utils'),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { handleTranslationMessage } from '@/background/translationMessages';
import { StorageManager } from '@/background/storage';
import { enhancedCache } from '@/background/enhancedCache';
import { clearWordSenseCache, lookupWord, resetOfflineWordSource, resolveLocalCandidates } from '@/background/localWordLookup';
import { assessWordDifficulty } from '@/shared/utils/vocabularyService';
import { getCEFRLevelByVocabulary } from '@/shared/constants/mastery';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { BatchTranslationResponse, MessageResponse, TranslationResult, UserProfile } from '@/shared/types';

const text = 'The ubiquitous phenomenon demonstrates an ephemeral yet idiosyncratic juxtaposition of unprecedented complexity and inherent ambiguity.';
const profile: UserProfile = {
  examType: 'cet4', estimatedVocabulary: 4500, knownWords: [], unknownWords: [],
  levelConfidence: 0.5, createdAt: 0, updatedAt: 0,
};
const fetchMock = vi.fn<typeof fetch>();
const response = (data: unknown) => new Response(JSON.stringify(data), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});
const outputLimit = () => response({ choices: [{ finish_reason: 'length', message: { content: null } }] });
const contentResponse = (content: string) => response({ choices: [{ finish_reason: 'stop', message: { content } }] });
const recoveryResponse = (words: unknown, isBatch: boolean) => contentResponse(JSON.stringify(
  isBatch ? { paragraphs: [{ id: 'PARA_0', words }] } : { words }
));
const dispatch = (isBatch = true) => handleTranslationMessage(isBatch ? {
  type: 'BATCH_TRANSLATE_TEXT',
  payload: { mode: 'inline-only', pageUrl: 'https://example.test',
    paragraphs: [{ id: 'fixed', text, elementPath: '#fixed' }] },
} : {
  type: 'TRANSLATE_TEXT', payload: { text, mode: 'inline-only' },
}, { tab: { id: 1 } } as chrome.runtime.MessageSender);
const translation = (result: MessageResponse, isBatch: boolean): TranslationResult => isBatch
  ? (result.data as BatchTranslationResponse).results[0].result : result.data as TranslationResult;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset().mockRejectedValue(new Error('未安排的额外请求'));
  vi.stubGlobal('fetch', fetchMock);
  resetOfflineWordSource();
  clearWordSenseCache();
  vi.mocked(StorageManager.getUserProfile).mockResolvedValue({ ...profile, knownWords: [], unknownWords: [] });
  vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS,
    translationMode: 'inline-only', phraseTranslationEnabled: true, grammarTranslationEnabled: true,
    apiProvider: 'custom', customApiUrl: 'https://translator.test/v1/chat/completions',
    customModelName: 'synthetic-model',
  });
  vi.mocked(StorageManager.getApiKey).mockResolvedValue('synthetic-test-key');
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetOfflineWordSource();
  clearWordSenseCache();
});

describe('流式请求的普通 JSON 回退兼容', () => {
  it.each([undefined, '0', 'custom-id'])('未收到增量时仍接受既有段落 ID 格式：%s', async id => {
    fetchMock.mockResolvedValueOnce(contentResponse(JSON.stringify({
      paragraphs: [{ id, words: [], sentences: [], fullText: '普通 JSON 完整译文' }],
    })));
    const result = await dispatch();
    expect(result.success).toBe(true);
    expect(translation(result, true).fullText).toBe('普通 JSON 完整译文');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).stream).toBe(true);
    expect(enhancedCache.set).toHaveBeenCalledTimes(1);
  });
});

describe('固定文本的真实本地筛选', () => {
  it('默认行为不变：4500 映射 B2，启发式零候选不是词典缺失', async () => {
    expect(getCEFRLevelByVocabulary(profile.estimatedVocabulary)).toBe('B2');
    const resolution = resolveLocalCandidates(text, profile, { context: text });
    expect(resolution.candidates).toHaveLength(0);
    expect(resolution.needsContext).toHaveLength(0);
    expect(resolution.result.words).toHaveLength(0);
    const assessments = await Promise.all((text.match(/[a-zA-Z]+/g) ?? []).map(async original => {
      const { level, confidence, isCommon } = assessWordDifficulty(original);
      const lookup = await lookupWord(original, { context: text, userProfile: profile });
      return { word: original.toLowerCase(), level, confidence,
        assessmentSource: isCommon ? '常用词表' : confidence === 0.75 ? '学术词表' : '长度词缀启发式',
        lookupSource: lookup?.source ?? null };
    }));
    expect(assessments.map(({ word, level }) => [word, level])).toEqual([
      ['the', 'A1'], ['ubiquitous', 'B1'], ['phenomenon', 'B1'], ['demonstrates', 'B1'],
      ['an', 'A1'], ['ephemeral', 'B1'], ['yet', 'A2'], ['idiosyncratic', 'B1'],
      ['juxtaposition', 'B1'], ['of', 'A1'], ['unprecedented', 'B1'], ['complexity', 'B1'],
      ['and', 'A1'], ['inherent', 'B1'], ['ambiguity', 'B1'],
    ]);
    expect(assessments.every(item => item.lookupSource === 'dictionary')).toBe(true);
    expect(assessments.filter(item => item.level !== 'A1').every(item =>
      item.confidence === 0.6 && item.assessmentSource === '长度词缀启发式')).toBe(true);
    expect(assessments.filter(item => item.level === 'A1').every(item =>
      item.confidence === 0.8 && item.assessmentSource === '常用词表')).toBe(true);
  });
});

describe.each([false, true])('输出耗尽后的低置信度复核，批量=%s', isBatch => {
  it('恢复真实文本的可见词义，但不把所有低置信度词自动当作难词', async () => {
    fetchMock.mockResolvedValueOnce(outputLimit()).mockResolvedValueOnce(recoveryResponse([
      { original: 'ubiquitous', translation: '无处不在的', position: [0, 1] },
    ], isBatch));
    const result = await dispatch(isBatch);
    expect(result.success).toBe(true);
    expect(translation(result, isBatch).words).toEqual([expect.objectContaining({
      original: 'ubiquitous', translation: '无处不在的', position: [4, 14],
    })]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
    const { messages } = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(messages[0].content).toContain('B2');
    expect(messages[0].content).toContain('4500');
    expect(messages[0].content).toContain('超出');
    expect(messages[0].content).toContain('禁止整句翻译');
    if (isBatch) expect(result.data).toMatchObject({ apiCallCount: 2, cacheHitCount: 0 });
  });

  it('已知词和高置信度基础词不进入复核，不采纳模型伪造词及偏移', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue({ ...profile, knownWords: ['ubiquitous'] });
    fetchMock.mockResolvedValueOnce(outputLimit()).mockResolvedValueOnce(recoveryResponse([
      { original: 'ephemeral', translation: '短暂的', position: [0, 1] },
      { original: 'ubiquitous', translation: '不应新增已知词' },
      { original: 'The', translation: '不应新增基础词' },
      { original: 'fabricated', translation: '不应新增原文外词' },
    ], isBatch));
    const result = await dispatch(isBatch);
    expect(result.success).toBe(true);
    expect(translation(result, isBatch).words).toEqual([expect.objectContaining({
      original: 'ephemeral', position: [text.indexOf('ephemeral'), text.indexOf('ephemeral') + 9],
    })]);
    const { messages } = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    const candidates: string[] = isBatch ? JSON.parse(messages[1].content).paragraphs[0].candidates
      : [...(messages[1].content as string).matchAll(/^\d+\. (.+)$/gm)].map(match => match[1]);
    expect(candidates).toContain('ephemeral');
    expect(candidates).not.toContain('ubiquitous');
    expect(candidates).not.toContain('The');
    expect(candidates).not.toContain('an');
    expect(candidates).not.toContain('of');
    expect(candidates).not.toContain('and');
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('模型明确返回合法空选择时允许零词，但不得缓存为完整分析', async () => {
    fetchMock.mockResolvedValueOnce(outputLimit()).mockResolvedValueOnce(recoveryResponse([], isBatch));
    const result = await dispatch(isBatch);
    expect(result.success).toBe(true);
    expect(translation(result, isBatch).words).toEqual([]);
    expect(translation(result, isBatch)._source).toBe('llm');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each([null, [null], [{ original: 'ubiquitous', translation: '' }],
    [{ original: 'ubiquitous', translation: 123 }],
    [{ original: 'fabricated', translation: '伪造的' }],
    [{ original: 'ubiquitous!', translation: '不能归一化后接纳非原文词' }],
  ].map(words => ({ words })))('无效词义结构或非原文选择 $words 不能伪装为合法空选择', async ({ words }) => {
    fetchMock.mockResolvedValueOnce(outputLimit()).mockResolvedValueOnce(recoveryResponse(words, isBatch));
    expect(await dispatch(isBatch)).toMatchObject({ success: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('损坏的恢复JSON明确失败，不递归请求', async () => {
    fetchMock.mockResolvedValueOnce(outputLimit()).mockResolvedValueOnce(contentResponse('not json'));
    expect(await dispatch(isBatch)).toMatchObject({ success: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('复核再次耗尽时明确失败，最多追加一次请求', async () => {
    fetchMock.mockResolvedValueOnce(outputLimit()).mockResolvedValueOnce(outputLimit());
    expect(await dispatch(isBatch)).toMatchObject({ success: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('非基础词全部已知时无需复核，也不新增基础词', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue({ ...profile,
      knownWords: (text.match(/[a-zA-Z]+/g) ?? []).filter(word => !assessWordDifficulty(word).isCommon),
    });
    fetchMock.mockResolvedValueOnce(outputLimit());
    const result = await dispatch(isBatch);
    expect(result.success).toBe(true);
    expect(translation(result, isBatch).words).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('已有生词及可靠本地释义时直接可见恢复，不为增加次数而请求模型', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue({ ...profile, unknownWords: [{
      word: 'ubiquitous', context: text, translation: '用户确认的词义', markedAt: 0, reviewCount: 0,
    }] });
    fetchMock.mockResolvedValueOnce(outputLimit());
    const result = await dispatch(isBatch);
    expect(result.success).toBe(true);
    expect(translation(result, isBatch).words).toEqual([expect.objectContaining({
      original: 'ubiquitous', translation: '用户确认的词义', position: [4, 14],
    })]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });
});
