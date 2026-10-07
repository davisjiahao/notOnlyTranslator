import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageManager } from '@/background/storage';
import { HybridTranslationService } from '@/background/hybridTranslation';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserSettings } from '@/shared/types';

const original: UserSettings = {
  ...DEFAULT_SETTINGS,
  hybridTranslation: {
    ...DEFAULT_SETTINGS.hybridTranslation!, enabled: true, defaultEngine: 'traditional',
    traditionalProvider: 'deepl', traditionalApiKey: 'TEST_ONLY_DEEPL_REPLAY_KEY',
  },
};
const replay: UserSettings = {
  ...original,
  hybridTranslation: { ...original.hybridTranslation!, traditionalProvider: 'google_translate' },
};
let stored: Record<string, unknown>;

beforeEach(() => {
  stored = { settings: structuredClone(original) };
  vi.stubGlobal('chrome', { storage: {
    sync: {
      get: vi.fn(async (_keys: unknown) => structuredClone(stored)),
      set: vi.fn(async (updates: Record<string, unknown>) => { stored = { ...stored, ...structuredClone(updates) }; }),
    },
    local: { get: vi.fn(async () => ({})), set: vi.fn() },
  } });
  // 真实服务构造请求，仅 mock 最终 fetch；记录请求可证明旧键没有流向 Google。
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    data: { translations: [{ translatedText: '本地测试译文' }] },
  }))));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const writers = [
  { name: '全量保存', write: (manager: typeof StorageManager, settings: UserSettings) => manager.saveSettings(settings) },
  { name: '增量更新', write: async (manager: typeof StorageManager, settings: UserSettings) => manager.updateSettings(
    { hybridTranslation: settings.hybridTranslation }, undefined, (await manager.getSettings()).hybridCredentialsRevision,
  ) },
  { name: '旧格式导入', write: (manager: typeof StorageManager, settings: UserSettings) => manager.importData({ settings: { hybridTranslation: settings.hybridTranslation } }) },
  { name: '覆盖恢复', write: (manager: typeof StorageManager, settings: UserSettings) => manager.replaceSettings(settings) },
];

describe.each(writers)('传统凭据跨提供商重放：$name', ({ write }) => {
  it('重复同一载荷三次仍然清空旧键，真实 Google 传输不能拿到 DeepL 密钥', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await write(StorageManager, replay);
      expect.soft((await StorageManager.getSettings()).hybridTranslation?.traditionalApiKey).toBe('');
    }
    await expect.soft(HybridTranslationService.quickTranslate('Replay must not leak credentials')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(replay.hybridTranslation?.traditionalApiKey).toBe('TEST_ONLY_DEEPL_REPLAY_KEY');
  });

  it('后台模块重建后仍然拒绝重放，但接受真正的新 Google 密钥', async () => {
    await write(StorageManager, replay);
    vi.resetModules();
    const { StorageManager: restarted } = await import('@/background/storage');
    await write(restarted, replay);
    expect((await restarted.getSettings()).hybridTranslation?.traditionalApiKey).toBe('');
    const next = {
      ...replay, hybridTranslation: { ...replay.hybridTranslation!, traditionalApiKey: 'TEST_ONLY_NEW_GOOGLE_KEY' },
    };
    await write(restarted, next);
    expect((await restarted.getSettings()).hybridTranslation).toEqual(next.hybridTranslation);
    // 归属元数据不能保存另一份明文凭据。
    const { settings: _settings, ...metadata } = stored;
    expect(JSON.stringify(metadata)).not.toContain('TEST_ONLY_DEEPL_REPLAY_KEY');
    expect(JSON.stringify(metadata)).not.toContain('TEST_ONLY_NEW_GOOGLE_KEY');
  });
});
