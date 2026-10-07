import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageManager } from '@/background/storage';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserSettings } from '@/shared/types';

const original: UserSettings = {
  ...DEFAULT_SETTINGS,
  hybridTranslation: {
    ...DEFAULT_SETTINGS.hybridTranslation!,
    enabled: true,
    traditionalProvider: 'deepl',
    traditionalApiKey: 'DEEPL_ONLY_TEST_KEY',
  },
};
const changed: UserSettings = {
  ...original,
  hybridTranslation: { ...original.hybridTranslation!, traditionalProvider: 'google_translate' },
};

beforeEach(() => {
  let stored: Record<string, unknown> = { settings: original };
  const get = vi.fn(async (keys: string | string[]) => Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]]),
  ));
  const set = vi.fn(async (updates: Record<string, unknown>) => { stored = { ...stored, ...updates }; });
  vi.stubGlobal('chrome', { storage: { sync: { get, set } } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const writers = [
  { name: '全量保存', write: (settings: UserSettings) => StorageManager.saveSettings(settings) },
  { name: '增量更新', write: (settings: UserSettings) => StorageManager.updateSettings({ hybridTranslation: settings.hybridTranslation }, undefined, 0) },
  { name: '旧格式导入', write: (settings: UserSettings) => StorageManager.importData({ settings }) },
];

describe.each(writers)('传统独立密钥可信写入边界：$name', ({ write }) => {
  it('提供商切换携带旧密钥时，在同一次写入中清空旧密钥且不修改输入', async () => {
    await write(changed);

    expect(chrome.storage.sync.set).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      settings: expect.objectContaining({
        hybridTranslation: { ...changed.hybridTranslation, traditionalApiKey: '' },
      }),
    }));
    expect((await StorageManager.getSettings()).hybridTranslation?.traditionalApiKey).toBe('');
    expect(changed.hybridTranslation?.traditionalApiKey).toBe('DEEPL_ONLY_TEST_KEY');
    expect(original.hybridTranslation?.traditionalProvider).toBe('deepl');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['DEEPL_ONLY_TEST_KEY', 'DEEPL_NEW_KEY', '', undefined])('同提供商保存/编辑密钥 %j 不被误删', async traditionalApiKey => {
    const next = { ...original, hybridTranslation: { ...original.hybridTranslation!, traditionalApiKey } };
    await write(next);
    expect((await StorageManager.getSettings()).hybridTranslation).toEqual(next.hybridTranslation);
  });

  it('切换提供商时明确提供不同的新密钥仍可使用，无需新增元数据', async () => {
    const next = {
      ...changed,
      hybridTranslation: { ...changed.hybridTranslation!, traditionalApiKey: 'GOOGLE_NEW_TEST_KEY' },
    };
    await write(next);
    expect((await StorageManager.getSettings()).hybridTranslation).toEqual(next.hybridTranslation);
  });

  it('切换提供商且不携带独立密钥时不能补入旧密钥', async () => {
    const next = { ...changed, hybridTranslation: { ...changed.hybridTranslation!, traditionalApiKey: undefined } };
    await write(next);
    expect((await StorageManager.getSettings()).hybridTranslation?.traditionalApiKey).toBeUndefined();
  });

  it('无历史配置的旧版设置导入/首次保存仍可保留配对密钥', async () => {
    await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, hybridTranslation: undefined } });
    await write(changed);
    expect((await StorageManager.getSettings()).hybridTranslation).toEqual(changed.hybridTranslation);
  });

  it('无历史归属时非法提供商在归属记录前被拒绝，不写入也不污染归属表', async () => {
    await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, hybridTranslation: undefined } });
    const poisoned = {
      ...original,
      hybridTranslation: { ...original.hybridTranslation!, traditionalProvider: 'deep1' as never },
    };

    await expect(write(poisoned)).rejects.toThrow();
    // 只有准备无历史状态的那一次写入；非法提交不得落盘半套设置或归属记录。
    expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);

    // 归属表未被污染：同一密钥换合法提供商仍可正常绑定，不会被误判错主清空。
    const legitimate = {
      ...original,
      hybridTranslation: { ...original.hybridTranslation!, traditionalProvider: 'google_translate' },
    };
    await write(legitimate);
    expect((await StorageManager.getSettings()).hybridTranslation).toEqual(legitimate.hybridTranslation);
  });

  it.each(['deep1', 7, null])('非法提供商 %j 即使已有历史归属也整体拒绝写入', async provider => {
    const poisoned = {
      ...original,
      hybridTranslation: { ...original.hybridTranslation!, traditionalProvider: provider as never },
    };

    await expect(write(poisoned)).rejects.toThrow();
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect((await StorageManager.getSettings()).hybridTranslation).toEqual(original.hybridTranslation);
  });
});

describe('传统独立密钥写入的错误与队列边界', () => {
  it('未修改混合设置时保留旧密钥，清除混合设置时不崩溃', async () => {
    await StorageManager.updateSettings({ theme: 'dark' });
    expect((await StorageManager.getSettings()).hybridTranslation).toEqual(original.hybridTranslation);
    await StorageManager.updateSettings({ hybridTranslation: undefined }, undefined, 0);
    expect((await StorageManager.getSettings()).hybridTranslation).toBeUndefined();
  });

  it('存储读取失败时不盲写新的提供商', async () => {
    vi.mocked(chrome.storage.sync.get).mockRejectedValueOnce(new Error('读取失败'));
    await expect(StorageManager.saveSettings(changed)).rejects.toThrow('读取失败');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it('存储写入失败时保留原配对，重试仍会清除旧密钥', async () => {
    vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(new Error('写入失败'));
    await expect(StorageManager.updateSettings(changed, 0, 0)).rejects.toThrow('写入失败');
    expect((await StorageManager.getSettings()).hybridTranslation).toEqual(original.hybridTranslation);
    await StorageManager.updateSettings(changed, 0, 0);
    expect((await StorageManager.getSettings()).hybridTranslation?.traditionalApiKey).toBe('');
  });

  it('并发普通更新与提供商切换按既有队列保存且不复活旧密钥', async () => {
    await Promise.all([
      StorageManager.updateSettings({ theme: 'dark' }),
      StorageManager.updateSettings({ hybridTranslation: changed.hybridTranslation }, undefined, 0),
      StorageManager.importData({ settings: { enabled: false } }),
    ]);
    expect(await StorageManager.getSettings()).toMatchObject({
      theme: 'dark', enabled: false,
      hybridTranslation: { traditionalProvider: 'google_translate', traditionalApiKey: '' },
    });
  });
});
