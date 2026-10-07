import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageManager } from '@/background/storage';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserSettings } from '@/shared/types';

const settingsA: UserSettings = { ...DEFAULT_SETTINGS, apiConfigs: [] };
const settingsB: UserSettings = {
  ...DEFAULT_SETTINGS, apiProvider: 'custom', customApiUrl: 'https://b.example/v1',
  apiConfigs: [{ id: 'b', name: 'B', provider: 'custom', apiUrl: 'https://b.example/v1', apiKey: 'KEY_B', tested: false, createdAt: 0 }],
  activeApiConfigId: 'b',
};

function setupStorage() {
  let stored: Record<string, unknown> = { settings: settingsA, apiKey: 'KEY_A' };
  const get = vi.fn(async (keys: string | string[]) => Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]]),
  ));
  const set = vi.fn(async (updates: Record<string, unknown>) => { stored = { ...stored, ...updates }; });
  vi.stubGlobal('chrome', { storage: { sync: { get, set } } });
}

beforeEach(setupStorage);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('旧版密钥的持久失效边界', () => {
  it('未迁移的默认 OpenAI 配置修改非凭据设置后仍能使用旧键', async () => {
    expect(await StorageManager.getApiKey()).toBe('KEY_A');
    await StorageManager.updateSettings({ enabled: false });
    expect(await StorageManager.getApiKey()).toBe('KEY_A');
  });

  it('切换配置与清空旧键必须在同一次存储写入中提交', async () => {
    await StorageManager.saveSettings(settingsB);
    expect(chrome.storage.sync.set).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      settings: settingsB, apiKey: '',
    }));
  });

  it.each(['保存恢复', '直接恢复', '恢复后延迟写键'] as const)('A→B→A 后不能重新信任残留的 B 密钥：%s', async order => {
    const snapshotA = await StorageManager.getSettings();
    await StorageManager.saveSettings(settingsB);
    if (order === '直接恢复') {
      await chrome.storage.sync.set({ settings: settingsA, apiKey: 'KEY_B' });
    } else if (order === '恢复后延迟写键') {
      await StorageManager.saveSettings(settingsA);
      await chrome.storage.sync.set({ apiKey: 'KEY_B' });
    } else {
      await chrome.storage.sync.set({ apiKey: 'KEY_B' });
      await StorageManager.saveSettings(settingsA);
    }

    expect(await StorageManager.getApiKey(snapshotA)).toBe('');
    expect(await StorageManager.getApiKey()).toBe('');
  });

  it.each(['切换前', 'B 配置期间', '恢复 A 后'] as const)('saveApiKey 的无归属写入不能重新授予密钥权限：%s', async order => {
    const snapshotA = await StorageManager.getSettings();
    if (order === '切换前') {
      await StorageManager.saveApiKey('KEY_B');
      expect(await StorageManager.getApiKey(snapshotA)).toBe('');
    }
    await StorageManager.saveSettings(settingsB);
    if (order === 'B 配置期间') await StorageManager.saveApiKey('KEY_B');
    await StorageManager.saveSettings(settingsA);
    if (order === '恢复 A 后') await StorageManager.saveApiKey('KEY_B');

    expect(await StorageManager.getApiKey(snapshotA)).toBe('');
    expect(await StorageManager.getApiKey()).toBe('');
  });

  it('saveApiKey 的挂起写入在 A→B→A 完成后落盘，仍不能使旧字段重新生效', async () => {
    const write = vi.mocked(chrome.storage.sync.set).getMockImplementation()!;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(chrome.storage.sync.set).mockImplementationOnce(async updates => {
      await blocked;
      await write(updates);
    });
    const pending = StorageManager.saveApiKey('KEY_B');
    try {
      await StorageManager.saveSettings(settingsB);
      await StorageManager.saveSettings(settingsA);
    } finally {
      release();
      await pending;
    }

    expect(await StorageManager.getApiKey()).toBe('');
  });

  it.each([true, false, null, 0])('已存在但值为 %j 的失效标记不能被解释为重新授权', async flag => {
    await chrome.storage.sync.set({ legacyApiKeyInvalidated: flag });
    expect(await StorageManager.getApiKey()).toBe('');
  });

  it('只通过导入恢复旧设置，也不能恢复旧字段的可信归属', async () => {
    await StorageManager.updateSettings(settingsB, 0, 0);
    await chrome.storage.sync.set({ apiKey: 'KEY_B' });
    await StorageManager.importData({ settings: settingsA });
    await chrome.storage.sync.set({ apiKey: 'KEY_B' });

    expect(await StorageManager.getApiKey()).toBe('');
  });

  it('失效状态必须保存在存储中，后台模块重载后仍拒绝旧字段', async () => {
    await StorageManager.saveSettings(settingsB);
    await chrome.storage.sync.set({ settings: settingsA, apiKey: 'KEY_B' });
    vi.resetModules();
    const { StorageManager: ReloadedStorage } = await import('@/background/storage');

    expect(await ReloadedStorage.getApiKey()).toBe('');
  });

  it('旧字段失效不影响显式配置自身绑定的密钥', async () => {
    await StorageManager.saveSettings(settingsB);
    expect(await StorageManager.getApiKey()).toBe('KEY_B');
    const explicitA = {
      ...settingsA, activeApiConfigId: 'a',
      apiConfigs: [{ id: 'a', name: 'A', provider: 'openai' as const, apiKey: 'NEW_KEY_A', tested: false, createdAt: 0 }],
    };
    await StorageManager.saveSettings(explicitA);
    expect(await StorageManager.getApiKey()).toBe('NEW_KEY_A');
  });

  it('配置写入失败应传播错误，不再另发一次旧键清理或恢复写入', async () => {
    vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(new Error('写入失败'));
    await expect(StorageManager.saveSettings(settingsB)).rejects.toThrow('写入失败');
    expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);
  });
});
