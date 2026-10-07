import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageManager } from '@/background/storage';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserSettings } from '@/shared/types';

type Settings = UserSettings & { hybridCredentialsRevision?: number };
type Update = Partial<Settings> & { hybridTranslationPatch?: Partial<NonNullable<UserSettings['hybridTranslation']>> };
const update = StorageManager.updateSettings.bind(StorageManager) as (
  updates: Update, expectedApiConfigsRevision?: number, expectedHybridCredentialsRevision?: number,
) => Promise<void>;
const original: Settings = {
  ...DEFAULT_SETTINGS, hybridCredentialsRevision: 7,
  hybridTranslation: { ...DEFAULT_SETTINGS.hybridTranslation!, traditionalApiKey: 'TEST_ONLY_OLD_DEEPL_KEY' },
};
let stored: Record<string, unknown>;

beforeEach(() => {
  stored = { settings: structuredClone(original) };
  vi.stubGlobal('chrome', { storage: { sync: {
    get: vi.fn(async (_keys: unknown) => structuredClone(stored)),
    set: vi.fn(async (updates: Record<string, unknown>) => { stored = { ...stored, ...structuredClone(updates) }; }),
    remove: vi.fn(async (keys: string[]) => {
      stored = Object.fromEntries(Object.entries(stored).filter(([key]) => !keys.includes(key)));
    }),
  }, local: { clear: vi.fn() } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('混合设置 patch 的队列合并和凭据 CAS', () => {
  it('无版本普通 patch 合并最新嵌套配置，不写入 patch 或载荷伪造的版本', async () => {
    await update({ hybridTranslationPatch: { priority: 'speed' }, hybridCredentialsRevision: 999 });
    expect(stored.settings).toMatchObject({
      hybridCredentialsRevision: 7,
      hybridTranslation: { ...original.hybridTranslation, priority: 'speed' },
    });
    expect(stored.settings).not.toHaveProperty('hybridTranslationPatch');
    expect(original.hybridTranslation?.priority).toBe(DEFAULT_SETTINGS.hybridTranslation?.priority);
  });

  it('并发普通 patch 在队列内合并，互不覆盖另一项变更', async () => {
    await Promise.all([
      update({ hybridTranslationPatch: { priority: 'speed' } }),
      update({ hybridTranslationPatch: { defaultEngine: 'traditional' } }),
    ]);
    expect(stored.settings).toMatchObject({ hybridCredentialsRevision: 7, hybridTranslation: {
      ...original.hybridTranslation, priority: 'speed', defaultEngine: 'traditional',
    } });
  });

  it('仅切换提供商时清除旧密钥并递增版本，重复旧版本不能恢复凭据', async () => {
    await update({ hybridTranslationPatch: { traditionalProvider: 'google_translate' } }, undefined, 7);
    expect(stored.settings).toMatchObject({ hybridCredentialsRevision: 8, hybridTranslation: {
      traditionalProvider: 'google_translate', traditionalApiKey: '',
    } });
    await expect(update({ hybridTranslationPatch: { traditionalApiKey: 'TEST_ONLY_OLD_DEEPL_KEY' } }, undefined, 7))
      .rejects.toThrow(/刷新/);
    // 即使伪装成新版本，归属保护清键也必须推进版本，不能为下一次重放保留版本。
    await update({ hybridTranslationPatch: { traditionalApiKey: 'TEST_ONLY_OLD_DEEPL_KEY' } }, undefined, 8);
    expect(stored.settings).toMatchObject({ hybridCredentialsRevision: 9, hybridTranslation: { traditionalApiKey: '' } });
    await update({ hybridTranslationPatch: { traditionalApiKey: 'TEST_ONLY_NEW_GOOGLE_KEY' } }, undefined, 9);
    expect(stored.settings).toMatchObject({ hybridCredentialsRevision: 10, hybridTranslation: {
      traditionalProvider: 'google_translate', traditionalApiKey: 'TEST_ONLY_NEW_GOOGLE_KEY',
    } });
  });

  it.each([undefined, null, '7', 6, 8])('凭据 patch 版本 %s 不匹配时禁止写入', async revision => {
    await expect(update({ hybridTranslationPatch: { traditionalApiKey: '' } }, undefined, revision as number))
      .rejects.toThrow(/刷新/);
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it('旧整块携带凭据却没有版本时拒绝，不能绕过 patch 的 CAS', async () => {
    await expect(update({ hybridTranslation: original.hybridTranslation })).rejects.toThrow(/刷新/);
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it('版本必须在队列内校验：两个同版本凭据修改只有一个成功', async () => {
    const results = await Promise.allSettled([
      update({ hybridTranslationPatch: { traditionalApiKey: '' } }, undefined, 7),
      update({ hybridTranslationPatch: { traditionalApiKey: 'TEST_ONLY_REPLAY' } }, undefined, 7),
    ]);
    expect(results).toMatchObject([{ status: 'fulfilled' }, { status: 'rejected' }]);
    expect(stored.settings).toMatchObject({ hybridCredentialsRevision: 8, hybridTranslation: { traditionalApiKey: '' } });
  });

  it('显式备份恢复忽略备份版本，清空继续推进凭据版本并拒绝旧凭据 patch', async () => {
    await StorageManager.replaceSettings({ ...original, hybridCredentialsRevision: 0 } as Settings);
    expect(stored.settings).toMatchObject({ hybridCredentialsRevision: 8 });
    await StorageManager.clearAllData();
    expect(stored.settings).toMatchObject({ hybridCredentialsRevision: 9 });
    await expect(update({ hybridTranslationPatch: { traditionalApiKey: 'TEST_ONLY_OLD_DEEPL_KEY' } }, undefined, 8))
      .rejects.toThrow(/刷新/);
  });

  it.each([null, [], 'bad', { traditionalProvider: 'openai' }, { traditionalApiKey: 5 },
    { priority: 'invalid' }, { enabled: 1 }, { simpleTextThreshold: -1 }, { unknownField: 'bad' }])(
    '拒绝无效 patch %j，不落库非法字段', async hybridTranslationPatch => {
      await expect(update({ hybridTranslationPatch } as Update, undefined, 7)).rejects.toThrow();
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    },
  );

  it('同时包含整块与 patch 时拒绝歧义载荷', async () => {
    await expect(update({ hybridTranslation: original.hybridTranslation, hybridTranslationPatch: { priority: 'speed' } }, undefined, 7))
      .rejects.toThrow();
  });
});
