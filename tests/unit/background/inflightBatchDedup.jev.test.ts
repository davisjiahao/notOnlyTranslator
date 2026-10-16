/**
 * 在途去重的 Jev 绕行测试
 *
 * 契约要点：
 * - Jev 适用时不参与 join：同键并发请求各自执行，直接调用批量服务并传设置/密钥快照
 * - 旧链 join 行为不变（同键并发只执行一次）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BatchTranslationRequest, UserProfile, UserSettings } from '@/shared/types';

vi.mock('@/background/storage', () => ({
  StorageManager: { getUserProfile: vi.fn(), getSettings: vi.fn(), getApiKey: vi.fn() },
}));
vi.mock('@/background/batchTranslation', () => ({
  BatchTranslationService: { translateBatch: vi.fn() },
}));
vi.mock('@/background/enhancedCache', () => ({
  enhancedCache: { generateHash: vi.fn((text: string) => `key-${text}`) },
}));
vi.mock('@/shared/utils', async importOriginal => ({
  ...(await importOriginal<object>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/shared/utils/jev', () => ({ getJevEligibility: vi.fn(() => undefined) }));

import { translateBatchWithJoin, clearInflightBatches } from '@/background/inflightBatchDedup';
import { BatchTranslationService } from '@/background/batchTranslation';
import { StorageManager } from '@/background/storage';
import { getJevEligibility } from '@/shared/utils/jev';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  vocabularyAssessmentProvider: 'jev',
  phraseTranslationEnabled: false,
  grammarTranslationEnabled: false,
} as UserSettings;
const PROFILE = { ...DEFAULT_USER_PROFILE, estimatedVocabulary: 3000 } as unknown as UserProfile;

const request = (): BatchTranslationRequest => ({
  paragraphs: [{ id: 'p1', text: 'Same paragraph text.', elementPath: '#el-1' }],
  mode: 'inline-only',
  pageUrl: 'https://example.com/article',
});

const responseOf = (req: BatchTranslationRequest) => ({
  results: req.paragraphs.map(paragraph => ({
    id: paragraph.id,
    result: { words: [], sentences: [] },
    cached: false,
  })),
  apiCallCount: req.paragraphs.length,
  cacheHitCount: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getJevEligibility).mockReturnValue(undefined);
  clearInflightBatches();
  vi.mocked(StorageManager.getUserProfile).mockResolvedValue(PROFILE);
  vi.mocked(StorageManager.getSettings).mockResolvedValue(SETTINGS);
  vi.mocked(StorageManager.getApiKey).mockResolvedValue('llm-key');
  vi.mocked(BatchTranslationService.translateBatch).mockImplementation(async req => responseOf(req));
});

afterEach(() => {
  clearInflightBatches();
  vi.restoreAllMocks();
});

describe('Jev 绕过去重', () => {
  it('Jev 适用：同键并发不 join，各自直达批量服务并携带快照', async () => {
    const [a, b] = await Promise.all([translateBatchWithJoin(request()), translateBatchWithJoin(request())]);
    expect(BatchTranslationService.translateBatch).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(BatchTranslationService.translateBatch).mock.calls) {
      expect(call[2]).toMatchObject({ settings: SETTINGS, apiKey: 'llm-key', startedAt: expect.any(Number), jevSignal: expect.any(AbortSignal) });
    }
    expect(a.results[0].id).toBe('p1');
    expect(b.results[0].id).toBe('p1');
  });

  // join 用 deferred 保证第二个请求到达时第一个仍在途
  const joinOnce = async () => {
    let release!: (value: ReturnType<typeof responseOf>) => void;
    vi.mocked(BatchTranslationService.translateBatch).mockImplementation(req =>
      new Promise(resolve => { release = () => resolve(responseOf(req)); }));
    const pair = [translateBatchWithJoin(request()), translateBatchWithJoin(request())];
    await new Promise(resolve => setTimeout(resolve, 0));
    release();
    await Promise.all(pair);
    expect(BatchTranslationService.translateBatch).toHaveBeenCalledTimes(1);
  };

  it('legacy 设置：同键并发仍 join 为一次执行', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...SETTINGS, vocabularyAssessmentProvider: 'legacy' } as UserSettings);
    await joinOnce();
  });

  it('jev 设置但不适用：同键并发仍 join 为一次执行', async () => {
    vi.mocked(getJevEligibility).mockReturnValue('unsupported-level');
    await joinOnce();
  });
});
