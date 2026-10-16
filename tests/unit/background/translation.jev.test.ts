/**
 * 单段翻译的 Jev 阅读策略接入测试
 *
 * 契约要点：
 * - intent==='reading' 且启用 jev 时在 <=3 词本地短路前选策略
 * - 识别失败（JevAssessmentError）且总预算有效：回退原链一次并标记 {provider:'legacy',reason:'固定原因'}
 * - 不适用（模式/服务商等）：走原链并标记固定 reason
 * - 释义失败、配置变化、取消、总 deadline：传播，不回退
 * - intent 缺失（旧查词行为）或 legacy 设置：完全不触碰 Jev，结果无标记
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TranslationRequest, UserProfile, UserSettings } from '@/shared/types';

vi.mock('@/background/storage', () => ({
  StorageManager: { getSettings: vi.fn(), getApiKey: vi.fn() },
}));
vi.mock('@/background/translationApi', () => ({
  TranslationApiService: { callWithSystem: vi.fn(), quickTranslate: vi.fn() },
}));
vi.mock('@/background/translationRequest', () => ({
  executeTransportRequest: vi.fn(),
  TRANSPORT_DEFAULTS: { legacyEngineTimeoutMs: 1000, llmTimeoutMs: 60_000, localLlmTimeoutMs: 90_000 },
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
    getBatch: vi.fn().mockResolvedValue({ hits: new Map() }),
    set: vi.fn().mockResolvedValue(undefined),
    generateHash: vi.fn().mockReturnValue('test-cache-key'),
  },
}));
vi.mock('@/background/hybridTranslation', () => ({
  HybridTranslationService: { translate: vi.fn() },
}));
vi.mock('@/background/deeplTranslation', () => ({
  DeepLTranslationService: { translate: vi.fn(), quickTranslate: vi.fn() },
}));
vi.mock('@/shared/utils', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  generateCacheKey: vi.fn().mockReturnValue('test-cache-key'),
  extractJsonFromResponse: vi.fn((content: string) => content),
}));
vi.mock('@/shared/utils/jev', () => ({ getJevEligibility: vi.fn(() => undefined) }));
vi.mock('@/background/jevTranslation', async importOriginal => ({
  ...(await importOriginal<object>()),
  translateJevReading: vi.fn(),
  recordJevAssessment: vi.fn(),
}));

import { TranslationService } from '@/background/translation';
import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { getJevEligibility } from '@/shared/utils/jev';
import { translateJevReading, JevAssessmentError, JevConfigChangedError } from '@/background/jevTranslation';
import { TransportError } from '@/shared/utils/translationErrors';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';

const TEXT = 'The serendipitous encounter changed her perspective entirely.';
const SETTINGS = {
  ...DEFAULT_SETTINGS,
  vocabularyAssessmentProvider: 'jev',
  phraseTranslationEnabled: false,
  grammarTranslationEnabled: false,
} as UserSettings;
const PROFILE = { ...DEFAULT_USER_PROFILE, estimatedVocabulary: 3000 } as unknown as UserProfile;

const JEV_WORD = { original: 'serendipitous', translation: '意外幸运的', position: [4, 17] as [number, number], difficulty: 8, isPhrase: false };
const LEGACY_JSON = JSON.stringify({
  words: [{ original: 'encounter', translation: '遭遇', position: [19, 27], difficulty: 6, isPhrase: false }],
  sentences: [],
});

const request = (over: Partial<TranslationRequest> = {}): TranslationRequest => ({
  text: TEXT,
  context: '',
  userLevel: PROFILE,
  mode: 'inline-only',
  intent: 'reading',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getJevEligibility).mockReturnValue(undefined);
  vi.mocked(StorageManager.getSettings).mockResolvedValue(SETTINGS);
  vi.mocked(StorageManager.getApiKey).mockResolvedValue('llm-key');
  vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(LEGACY_JSON);
  vi.mocked(translateJevReading).mockResolvedValue({
    result: { words: [JEV_WORD], sentences: [], vocabularyAssessment: { provider: 'jev' } },
    apiCallCount: 2,
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('单段阅读：Jev 策略选择', () => {
  it('阅读意图且适用：走 Jev 管线，不触碰旧 LLM 链', async () => {
    const result = await TranslationService.translate(request());
    expect(result.words).toEqual([JEV_WORD]);
    expect(result.vocabularyAssessment).toEqual({ provider: 'jev' });
    expect(translateJevReading).toHaveBeenCalledTimes(1);
    const [input] = vi.mocked(translateJevReading).mock.calls[0];
    expect(input).toMatchObject({ text: TEXT, profile: PROFILE, settings: SETTINGS, apiKey: 'llm-key' });
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('短段阅读也先选 Jev，不能被 <=3 词查词分支短路', async () => {
    await TranslationService.translate(request({ text: 'hello world' }));
    expect(translateJevReading).toHaveBeenCalledTimes(1);
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('识别失败回退沿用快照、剩余预算，不读写旧缓存', async () => {
    const { enhancedCache } = await import('@/background/enhancedCache');
    vi.mocked(translateJevReading).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      throw new JevAssessmentError('timeout');
    });
    const result = await TranslationService.translate(request(), { timeoutMs: 1000 });
    expect(result.vocabularyAssessment).toEqual({ provider: 'legacy', reason: 'timeout' });
    expect(StorageManager.getSettings).toHaveBeenCalledTimes(1);
    expect(StorageManager.getApiKey).toHaveBeenCalledTimes(1);
    expect(enhancedCache.get).not.toHaveBeenCalled();
    expect(enhancedCache.set).not.toHaveBeenCalled();
    const call = vi.mocked(TranslationApiService.callWithSystem).mock.calls[0];
    expect(call[3]).toBe(SETTINGS);
    expect(call[4]).toEqual({ maxRetries: 0 });
    expect(call[5]?.timeoutMs).toBeLessThan(1000);
  });

  it('识别失败且预算有效：回退原链一次并标记 固定原因', async () => {
    vi.mocked(translateJevReading).mockRejectedValue(new JevAssessmentError('unavailable'));
    const result = await TranslationService.translate(request());
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(1);
    expect(result.words[0]?.original).toBe('encounter');
    expect(result.vocabularyAssessment).toEqual({ provider: 'legacy', reason: 'unavailable' });
  });

  it('不适用（模式/服务商）：直接走原链并标记固定 reason，不调用 Jev', async () => {
    vi.mocked(getJevEligibility).mockReturnValue('unsupported-mode');
    const bilingual = JSON.stringify({
      words: [{ original: 'encounter', translation: '遭遇', position: [19, 27], difficulty: 6, isPhrase: false }],
      sentences: [],
      fullText: '完整译文',
    });
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(bilingual);
    const result = await TranslationService.translate(request({ mode: 'bilingual' }));
    expect(translateJevReading).not.toHaveBeenCalled();
    expect(result.vocabularyAssessment).toEqual({ provider: 'legacy', reason: 'unsupported-mode' });
  });

  it('释义失败（非识别错误）：传播，不回退', async () => {
    vi.mocked(translateJevReading).mockRejectedValue(new Error('模型未返回有效的语境释义，请重试'));
    await expect(TranslationService.translate(request())).rejects.toThrow('模型未返回有效的语境释义');
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('配置在途变化：传播，不回退', async () => {
    vi.mocked(translateJevReading).mockRejectedValue(new JevConfigChangedError('配置已变化'));
    await expect(TranslationService.translate(request())).rejects.toBeInstanceOf(JevConfigChangedError);
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('总 deadline 耗尽：传播超时，不回退', async () => {
    vi.mocked(translateJevReading).mockRejectedValue(TransportError.timeout(90_000));
    await expect(TranslationService.translate(request())).rejects.toMatchObject({ kind: 'timeout' });
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('用户取消：传播，不回退', async () => {
    const controller = new AbortController();
    vi.mocked(translateJevReading).mockImplementation(() => {
      controller.abort();
      return Promise.reject(controller.signal.reason);
    });
    await expect(TranslationService.translate(request(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });
});

describe('单段阅读：旧行为回归', () => {
  it('intent 缺失（查词）：不触碰 Jev，结果无标记', async () => {
    const result = await TranslationService.translate(request({ intent: undefined }));
    expect(translateJevReading).not.toHaveBeenCalled();
    expect(getJevEligibility).not.toHaveBeenCalled();
    expect(result.vocabularyAssessment).toBeUndefined();
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(1);
  });

  it('legacy 设置 + 阅读意图：不触碰 Jev，结果无标记', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...SETTINGS, vocabularyAssessmentProvider: 'legacy' } as UserSettings);
    const result = await TranslationService.translate(request());
    expect(translateJevReading).not.toHaveBeenCalled();
    expect(result.vocabularyAssessment).toBeUndefined();
  });
});
