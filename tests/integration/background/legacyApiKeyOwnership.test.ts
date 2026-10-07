import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@/shared/types';

vi.mock('@/background/enhancedCache', () => ({ enhancedCache: {
  initialize: vi.fn(async () => undefined),
  getGeneration: vi.fn(() => 0),
  generateHash: vi.fn(() => 'cache-key'),
  get: vi.fn(async () => null),
  getBatch: vi.fn(async () => ({ hits: new Map(), misses: ['cache-key'] })),
  set: vi.fn(async () => undefined),
} }));
vi.mock('@/background/translationApi', () => ({ TranslationApiService: {
  callWithSystem: vi.fn(async () => JSON.stringify({
    fullText: '译文', words: [], sentences: [], paragraphs: [{ id: 'p1', fullText: '译文' }],
  })),
  quickTranslate: vi.fn(),
} }));
vi.mock('@/shared/performance', () => ({ MetricType: {
  CACHE_OPERATION: 'cache', API_RESPONSE_TIME: 'api', TRANSLATION_TOTAL_TIME: 'total',
}, recordMetric: vi.fn() }));
vi.mock('@/shared/utils', async () => ({
  ...await vi.importActual<typeof import('@/shared/utils')>('@/shared/utils'),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { StorageManager } from '@/background/storage';
import { TranslationService } from '@/background/translation';
import { BatchTranslationService } from '@/background/batchTranslation';
import { TranslationApiService } from '@/background/translationApi';

const profile: UserProfile = {
  examType: 'cet4', estimatedVocabulary: 3000, knownWords: [], unknownWords: [],
  levelConfidence: 0.5, createdAt: 0, updatedAt: 0,
};
const text = 'This unusually long sentence needs a careful translation.';
const flows = [
  { name: '单段', run: () => TranslationService.translate({ text, userLevel: profile, mode: 'bilingual' }) },
  { name: '批量', run: () => BatchTranslationService.translateBatch({
    paragraphs: [{ id: 'p1', text, elementPath: '#p1' }],
    pageUrl: 'https://page.example', mode: 'bilingual', userLevel: profile,
  }) },
];

function setupStorage() {
  let stored: Record<string, unknown> = { settings: {}, apiKey: 'LEGACY_OPENAI_KEY' };
  const get = vi.fn(async (keys: string | string[]) => Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]]),
  ));
  const set = vi.fn(async (updates: Record<string, unknown>) => { stored = { ...stored, ...updates }; });
  vi.stubGlobal('chrome', { storage: { sync: { get, set }, local: { get: vi.fn(async () => ({})) } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupStorage();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(flows)('旧版密钥归属与 $name 翻译链路', ({ run }) => {
  it('未迁移的默认 OpenAI 配置仍能将旧密钥传给默认端点', async () => {
    await run();

    expect(TranslationApiService.callWithSystem).toHaveBeenCalledOnce();
    expect(vi.mocked(TranslationApiService.callWithSystem).mock.calls[0].slice(2, 4)).toEqual([
      'LEGACY_OPENAI_KEY', expect.objectContaining({ apiProvider: 'openai', customApiUrl: '' }),
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['anthropic', 'custom'] as const)('旧快照读取后，设置页切换 %s 并覆盖旧字段时不外发新密钥', async apiProvider => {
    const originalGetApiKey = StorageManager.getApiKey.bind(StorageManager);
    vi.spyOn(StorageManager, 'getApiKey').mockImplementationOnce(async settings => {
      // 复现设置页先 UPDATE_SETTINGS、后写旧版 apiKey 的实际顺序。
      await StorageManager.updateSettings({
        apiProvider,
        customApiUrl: apiProvider === 'custom' ? 'https://new.example/v1' : '',
        apiConfigs: [{ id: 'new', name: '新配置', provider: apiProvider, apiKey: 'NEW_PROVIDER_KEY', tested: false, createdAt: 0 }],
        activeApiConfigId: 'new',
      }, settings?.apiConfigsRevision ?? 0);
      await chrome.storage.sync.set({ apiKey: 'NEW_PROVIDER_KEY' });
      return originalGetApiKey(settings);
    });

    await expect(run()).rejects.toThrow();

    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    expect(TranslationApiService.quickTranslate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['保存恢复', '直接恢复'] as const)('A→B→A 且 B 密钥延迟写入旧字段时拒绝外发：%s', async restore => {
    const snapshotA = await StorageManager.getSettings();
    const originalGetApiKey = StorageManager.getApiKey.bind(StorageManager);
    vi.spyOn(StorageManager, 'getApiKey').mockImplementationOnce(async settings => {
      await StorageManager.updateSettings({ apiProvider: 'custom', customApiUrl: 'https://b.example/v1' });
      await chrome.storage.sync.set({ apiKey: 'KEY_B' });
      if (restore === '保存恢复') await StorageManager.saveSettings(snapshotA);
      else await chrome.storage.sync.set({ settings: snapshotA });
      // 模拟另一窗口在恢复之后才完成旧字段写入，不能靠清空一次密钥保护。
      await chrome.storage.sync.set({ apiKey: 'KEY_B' });
      return originalGetApiKey(settings);
    });

    await expect(run()).rejects.toThrow();
    await expect(run()).rejects.toThrow();
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    expect(TranslationApiService.quickTranslate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('旧快照有效但核验存储失败时拒绝外发', async () => {
    const originalGetApiKey = StorageManager.getApiKey.bind(StorageManager);
    vi.spyOn(StorageManager, 'getApiKey').mockImplementationOnce(async settings => {
      vi.mocked(chrome.storage.sync.get).mockRejectedValueOnce(new Error('存储不可用'));
      return originalGetApiKey(settings);
    });

    await expect(run()).rejects.toThrow('存储不可用');
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
