import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageManager } from '@/background/storage';
import { DEFAULT_SETTINGS } from '@/shared/constants';

let syncData: Record<string, unknown>;
let localData: Record<string, unknown>;

beforeEach(() => {
  syncData = { settings: { ...DEFAULT_SETTINGS, apiConfigsRevision: 7 }, apiKey: 'TEST_ONLY_DELETE_KEY', userProfile: {} };
  localData = { knownWords: ['private'] };
  vi.stubGlobal('chrome', { storage: {
    sync: {
      get: vi.fn(async (_keys: unknown) => structuredClone(syncData)),
      set: vi.fn(async (updates: Record<string, unknown>) => { syncData = { ...syncData, ...structuredClone(updates) }; }),
      remove: vi.fn(async (keys: string[]) => {
        syncData = Object.fromEntries(Object.entries(syncData).filter(([key]) => !keys.includes(key)));
      }),
    },
    local: { clear: vi.fn(async () => { localData = {}; }) },
  } });
});
afterEach(() => vi.unstubAllGlobals());

describe('StorageManager.clearAllData 单元边界', () => {
  it('只持久保留递增版本，完整删除其他数据，输入对象不被修改', async () => {
    const original = syncData;
    await StorageManager.clearAllData();
    expect(syncData).toEqual({ settings: { apiConfigsRevision: 8, hybridCredentialsRevision: 1 } });
    expect(localData).toEqual({});
    expect(original).toMatchObject({ apiKey: 'TEST_ONLY_DELETE_KEY', settings: { apiConfigsRevision: 7 } });
  });

  it('没有设置的首次清空也产生非零版本，连续并发清空按队列递增', async () => {
    syncData = {};
    await Promise.all([StorageManager.clearAllData(), StorageManager.clearAllData()]);
    expect(syncData).toEqual({ settings: { apiConfigsRevision: 2, hybridCredentialsRevision: 2 } });
  });

  it.each([-1, 1.5, '7', Number.NaN, Number.MAX_SAFE_INTEGER])('非法或溢出版本 %s 不能被重置为 0 或发生精度碰撞', async revision => {
    syncData = { settings: { apiConfigsRevision: revision } };
    await expect(StorageManager.clearAllData()).rejects.toThrow('配置版本无效');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.storage.local.clear).not.toHaveBeenCalled();
  });

  it('写入墓碑失败时不删除数据，失败后队列仍可重试', async () => {
    vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(new Error('测试写入失败'));
    await expect(StorageManager.clearAllData()).rejects.toThrow('测试写入失败');
    expect(chrome.storage.sync.remove).not.toHaveBeenCalled();
    expect(localData).toEqual({ knownWords: ['private'] });
    await StorageManager.clearAllData();
    expect(syncData).toEqual({ settings: { apiConfigsRevision: 8, hybridCredentialsRevision: 1 } });
  });

  it('删除其他键失败时版本已推进，旧快照被拒绝且可重试删除', async () => {
    vi.mocked(chrome.storage.sync.remove).mockRejectedValueOnce(new Error('测试删除失败'));
    await expect(StorageManager.clearAllData()).rejects.toThrow('测试删除失败');
    await expect(StorageManager.updateSettings({ apiConfigs: [] }, 7)).rejects.toThrow(/刷新/);
    await StorageManager.clearAllData();
    expect(syncData).toEqual({ settings: { apiConfigsRevision: 9, hybridCredentialsRevision: 2 } });
  });

  it('后台模块重建后仍能读取墓碑并拒绝清空前版本', async () => {
    await StorageManager.clearAllData();
    vi.resetModules();
    const { StorageManager: restarted } = await import('@/background/storage');
    expect((await restarted.getSettings()).apiConfigsRevision).toBe(8);
    await expect(restarted.updateSettings({ apiConfigs: [] }, 7)).rejects.toThrow(/刷新/);
  });
});
