/**
 * 去重键与实际翻译的设置快照一致性测试（真实 BatchTranslationService）
 *
 * 契约：去重模块首读快照 A 后，真实服务必须用同一份 A 完成翻译与缓存写入，
 * 不得自读拿到已切换的快照 B（防"服务忽略 preloaded"回归）：
 * - settings 读取总次数 = 1（preloaded 生效，服务不自读）；
 * - LLM API 调用收到 A 配置；
 * - 段落缓存写入键与 A 快照计算的键一致。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchTranslationRequest } from '@/shared/types';

// 后台依赖 mock：存储可变快照 + LLM 替身；被测服务与缓存真实执行
vi.mock('@/background/storage', () => ({
  StorageManager: {
    getUserProfile: vi.fn(),
    getSettings: vi.fn(),
    getApiKey: vi.fn(),
  },
}));
vi.mock('@/background/translationApi', () => ({
  TranslationApiService: { callWithSystem: vi.fn(), quickTranslate: vi.fn() },
}));
vi.mock('@/shared/utils', async importOriginal => ({
  ...(await importOriginal<object>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/shared/performance', () => ({
  recordMetric: vi.fn(),
  MetricsRegistry: { getInstance: vi.fn().mockReturnValue({ increment: vi.fn(), recordTimer: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }) },
}));

import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { enhancedCache } from '@/background/enhancedCache';
import { clearInflightBatches, translateBatchWithJoin } from '@/background/inflightBatchDedup';

const callWithSystem = vi.mocked(TranslationApiService.callWithSystem);

const PROFILE = { examType: 'cet4', examScore: 500, estimatedVocabulary: 4500 } as never;
const SETTINGS_A = { apiProvider: 'openai', customModelName: 'model-a' } as never;
const SETTINGS_B = { apiProvider: 'anthropic', customModelName: 'model-b' } as never;

beforeEach(() => {
  vi.clearAllMocks();
  clearInflightBatches();
  // chrome.storage 替身：enhancedCache 真实读写走内存快照（键参数兼容 string/string[]/null）
  const storage = new Map<string, unknown>();
  const toKeyList = (keys: string | string[] | null): string[] =>
    keys == null ? [...storage.keys()] : Array.isArray(keys) ? keys : [keys];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) => {
          const list = keys == null ? [...storage.keys()] : toKeyList(keys);
          return Object.fromEntries(list.map(key => [key, storage.get(key)]));
        }),
        set: vi.fn(async (items: Record<string, unknown>) => { Object.entries(items).forEach(([key, value]) => storage.set(key, value)); }),
        remove: vi.fn(async (keys: string | string[] | null) => { toKeyList(keys).forEach(key => storage.delete(key)); }),
      },
    },
  });
});

describe('去重键与设置快照一致性（真实服务）', () => {
  it('读键后切换配置：翻译与缓存写入仍使用首读快照 A', async () => {
    // 依次读取返回不同快照：去重模块读键时是 A，若真实服务自读则拿到 B
    let settingsReads = 0;
    let apiKeyReads = 0;
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(PROFILE);
    vi.mocked(StorageManager.getSettings).mockImplementation(async () =>
      (settingsReads++ === 0 ? SETTINGS_A : SETTINGS_B) as never);
    vi.mocked(StorageManager.getApiKey).mockImplementation(async () =>
      (apiKeyReads++ === 0 ? 'KEY-A' : 'KEY-B'));
    callWithSystem.mockResolvedValue(
      JSON.stringify({ paragraphs: [{ fullText: '按 A 配置翻译的译文。', words: [] }] }));

    await enhancedCache.clearAll();
    // spy 先行包装真实写入（不改变行为，仅捕获写入键）
    const cacheSetSpy = vi.spyOn(enhancedCache, 'set');
    const request = {
      paragraphs: [{ id: 'a1', text: 'Snapshot consistency text' }],
      mode: 'bilingual',
      pageUrl: 'https://example.org',
    } as BatchTranslationRequest;
    const response = await translateBatchWithJoin(request);

    // (a) preloaded 生效：真实服务不自读设置，全程只读一次
    expect(StorageManager.getSettings).toHaveBeenCalledTimes(1);
    expect(StorageManager.getApiKey).toHaveBeenCalledTimes(1);

    // (b) LLM API 调用收到 A 配置（callWithSystem 第 4 参数为 settings）
    expect(callWithSystem).toHaveBeenCalledTimes(1);
    expect(callWithSystem.mock.calls[0]?.[3]).toBe(SETTINGS_A);

    // (c) 缓存写入键与 A 快照计算的键一致（B 快照会产出不同键）
    const writeKey = cacheSetSpy.mock.calls[0]?.[0];
    const expectedKeyA = enhancedCache.generateHash('Snapshot consistency text', 'bilingual', {
      settings: SETTINGS_A, userLevel: PROFILE, context: 'KEY-A', engine: 'batch',
    });
    const wrongKeyB = enhancedCache.generateHash('Snapshot consistency text', 'bilingual', {
      settings: SETTINGS_B, userLevel: PROFILE, context: 'KEY-B', engine: 'batch',
    });
    expect(writeKey).toBe(expectedKeyA);
    expect(writeKey).not.toBe(wrongKeyB);

    expect(response.results[0]?.result.fullText).toBe('按 A 配置翻译的译文。');
  });
});
