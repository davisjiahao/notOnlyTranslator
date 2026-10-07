import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageManager } from '@/background/storage';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@/shared/constants';
import type { ApiConfig, UserSettings } from '@/shared/types';

const updateSettings = StorageManager.updateSettings.bind(StorageManager);

const configA: ApiConfig = {
  id: 'a', name: '配置 A', provider: 'openai', apiKey: 'TEST_ONLY_EXPLICIT_A_KEY',
  tested: false, createdAt: 1,
};
const configB: ApiConfig = {
  id: 'b', name: '配置 B', provider: 'openai', apiKey: 'TEST_ONLY_EXPLICIT_B_KEY',
  tested: false, createdAt: 2,
};
const { apiConfigsRevision: _defaultRevision, ...legacyDefaults } = DEFAULT_SETTINGS as UserSettings;
const initialSettings: UserSettings = {
  ...legacyDefaults,
  apiConfigs: [configA, configB],
  activeApiConfigId: configA.id,
};
let stored: Record<string, unknown>;

beforeEach(() => {
  stored = { [STORAGE_KEYS.SYNC.SETTINGS]: structuredClone(initialSettings) };
  // Chrome Storage 会复制对象，两个窗口的读取不能共享可变数组引用。
  const get = vi.fn(async (keys: string | string[]) => structuredClone(Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]]),
  )));
  const set = vi.fn(async (updates: Record<string, unknown>) => {
    stored = { ...stored, ...structuredClone(updates) };
  });
  vi.stubGlobal('chrome', { storage: { sync: { get, set } } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('StorageManager API 配置版本写入边界', () => {
  it('旧设置缺少版本时按 0 接受匹配提交，并持久化递增版本', async () => {
    await expect(updateSettings({ apiConfigs: [configB], activeApiConfigId: configB.id }, 0))
      .resolves.toBeUndefined();

    expect(await StorageManager.getSettings()).toMatchObject({
      apiConfigs: [configB],
      activeApiConfigId: configB.id,
      apiConfigsRevision: 1,
    });
    expect(stored[STORAGE_KEYS.SYNC.SETTINGS]).toMatchObject({ apiConfigsRevision: 1 });
  });

  it('两个窗口读到 [A,B] 后，删除 A 必须使旧快照 [A,B′] 被拒绝且 A 的显式密钥不复活', async () => {
    const [firstWindow, secondWindow] = await Promise.all([
      StorageManager.getSettings(), StorageManager.getSettings(),
    ]) as [UserSettings, UserSettings];
    const remainingConfigs = firstWindow.apiConfigs.filter(config => config.id !== configA.id);
    await updateSettings({ apiConfigs: remainingConfigs, activeApiConfigId: configB.id }, firstWindow.apiConfigsRevision ?? 0);

    const staleConfigs = secondWindow.apiConfigs.map(config => config.id === configB.id
      ? { ...config, name: '配置 B 的旧窗口编辑' }
      : config);
    await expect.soft(updateSettings({
      apiConfigs: staleConfigs,
      activeApiConfigId: secondWindow.activeApiConfigId,
    }, secondWindow.apiConfigsRevision ?? 0)).rejects.toThrow();

    const saved = await StorageManager.getSettings();
    expect.soft(saved.apiConfigs).toEqual(remainingConfigs);
    expect.soft(saved.apiConfigs.some(config => config.apiKey === configA.apiKey)).toBe(false);
    expect.soft(saved.activeApiConfigId).toBe(configB.id);
    expect(secondWindow.apiConfigs).toEqual([configA, configB]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('普通非配置更新不需要版本，并保留配置及其已有版本', async () => {
    stored = {
      ...stored,
      [STORAGE_KEYS.SYNC.SETTINGS]: { ...initialSettings, apiConfigsRevision: 7 },
    };

    await expect(StorageManager.updateSettings({ theme: 'dark', enabled: false })).resolves.toBeUndefined();

    expect(await StorageManager.getSettings()).toMatchObject({
      theme: 'dark', enabled: false,
      apiConfigs: [configA, configB], activeApiConfigId: configA.id, apiConfigsRevision: 7,
    });
  });

  it('排队中的旧快照在前一个延迟写入完成后重新校验版本，拒绝后队列仍可用', async () => {
    const write = vi.mocked(chrome.storage.sync.set).getMockImplementation()!;
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const writing = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(chrome.storage.sync.set).mockImplementationOnce(async updates => {
      started();
      await blocked;
      await write(updates);
    });

    const first = updateSettings({ apiConfigs: [configB], activeApiConfigId: configB.id }, 0);
    await writing;
    const stale = updateSettings({ apiConfigs: [configA, { ...configB, name: '旧窗口' }] }, 0);
    const results = Promise.allSettled([first, stale]);
    release();

    expect(await results).toMatchObject([{ status: 'fulfilled' }, { status: 'rejected' }]);
    await StorageManager.updateSettings({ theme: 'dark' });
    expect(await StorageManager.getSettings()).toMatchObject({
      apiConfigs: [configB], activeApiConfigId: configB.id, apiConfigsRevision: 1, theme: 'dark',
    });
  });

  it('旧格式可信导入保留未提供的设置，但不能采用备份版本或倒退后台版本', async () => {
    stored = {
      ...stored,
      [STORAGE_KEYS.SYNC.SETTINGS]: { ...initialSettings, theme: 'dark', apiConfigsRevision: 7 },
    };
    const settings: Partial<UserSettings> = { apiConfigs: [configB], apiConfigsRevision: 0 };
    await StorageManager.importData({ settings });
    expect(await StorageManager.getSettings()).toMatchObject({ theme: 'dark', apiConfigs: [configB], apiConfigsRevision: 8 });
  });

  it('普通更新不能利用设置内的版本字段倒退后台版本', async () => {
    stored = {
      ...stored,
      [STORAGE_KEYS.SYNC.SETTINGS]: { ...initialSettings, apiConfigsRevision: 7 },
    };
    const updates: Partial<UserSettings> = { theme: 'dark', apiConfigsRevision: 0 };
    await StorageManager.updateSettings(updates);
    expect(await StorageManager.getSettings()).toMatchObject({ theme: 'dark', apiConfigsRevision: 7 });
  });

  it.each([
    { label: '缺失', revision: undefined },
    { label: '过旧', revision: 6 },
    { label: '超前', revision: 8 },
    { label: '空值', revision: null },
    { label: '字符串', revision: '7' },
  ])('配置数组提交的版本$label时拒绝写入，不改变现有配置和密钥', async ({ revision }) => {
    stored = {
      ...stored,
      [STORAGE_KEYS.SYNC.SETTINGS]: { ...initialSettings, apiConfigsRevision: 7 },
    };
    const before = await StorageManager.getSettings();
    const updates = { apiConfigs: [configB], activeApiConfigId: configB.id };
    // 非法运行时输入不能依赖 TypeScript 类型保护；缺失版本使用真实的单参数调用。
    const pending = revision === undefined
      ? StorageManager.updateSettings(updates)
      : updateSettings(updates, revision as number);

    await expect.soft(pending).rejects.toThrow();
    expect.soft(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect.soft(await StorageManager.getSettings()).toEqual(before);
  });

  // 第二次设置读取（saveSettings 内部）期间落盘的 Chrome Sync 外部写入。
  const hookExternalWriteDuringSecondRead = (external: Record<string, unknown>) => {
    const get = vi.mocked(chrome.storage.sync.get).getMockImplementation()!;
    let reads = 0;
    vi.mocked(chrome.storage.sync.get).mockImplementation(async (keys: string | string[]) => {
      reads += 1;
      if (reads === 2) stored = { ...stored, ...structuredClone(external) };
      return get(keys);
    });
  };

  it('版本校验读取与写入之间的外部同步写入必须被拒绝：旧配置不得复活、版本不得停滞', async () => {
    hookExternalWriteDuringSecondRead({ [STORAGE_KEYS.SYNC.SETTINGS]: {
      ...initialSettings, apiConfigs: [configB], activeApiConfigId: configB.id, apiConfigsRevision: 1,
    } });

    await expect(updateSettings(
      { apiConfigs: [{ ...configA, name: '本窗口重命名' }], activeApiConfigId: configA.id }, 0,
    )).rejects.toThrow();

    const saved = await StorageManager.getSettings();
    expect.soft(saved.apiConfigs).toEqual([configB]);
    expect.soft(saved.apiConfigsRevision).toBe(1);
    expect(saved.apiConfigs.some(config => config.apiKey === configA.apiKey)).toBe(false);
  });

  it('普通更新的写入不得回退外部已推进的版本或复活其已删除的配置', async () => {
    stored = {
      ...stored,
      [STORAGE_KEYS.SYNC.SETTINGS]: { ...initialSettings, apiConfigsRevision: 7 },
    };
    hookExternalWriteDuringSecondRead({ [STORAGE_KEYS.SYNC.SETTINGS]: {
      ...initialSettings, apiConfigs: [configB], activeApiConfigId: configB.id, apiConfigsRevision: 8,
    } });

    await expect(StorageManager.updateSettings({ theme: 'dark' })).rejects.toThrow();

    const saved = await StorageManager.getSettings();
    expect.soft(saved.apiConfigs).toEqual([configB]);
    expect.soft(saved.apiConfigsRevision).toBe(8);
    expect(saved.theme).toBe('system');
  });

  it('混合凭据更新在校验后写入前的外部凭据变更同样必须被拒绝（同类双读防护）', async () => {
    const hybridBase = {
      ...DEFAULT_SETTINGS.hybridTranslation!,
      traditionalProvider: 'deepl' as const,
      traditionalApiKey: 'TEST_ONLY_HYBRID_OLD',
    };
    stored = {
      ...stored,
      [STORAGE_KEYS.SYNC.SETTINGS]: { ...initialSettings, hybridTranslation: hybridBase, hybridCredentialsRevision: 5 },
    };
    hookExternalWriteDuringSecondRead({ [STORAGE_KEYS.SYNC.SETTINGS]: {
      ...initialSettings,
      hybridTranslation: { ...hybridBase, traditionalApiKey: 'TEST_ONLY_HYBRID_EXTERNAL' },
      hybridCredentialsRevision: 6,
    } });

    await expect(StorageManager.updateSettings(
      { hybridTranslationPatch: { traditionalApiKey: 'TEST_ONLY_HYBRID_NEW' } }, undefined, 5
    )).rejects.toThrow();

    const saved = await StorageManager.getSettings();
    expect.soft(saved.hybridTranslation.traditionalApiKey).toBe('TEST_ONLY_HYBRID_EXTERNAL');
    expect(saved.hybridCredentialsRevision).toBe(6);
  });

  it('clearAllData 版本墓碑后直接保存旧设置不能回退更高持久版本', async () => {
    // clearAllData 落盘的版本墓碑：无用户数据，版本已推进。
    stored = { [STORAGE_KEYS.SYNC.SETTINGS]: { apiConfigsRevision: 4, hybridCredentialsRevision: 1 } };
    const stale: UserSettings = {
      ...legacyDefaults,
      apiConfigs: [configA],
      activeApiConfigId: configA.id,
      apiConfigsRevision: 0,
    };

    // 仅保留墓碑版本并不够：旧密钥与配置同样不能复活。
    await expect(StorageManager.saveSettings(stale)).rejects.toThrow('API 配置已变更');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(stored).toEqual({ [STORAGE_KEYS.SYNC.SETTINGS]: {
      apiConfigsRevision: 4, hybridCredentialsRevision: 1,
    } });
  });
});
