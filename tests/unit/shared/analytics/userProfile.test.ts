/**
 * userProfile 测试
 *
 * 覆盖用户ID生成、画像加载/保存、初始化、更新、事件追踪
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let mockSyncStorage: Record<string, unknown> = {};
let mockLocalStorage: Record<string, unknown> = {};
let mockSessionStorage: Record<string, unknown> = {};

const mockStorageSync = {
  get: vi.fn((keys: string | string[]) => {
    const k = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of k) {
      if (mockSyncStorage[key] !== undefined) result[key] = mockSyncStorage[key];
    }
    return Promise.resolve(result);
  }),
  set: vi.fn((items: Record<string, unknown>) => {
    Object.assign(mockSyncStorage, items);
    return Promise.resolve();
  }),
};

const mockStorageLocal = {
  get: vi.fn((keys: string | string[]) => {
    const k = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of k) {
      if (mockLocalStorage[key] !== undefined) result[key] = mockLocalStorage[key];
    }
    return Promise.resolve(result);
  }),
  set: vi.fn((items: Record<string, unknown>) => {
    Object.assign(mockLocalStorage, items);
    return Promise.resolve();
  }),
};

const mockStorageSession = {
  get: vi.fn((keys: string | string[]) => {
    const k = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of k) {
      if (mockSessionStorage[key] !== undefined) result[key] = mockSessionStorage[key];
    }
    return Promise.resolve(result);
  }),
  set: vi.fn((items: Record<string, unknown>) => {
    Object.assign(mockSessionStorage, items);
    return Promise.resolve();
  }),
};

const mockEnqueueEvent = vi.fn();
const mockGetUserExperimentGroups = vi.fn();

vi.mock('@/shared/analytics/eventQueue', () => ({
  enqueueEvent: (...args: any[]) => mockEnqueueEvent(...args),
}));

vi.mock('@/shared/analytics/experimentation', () => ({
  getUserExperimentGroups: (...args: any[]) => mockGetUserExperimentGroups(...args),
}));

describe('userProfile', () => {
  let userProfile: typeof import('@/shared/analytics/userProfile');

  beforeEach(async () => {
    vi.resetAllMocks();
    mockSyncStorage = {};
    mockLocalStorage = {};
    mockSessionStorage = {};
    mockEnqueueEvent.mockResolvedValue(undefined);
    mockGetUserExperimentGroups.mockResolvedValue({});
    (global as any).chrome = {
      storage: {
        sync: mockStorageSync,
        local: mockStorageLocal,
        session: mockStorageSession,
      },
    };
    vi.resetModules();
    userProfile = await import('@/shared/analytics/userProfile');
  });

  describe('getOrCreateUserId', () => {
    it('创建新用户ID', async () => {
      const userId = await userProfile.getOrCreateUserId();
      expect(userId).toBeTruthy();
      expect(typeof userId).toBe('string');
    });

    it('已存在时返回已有ID', async () => {
      mockSyncStorage.analytics_user_id = 'existing-user';
      const userId = await userProfile.getOrCreateUserId();
      expect(userId).toBe('existing-user');
    });

    it('sync 失败时回退到 local', async () => {
      mockStorageSync.get.mockRejectedValue(new Error('Sync error'));
      mockLocalStorage.analytics_user_id = 'local-user';
      const userId = await userProfile.getOrCreateUserId();
      expect(userId).toBe('local-user');
    });

    it('全部失败时仍生成ID', async () => {
      mockStorageSync.get.mockRejectedValue(new Error('Sync error'));
      mockStorageLocal.get.mockRejectedValue(new Error('Local error'));
      mockStorageSync.set.mockRejectedValue(new Error('Sync set error'));
      mockStorageLocal.set.mockRejectedValue(new Error('Local set error'));
      const userId = await userProfile.getOrCreateUserId();
      expect(userId).toBeTruthy();
    });
  });

  describe('loadUserProfile', () => {
    it('加载存在的画像', async () => {
      const profile = { user_id: 'u1', install_source: 'store' };
      mockSyncStorage['analytics_user_profile:u1'] = profile;

      const result = await userProfile.loadUserProfile('u1');
      expect(result).toEqual(profile);
    });

    it('不存在的画像返回 null', async () => {
      const result = await userProfile.loadUserProfile('nonexistent');
      expect(result).toBeNull();
    });

    it('sync 失败时回退到 local', async () => {
      mockStorageSync.get.mockRejectedValue(new Error('Sync error'));
      const profile = { user_id: 'u2', install_source: 'local' };
      mockLocalStorage['analytics_user_profile:u2'] = profile;

      const result = await userProfile.loadUserProfile('u2');
      expect(result).toEqual(profile);
    });
  });

  describe('saveUserProfile', () => {
    it('保存到 sync storage', async () => {
      const profile = { user_id: 'u1', install_source: 'store' } as any;
      await userProfile.saveUserProfile('u1', profile);

      expect(mockStorageSync.set).toHaveBeenCalledWith({
        'analytics_user_profile:u1': profile,
      });
    });

    it('sync 失败时回退到 local', async () => {
      mockStorageSync.set.mockRejectedValue(new Error('Sync error'));
      const profile = { user_id: 'u1' } as any;
      await userProfile.saveUserProfile('u1', profile);

      expect(mockStorageLocal.set).toHaveBeenCalled();
    });
  });

  describe('initializeUserProfile', () => {
    it('新用户创建画像', async () => {
      const profile = await userProfile.initializeUserProfile({
        installSource: 'chrome_store',
        initialLevel: 'B1',
      });

      expect(profile.user_id).toBeTruthy();
      expect(profile.install_source).toBe('chrome_store');
      expect(profile.initial_level).toBe('B1');
      expect(profile.total_words_marked).toBe(0);
      expect(mockGetUserExperimentGroups).toHaveBeenCalled();
      expect(mockEnqueueEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'install_complete' })
      );
    });

    it('已存在时返回已有画像', async () => {
      const existing = { user_id: 'u1', install_source: 'organic', total_words_marked: 10 };
      mockSyncStorage['analytics_user_profile:u1'] = existing;
      mockSyncStorage.analytics_user_id = 'u1';

      const profile = await userProfile.initializeUserProfile();
      expect(profile.total_words_marked).toBe(10);
      expect(mockEnqueueEvent).not.toHaveBeenCalled();
    });

    it('默认值处理', async () => {
      const profile = await userProfile.initializeUserProfile();
      expect(profile.install_source).toBe('organic');
      expect(profile.initial_level).toBe('unknown');
      expect(profile.api_provider).toBe('unknown');
    });
  });

  describe('updateUserProfile', () => {
    it('更新指定字段', async () => {
      const existing = {
        user_id: 'u1',
        install_source: 'organic',
        total_words_marked: 0,
        total_words_known: 0,
        current_vocabulary_estimate: 0,
        experiment_groups: {},
        days_active_last_7: 0,
        days_active_last_30: 0,
        last_active_date: new Date().toISOString(),
        install_date: new Date().toISOString(),
      };
      mockSyncStorage['analytics_user_profile:u1'] = existing;
      mockSyncStorage.analytics_user_id = 'u1';

      const updated = await userProfile.updateUserProfile({ total_words_marked: 5 });
      expect(updated).not.toBeNull();
      expect(updated!.total_words_marked).toBe(5);
      expect(updated!.user_id).toBe('u1');
    });

    it('画像不存在返回 null', async () => {
      const updated = await userProfile.updateUserProfile({ total_words_marked: 5 });
      expect(updated).toBeNull();
    });
  });

  describe('updateVocabularyStats', () => {
    it('更新词汇统计', async () => {
      const existing = {
        user_id: 'u1',
        total_words_marked: 10,
        total_words_known: 5,
        install_source: 'organic',
        current_vocabulary_estimate: 0,
        experiment_groups: {},
        days_active_last_7: 0,
        days_active_last_30: 0,
        last_active_date: new Date().toISOString(),
        install_date: new Date().toISOString(),
      };
      mockSyncStorage['analytics_user_profile:u1'] = existing;
      mockSyncStorage.analytics_user_id = 'u1';

      await userProfile.updateVocabularyStats(3, 2);
      const saved = (mockStorageSync.set.mock.calls[0][0] as Record<string, unknown>)['analytics_user_profile:u1'] as any;
      expect(saved.total_words_marked).toBe(13);
      expect(saved.total_words_known).toBe(7);
    });

    it('画像不存在不报错', async () => {
      await expect(userProfile.updateVocabularyStats(1, 1)).resolves.not.toThrow();
    });
  });

  describe('updateActivityStats', () => {
    it('新日期增加活跃天数', async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      const existing = {
        user_id: 'u1',
        total_words_marked: 0,
        total_words_known: 0,
        install_source: 'organic',
        current_vocabulary_estimate: 0,
        experiment_groups: {},
        days_active_last_7: 2,
        days_active_last_30: 10,
        last_active_date: yesterday,
        install_date: yesterday,
      };
      mockSyncStorage['analytics_user_profile:u1'] = existing;
      mockSyncStorage.analytics_user_id = 'u1';

      await userProfile.updateActivityStats(true);
      const saved = (mockStorageSync.set.mock.calls[0][0] as Record<string, unknown>)['analytics_user_profile:u1'] as any;
      expect(saved.days_active_last_7).toBe(3);
      expect(saved.days_active_last_30).toBe(11);
    });

    it('同一天不重复计数', async () => {
      const today = new Date().toISOString();
      const existing = {
        user_id: 'u1',
        total_words_marked: 0,
        total_words_known: 0,
        install_source: 'organic',
        current_vocabulary_estimate: 0,
        experiment_groups: {},
        days_active_last_7: 2,
        days_active_last_30: 10,
        last_active_date: today,
        install_date: today,
      };
      mockSyncStorage['analytics_user_profile:u1'] = existing;
      mockSyncStorage.analytics_user_id = 'u1';

      await userProfile.updateActivityStats(true);
      expect(mockStorageSync.set).not.toHaveBeenCalled();
    });

    it('不活跃时不更新', async () => {
      await userProfile.updateActivityStats(false);
      expect(mockStorageSync.set).not.toHaveBeenCalled();
    });
  });

  describe('trackUserEvent', () => {
    it('追踪事件并关联用户', async () => {
      await userProfile.trackUserEvent('test_event', { foo: 'bar' });
      expect(mockEnqueueEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'test_event',
          properties: { foo: 'bar' },
          user_id: expect.any(String),
          session_id: expect.any(String),
          device_id: expect.any(String),
        })
      );
    });

    it('无属性时使用空对象', async () => {
      await userProfile.trackUserEvent('simple_event');
      expect(mockEnqueueEvent).toHaveBeenCalledWith(
        expect.objectContaining({ properties: {} })
      );
    });
  });
});
