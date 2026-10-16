/**
 * 批量翻译的 Jev 阅读管线测试
 *
 * 契约要点：
 * - 适用时逐段 Jev：最多 2 并发、onParagraph 按完成顺序渐进、最终结果按请求顺序
 * - Jev 结果不读写段落缓存；apiCallCount 如实合计（识别+释义）
 * - 单段识别失败且总预算有效：该段回退原链一次并标记 固定原因
 * - 取消/总 deadline/配置变化：传播，不回退
 * - 请求 jev 但不适用：旧链结果统一标记固定 reason；legacy 设置无标记
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BatchTranslationRequest, UserProfile, UserSettings } from '@/shared/types';

vi.mock('@/background/storage', () => ({
  StorageManager: { getUserProfile: vi.fn(), getSettings: vi.fn(), getApiKey: vi.fn() },
}));
vi.mock('@/background/translationApi', () => ({
  TranslationApiService: { callWithSystem: vi.fn() },
}));
vi.mock('@/background/translation', () => ({
  TranslationService: { translate: vi.fn() },
}));
vi.mock('@/background/translationRequest', () => ({
  boundedMaxTokens: vi.fn((value: number) => value),
  TRANSPORT_DEFAULTS: { llmTimeoutMs: 60_000, localLlmTimeoutMs: 90_000 },
}));
vi.mock('@/background/enhancedCache', () => ({
  enhancedCache: {
    getGeneration: vi.fn(() => 0),
    getBatch: vi.fn().mockResolvedValue({ hits: new Map() }),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    generateHash: vi.fn((text: string) => `hash-${text}`),
  },
}));
vi.mock('@/shared/utils', async importOriginal => ({
  ...(await importOriginal<object>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/shared/utils/jev', () => ({ getJevEligibility: vi.fn(() => undefined) }));
vi.mock('@/background/jevTranslation', async importOriginal => ({
  ...(await importOriginal<object>()),
  translateJevReading: vi.fn(),
  createJevSnapshot: vi.fn(async () => ({ jevKey: 'jev-key', fingerprint: 'snapshot' })),
  assertJevSnapshotCurrent: vi.fn(async () => {}),
  recordJevAssessment: vi.fn(),
}));

import { StorageManager } from '@/background/storage';
import { BatchTranslationService } from '@/background/batchTranslation';
import { TranslationService } from '@/background/translation';
import { TranslationApiService } from '@/background/translationApi';
import { enhancedCache } from '@/background/enhancedCache';
import { getJevEligibility } from '@/shared/utils/jev';
import { translateJevReading, JevAssessmentError, JevConfigChangedError, assertJevSnapshotCurrent } from '@/background/jevTranslation';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  vocabularyAssessmentProvider: 'jev',
  phraseTranslationEnabled: false,
  grammarTranslationEnabled: false,
} as UserSettings;
const PROFILE = { ...DEFAULT_USER_PROFILE, estimatedVocabulary: 3000 } as unknown as UserProfile;

const P1 = 'First paragraph with serendipity inside.';
const P2 = 'Second paragraph stays brief.';
const P3 = 'Third paragraph concludes the page.';

const makeRequest = (texts: string[], mode: BatchTranslationRequest['mode'] = 'inline-only'): BatchTranslationRequest => ({
  paragraphs: texts.map((text, index) => ({ id: `p${index + 1}`, text, elementPath: `#el-${index + 1}` })),
  mode,
  pageUrl: 'https://example.com/article',
});

const jevOutcome = (text: string, apiCallCount = 2) => ({
  result: {
    words: [{ original: text.split(' ')[2] ?? 'word', translation: '释义', position: [0, 4] as [number, number], difficulty: 5, isPhrase: false }],
    sentences: [],
    vocabularyAssessment: { provider: 'jev' as const },
  },
  apiCallCount,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getJevEligibility).mockReturnValue(undefined);
  vi.mocked(assertJevSnapshotCurrent).mockResolvedValue(undefined);
  vi.mocked(StorageManager.getUserProfile).mockResolvedValue(PROFILE);
  vi.mocked(StorageManager.getSettings).mockResolvedValue(SETTINGS);
  vi.mocked(StorageManager.getApiKey).mockResolvedValue('llm-key');
  vi.mocked(translateJevReading).mockImplementation(async ({ text }) => jevOutcome(text));
});

afterEach(() => { vi.restoreAllMocks(); });

describe('批量 Jev 阅读', () => {
  it('适用时逐段 Jev：跳过缓存读写，结果按请求顺序，apiCallCount 如实合计', async () => {
    const response = await BatchTranslationService.translateBatch(makeRequest([P1, P2]));
    expect(translateJevReading).toHaveBeenCalledTimes(2);
    expect(enhancedCache.getBatch).not.toHaveBeenCalled();
    expect(enhancedCache.set).not.toHaveBeenCalled();
    expect(enhancedCache.generateHash).not.toHaveBeenCalled();
    expect(response.results.map(entry => entry.id)).toEqual(['p1', 'p2']);
    expect(response.results.every(entry => entry.result.vocabularyAssessment?.provider === 'jev')).toBe(true);
    expect(response.apiCallCount).toBe(4);
    expect(response.cacheHitCount).toBe(0);
  });

  it('onParagraph 按完成顺序渐进，最终结果保持原顺序', async () => {
    const slow = new Promise<{ result: ReturnType<typeof jevOutcome>['result']; apiCallCount: number }>(resolve =>
      setTimeout(() => resolve(jevOutcome(P1)), 30));
    vi.mocked(translateJevReading).mockImplementation(({ text }) =>
      text === P1 ? slow : Promise.resolve(jevOutcome(text)));
    const published: string[] = [];
    const response = await BatchTranslationService.translateBatch(makeRequest([P1, P2]), {
      onParagraph: entry => { published.push(entry.id); },
    });
    expect(published).toEqual(['p2', 'p1']);
    expect(response.results.map(entry => entry.id)).toEqual(['p1', 'p2']);
  });

  it('并发不超过 2', async () => {
    let active = 0;
    let maxActive = 0;
    vi.mocked(translateJevReading).mockImplementation(async ({ text }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active -= 1;
      return jevOutcome(text);
    });
    await BatchTranslationService.translateBatch(makeRequest([P1, P2, P3]));
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(translateJevReading).toHaveBeenCalledTimes(3);
  });

  it('单段识别失败且预算有效：该段回退原链一次并标记 固定原因，其余段保持 jev', async () => {
    vi.mocked(translateJevReading).mockImplementation(({ text }) =>
      text === P1 ? Promise.reject(new JevAssessmentError('unavailable')) : Promise.resolve(jevOutcome(text)));
    vi.mocked(TranslationService.translate).mockResolvedValue({
      words: [{ original: 'serendipity', translation: '慧眼', position: [0, 4], difficulty: 5, isPhrase: false }],
      sentences: [],
    });
    const response = await BatchTranslationService.translateBatch(makeRequest([P1, P2]));
    expect(TranslationService.translate).toHaveBeenCalledTimes(1);
    const [fallbackRequest] = vi.mocked(TranslationService.translate).mock.calls[0];
    expect(fallbackRequest).toMatchObject({ text: P1, mode: 'inline-only' });
    expect(fallbackRequest.intent).toBeUndefined();
    expect(response.results[0].result.vocabularyAssessment).toEqual({ provider: 'legacy', reason: 'unavailable' });
    expect(response.results[1].result.vocabularyAssessment).toEqual({ provider: 'jev' });
  });

  it('最终异步复核超出 deadline：不返回成功', async () => {
    const { assertJevSnapshotCurrent } = await import('@/background/jevTranslation');
    vi.mocked(assertJevSnapshotCurrent).mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    await expect(BatchTranslationService.translateBatch(makeRequest([P1]), { timeoutMs: 10 })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('段落复核期间用户取消：不得发布进度', async () => {
    const { assertJevSnapshotCurrent } = await import('@/background/jevTranslation');
    const controller = new AbortController();
    const onParagraph = vi.fn();
    vi.mocked(assertJevSnapshotCurrent).mockImplementation(async () => { controller.abort(); });
    await expect(BatchTranslationService.translateBatch(makeRequest([P1]), { signal: controller.signal, onParagraph })).rejects.toMatchObject({ name: 'AbortError' });
    expect(onParagraph).not.toHaveBeenCalled();
  });

  it('配置在途变化：整批传播，不回退', async () => {
    vi.mocked(translateJevReading).mockRejectedValue(new JevConfigChangedError('配置已变化'));
    await expect(BatchTranslationService.translateBatch(makeRequest([P1]))).rejects.toBeInstanceOf(JevConfigChangedError);
    expect(TranslationService.translate).not.toHaveBeenCalled();
  });

  it('总预算耗尽：传播超时，不回退', async () => {
    vi.mocked(translateJevReading).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      throw new JevAssessmentError('unavailable');
    });
    await expect(
      BatchTranslationService.translateBatch(makeRequest([P1]), { timeoutMs: 5 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(TranslationService.translate).not.toHaveBeenCalled();
  });

  it('用户取消：传播，不回退', async () => {
    const controller = new AbortController();
    vi.mocked(translateJevReading).mockImplementation(() => {
      controller.abort();
      return Promise.reject(controller.signal.reason);
    });
    await expect(
      BatchTranslationService.translateBatch(makeRequest([P1]), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(TranslationService.translate).not.toHaveBeenCalled();
  });
});

describe('批量旧链回归', () => {
  const BATCH_JSON = JSON.stringify([
    { id: 'PARA_0', fullText: '译文一', words: [] },
    { id: 'PARA_1', fullText: '译文二', words: [] },
  ]);

  it('请求 jev 但不适用：旧链结果统一标记固定 reason', async () => {
    vi.mocked(getJevEligibility).mockReturnValue('unsupported-mode');
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(BATCH_JSON);
    const response = await BatchTranslationService.translateBatch(makeRequest([P1, P2], 'bilingual'));
    expect(translateJevReading).not.toHaveBeenCalled();
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(1);
    expect(response.results.every(entry =>
      entry.result.vocabularyAssessment?.provider === 'legacy'
      && entry.result.vocabularyAssessment.reason === 'unsupported-mode')).toBe(true);
  });

  it('legacy 设置：旧链无标记', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...SETTINGS, vocabularyAssessmentProvider: 'legacy' } as UserSettings);
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(BATCH_JSON);
    const response = await BatchTranslationService.translateBatch(makeRequest([P1, P2], 'bilingual'));
    expect(translateJevReading).not.toHaveBeenCalled();
    expect(response.results.every(entry => entry.result.vocabularyAssessment === undefined)).toBe(true);
  });
});
