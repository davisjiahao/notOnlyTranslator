import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchTranslationRequest, UserProfile, UserSettings } from '@/shared/types';
import type { JevItem } from '@/shared/utils/jevProtocol';

vi.mock('@/background/storage', () => ({ StorageManager: {
  getSettings: vi.fn(), getUserProfile: vi.fn(), getApiKey: vi.fn(),
} }));
vi.mock('@/background/jevCredentials', () => ({ getJevApiKey: vi.fn(async () => 'synthetic-jev-key') }));
vi.mock('@/background/translationApi', () => ({ TranslationApiService: { callWithSystem: vi.fn() } }));
vi.mock('@/background/translationRequest', async original => ({ ...(await original<object>()), executeTransportRequest: vi.fn() }));
vi.mock('@/background/enhancedCache', () => ({ enhancedCache: {
  getGeneration: vi.fn(() => 0), get: vi.fn(async () => null), getBatch: vi.fn(async () => ({ hits: new Map() })),
  set: vi.fn(async () => {}), generateHash: vi.fn(() => 'synthetic-hash'),
} }));
vi.mock('@/shared/utils', async original => ({ ...(await original<object>()),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/shared/performance', () => ({ MetricType: {}, recordMetric: vi.fn() }));

import { TranslationService } from '@/background/translation';
import { BatchTranslationService } from '@/background/batchTranslation';
import { translateBatchWithJoin } from '@/background/inflightBatchDedup';
import { TranslationApiService } from '@/background/translationApi';
import { StorageManager } from '@/background/storage';
import { executeTransportRequest } from '@/background/translationRequest';
import { resetJevRecognition } from '@/background/jevRecognition';
import { enhancedCache } from '@/background/enhancedCache';
import { TransportError } from '@/shared/utils/translationErrors';
import { DEFAULT_SETTINGS } from '@/shared/constants';

const settings: UserSettings = { ...DEFAULT_SETTINGS, apiProvider: 'openai', vocabularyAssessmentProvider: 'jev',
  phraseTranslationEnabled: false, grammarTranslationEnabled: false };
const profile: UserProfile = { examType: 'cet4', estimatedVocabulary: 3000, levelConfidence: 1,
  knownWords: ['She', 'a', 'They', 'beside', 'the'], unknownWords: [], createdAt: 0, updatedAt: 1 };
const request = (text: string): BatchTranslationRequest => ({
  paragraphs: [{ id: 'p1', text, elementPath: '#p1' }], mode: 'inline-only', pageUrl: 'https://example.test/',
});

let selectedIds: string[];
beforeEach(() => {
  vi.clearAllMocks();
  resetJevRecognition();
  selectedIds = [];
  vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => true) } });
  vi.mocked(StorageManager.getSettings).mockResolvedValue(settings);
  vi.mocked(StorageManager.getApiKey).mockResolvedValue('synthetic-llm-key');
  vi.mocked(StorageManager.getUserProfile).mockResolvedValue(profile);
  // 保留真实候选生成、拆批、阈值、缓存与取消，只替换网络边界。
  vi.mocked(executeTransportRequest).mockImplementation(async (_url, init, options) => {
    options.onAttemptStart?.();
    const body = JSON.parse(init.body as string) as { model: string; state: string };
    const items = (JSON.parse(body.state) as { items: JevItem[] }).items;
    selectedIds = [...selectedIds, ...items.map(item => item.id)];
    return options.onSuccess!({ model: body.model,
      answers: Object.fromEntries(items.map(item => [item.id, { type: 'noul', noul: item.target === 'book' ? 0.1 : 0.8 }])),
    });
  });
  vi.mocked(TranslationApiService.callWithSystem).mockImplementation(async (_system, user) => {
    const items = JSON.parse(user.split('候选词：\n')[1].split('\n上下文：')[0]) as JevItem[];
    return JSON.stringify({ words: items.map(item => ({ id: item.id, translation: item.id === 'j5' ? '预订' : '书籍' })) });
  });
});
afterEach(() => { resetJevRecognition(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Jev真实阅读入口（网络替身）', () => {
  it('自定义配置从真实批量阅读贯穿到transport，并使用配置阈值筛词', async () => {
    const config = { provider: 'custom' as const, apiUrl: 'https://recognition.example/v2/systemone', model: 'custom-jev', threshold: 0.9 };
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...settings, jevConfig: config });
    const response = await translateBatchWithJoin(request('She reads a book.'));
    expect(response.results[0].result.words).toEqual([]);
    expect(response.apiCallCount).toBe(1);
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://recognition.example/*'] });
    const [url, init] = vi.mocked(executeTransportRequest).mock.calls[0];
    expect(url).toBe(config.apiUrl);
    expect(JSON.parse(init.body as string).model).toBe(config.model);
  });
  it('重复词不同语境按 ID 释义，最终位置来自真实候选采集', async () => {
    const text = 'They book a book.';
    // 此例 book 被手工标未知，两个 occurrence 强制入选；Jev 无网络，释义各自保留。
    const forced: UserProfile = { ...profile, unknownWords: [{ word: 'book', context: '', translation: '', markedAt: 1, reviewCount: 0 }] };
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(forced);
    const result = await TranslationService.translate({ text, context: '', userLevel: forced, mode: 'inline-only', intent: 'reading' });
    expect(executeTransportRequest).not.toHaveBeenCalled();
    expect(result.vocabularyAssessment).toEqual({ provider: 'jev' });
    expect(result.words.map(word => [word.original, word.translation, word.position])).toEqual([
      ['book', '预订', [5, 9]], ['book', '书籍', [12, 16]],
    ]);
    expect(enhancedCache.get).not.toHaveBeenCalled();
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('known 优先 unknown 强制：同词两表均存在时不生成候选', async () => {
    const both: UserProfile = { ...profile, knownWords: [...profile.knownWords, 'book'],
      unknownWords: [{ word: 'book', context: '', translation: '', markedAt: 1, reviewCount: 0 }] };
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(both);
    const result = await TranslationService.translate({ text: 'She a book.', context: '', userLevel: both, mode: 'inline-only', intent: 'reading' });
    expect(result.words).toEqual([]);
    expect(executeTransportRequest).not.toHaveBeenCalled();
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('真实识别阈值排除 book，仅入选 IDs 发给释义；批量统计网络次数', async () => {
    const response = await translateBatchWithJoin(request('She reads a book.'));
    expect(response.apiCallCount).toBe(2);
    expect(response.results[0].result.words.map(word => word.original)).toEqual(['reads']);
    expect(selectedIds).toEqual(['j4', 'j12']);
    const [, userPrompt] = vi.mocked(TranslationApiService.callWithSystem).mock.calls[0];
    const items = JSON.parse(userPrompt.split('候选词：\n')[1].split('\n上下文：')[0]) as JevItem[];
    expect(items.map(item => item.target)).toEqual(['reads']);
    expect(enhancedCache.getBatch).not.toHaveBeenCalled();
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('识别内存命中只再调用释义：两次请求统计为 2、1，绕过旧 join', async () => {
    const req = request('She reads a book.');
    const a = await translateBatchWithJoin(req);
    const b = await translateBatchWithJoin(req);
    expect([a.apiCallCount, b.apiCallCount]).toEqual([2, 1]);
    expect(executeTransportRequest).toHaveBeenCalledTimes(1);
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(2);
  });

  it('识别 451 失败回退一次，计一次失败识别+一次旧 LLM，保留固定原因', async () => {
    vi.mocked(executeTransportRequest).mockImplementation(async (_url, _init, options) => {
      options.onAttemptStart?.();
      throw TransportError.unavailable('Jev 识别暂不可用', 451);
    });
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(JSON.stringify({ words: [], sentences: [] }));
    const response = await BatchTranslationService.translateBatch(request('Serendipity brings unexpected good fortune today.'));
    expect(response.apiCallCount).toBe(2);
    expect(response.results[0].result.vocabularyAssessment).toEqual({ provider: 'legacy', reason: 'region-restricted' });
    expect(executeTransportRequest).toHaveBeenCalledTimes(1);
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(1);
    expect(enhancedCache.get).not.toHaveBeenCalled();
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });
});
