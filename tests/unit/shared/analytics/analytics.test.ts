/**
 * Analytics 核心类测试
 *
 * 覆盖初始化、事件追踪、用户识别、实验分配、数据持久化
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Analytics } from '@/shared/analytics/Analytics';
import { AnalyticsEvents } from '@/shared/analytics/types';

function createMockStorage() {
  const storage: Record<string, unknown> = {};
  return {
    storage,
    local: {
      get: vi.fn((keys: string | string[]) => {
        const k = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of k) {
          if (storage[key] !== undefined) result[key] = storage[key];
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(storage, items);
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[]) => {
        const k = Array.isArray(keys) ? keys : [keys];
        for (const key of k) delete storage[key];
        return Promise.resolve();
      }),
    },
    session: {
      set: vi.fn(() => Promise.resolve()),
    },
  };
}

describe('Analytics', () => {
  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Analytics.resetInstance();
    mockStorage = createMockStorage();
    (global as any).chrome = {
      storage: { local: mockStorage.local, session: mockStorage.session },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getInstance', () => {
    it('返回单例实例', () => {
      const a1 = Analytics.getInstance();
      const a2 = Analytics.getInstance();
      expect(a1).toBe(a2);
    });
  });

  describe('initialize', () => {
    it('从 storage 恢复用户ID', async () => {
      mockStorage.storage.analytics_userId = 'user-123';
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      expect(analytics.getUserId()).toBe('user-123');
    });

    it('无用户ID时生成新的', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      expect(analytics.getUserId()).toMatch(/^usr_/);
      expect(mockStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ analytics_userId: expect.stringMatching(/^usr_/) })
      );
    });

    it('重复初始化不执行', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();
      const userId = analytics.getUserId();

      await analytics.initialize();
      expect(analytics.getUserId()).toBe(userId);
    });

    it('恢复用户属性', async () => {
      mockStorage.storage.analytics_traits = { userId: 'u1', installDate: 123 };
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      expect(analytics.getUserTraits()).toEqual({ userId: 'u1', installDate: 123 });
    });

    it('恢复实验分配', async () => {
      mockStorage.storage.analytics_experiments = [
        { experimentId: 'exp-1', groupId: 'control', variant: 'control', assignedAt: 1000 },
      ];
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      const group = analytics.getExperimentGroup('exp-1');
      expect(group).toEqual(
        expect.objectContaining({ experimentId: 'exp-1', groupId: 'control', variant: 'control' })
      );
    });

    it('初始化失败时使用内存模式', async () => {
      mockStorage.local.get.mockRejectedValue(new Error('Storage error'));
      const analytics = Analytics.getInstance();

      await expect(analytics.initialize()).resolves.not.toThrow();
      expect(analytics.getUserId()).toBeNull();
    });

    it('发送初始化事件并 flush 到 storage', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();
      await analytics.flush();

      const events = await analytics.getAllEvents();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].event).toBe(AnalyticsEvents.EXPERIMENT_ASSIGNED);
    });
  });

  describe('track', () => {
    it('追踪事件到队列并在 flush 后可见', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      await analytics.track('test_event', { foo: 'bar' });
      await analytics.flush();
      const events = await analytics.getAllEvents();

      expect(events.some((e) => e.event === 'test_event')).toBe(true);
    });

    it('事件包含用户和会话ID', async () => {
      mockStorage.storage.analytics_userId = 'user-abc';
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      await analytics.track('test_event');
      await analytics.flush();
      const events = await analytics.getAllEvents();

      expect(events[0].userId).toBe('user-abc');
      expect(events[0].sessionId).toBeTruthy();
    });

    it('队列满时自动刷新', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      for (let i = 0; i < 101; i++) {
        await analytics.track(`event_${i}`);
      }

      // 第 101 条触发 flush
      const events = await analytics.getAllEvents();
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('identify', () => {
    it('设置用户ID', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      await analytics.identify('new-user', { installDate: 123 });

      expect(analytics.getUserId()).toBe('new-user');
      expect(analytics.getUserTraits()).toMatchObject({ installDate: 123, userId: 'new-user' });
    });

    it('持久化到 storage', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      await analytics.identify('user-x', { apiProvider: 'openai' });

      expect(mockStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          analytics_userId: 'user-x',
          analytics_traits: expect.objectContaining({ apiProvider: 'openai' }),
        })
      );
    });

    it('相同用户ID不发送识别事件', async () => {
      mockStorage.storage.analytics_userId = 'same-user';
      const analytics = Analytics.getInstance();
      await analytics.initialize();
      await analytics.flush();
      const before = (await analytics.getAllEvents()).length;

      await analytics.identify('same-user');
      await analytics.flush();
      const after = (await analytics.getAllEvents()).length;

      expect(after).toBe(before);
    });
  });

  describe('assignExperiment', () => {
    const mockExperiment = {
      id: 'exp-1',
      name: 'Test',
      startDate: new Date(Date.now() - 86400000).toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString(),
      trafficAllocation: 100,
      groups: [
        { id: 'control', name: 'Control', weight: 50, variant: 'control' },
        { id: 'treatment', name: 'Treatment', weight: 50, variant: 'treatment' },
      ],
      primaryMetric: 'conversion',
      secondaryMetrics: [],
      minimumSampleSize: 10,
    };

    it('分配实验分组', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      const group = await analytics.assignExperiment('exp-1', mockExperiment);

      expect(group).not.toBeNull();
      expect(['control', 'treatment']).toContain(group!.variant);
    });

    it('已分配时返回相同分组', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      const group1 = await analytics.assignExperiment('exp-1', mockExperiment);
      const group2 = await analytics.assignExperiment('exp-1', mockExperiment);

      expect(group1).toEqual(group2);
    });

    it('实验不在有效期内返回 null', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      const expiredExp = {
        ...mockExperiment,
        startDate: new Date(Date.now() - 86400000 * 7).toISOString(),
        endDate: new Date(Date.now() - 86400000).toISOString(),
      };

      const group = await analytics.assignExperiment('exp-1', expiredExp);
      expect(group).toBeNull();
    });

    it('持久化实验分配', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      await analytics.assignExperiment('exp-1', mockExperiment);

      expect(mockStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          analytics_experiments: expect.arrayContaining([
            expect.objectContaining({ experimentId: 'exp-1' }),
          ]),
        })
      );
    });

    it('发送实验分配事件并 flush 后可见', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      await analytics.assignExperiment('exp-1', mockExperiment);
      await analytics.flush();
      const events = await analytics.getAllEvents();

      expect(events.some((e) => e.event === AnalyticsEvents.EXPERIMENT_ASSIGNED)).toBe(true);
    });
  });

  describe('getExperimentGroup', () => {
    it('返回已分配的分组', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      await analytics.assignExperiment('exp-1', {
        id: 'exp-1',
        name: 'Test',
        startDate: new Date(Date.now() - 86400000).toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        trafficAllocation: 100,
        groups: [{ id: 'g1', name: 'G1', weight: 100, variant: 'v1' }],
        primaryMetric: 'c',
        secondaryMetrics: [],
        minimumSampleSize: 1,
      });

      const assignment = analytics.getExperimentGroup('exp-1');
      expect(assignment).toEqual(
        expect.objectContaining({ experimentId: 'exp-1', groupId: 'g1', variant: 'v1' })
      );
    });

    it('未分配返回 null', () => {
      const analytics = Analytics.getInstance();
      expect(analytics.getExperimentGroup('nonexistent')).toBeNull();
    });
  });

  describe('getAllExperimentAssignments', () => {
    it('返回所有实验分配', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      await analytics.assignExperiment('exp-1', {
        id: 'exp-1',
        name: 'Test',
        startDate: new Date(Date.now() - 86400000).toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        trafficAllocation: 100,
        groups: [{ id: 'g1', name: 'G1', weight: 100, variant: 'v1' }],
        primaryMetric: 'c',
        secondaryMetrics: [],
        minimumSampleSize: 1,
      });

      expect(analytics.getAllExperimentAssignments()).toHaveLength(1);
    });
  });

  describe('flush', () => {
    it('空队列不报错', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      await analytics.flush();
      expect(mockStorage.local.get).toHaveBeenCalledWith('analytics_events');
    });

    it('将事件保存到 storage', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      await analytics.track('event_1');
      await analytics.flush();

      expect(mockStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          analytics_events: expect.arrayContaining([expect.objectContaining({ event: 'event_1' })]),
        })
      );
    });

    it('限制最多保留 1000 条事件', async () => {
      mockStorage.storage.analytics_events = Array.from({ length: 900 }, (_, i) => ({
        event: `old_${i}`,
        timestamp: i,
        properties: {},
      }));
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      for (let i = 0; i < 200; i++) {
        await analytics.track(`new_${i}`);
      }
      await analytics.flush();

      const saved = mockStorage.local.set.mock.calls.find(
        (call) => (call[0] as Record<string, unknown>).analytics_events
      );
      const events = (saved![0] as Record<string, unknown>).analytics_events as unknown[];
      expect(events.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('getUserId / getSessionId / getUserTraits', () => {
    it('初始值为 null', () => {
      const analytics = Analytics.getInstance();
      expect(analytics.getUserId()).toBeNull();
      // sessionId 在构造函数中生成，始终非空
      expect(analytics.getSessionId()).toMatch(/^sess_/);
    });

    it('获取用户属性', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();
      await analytics.identify('u1', { installDate: 123 });

      expect(analytics.getUserTraits()).toMatchObject({ installDate: 123 });
    });
  });

  describe('getAllEvents', () => {
    it('返回 storage 中的事件', async () => {
      mockStorage.storage.analytics_events = [{ event: 'test', timestamp: 1, properties: {} }];
      const analytics = Analytics.getInstance();

      const events = await analytics.getAllEvents();
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('test');
    });

    it('获取失败返回空数组', async () => {
      mockStorage.local.get.mockRejectedValue(new Error('Storage error'));
      const analytics = Analytics.getInstance();

      const events = await analytics.getAllEvents();
      expect(events).toEqual([]);
    });
  });

  describe('destroy', () => {
    it('清理定时器并置空单例', async () => {
      const analytics = Analytics.getInstance();
      await analytics.initialize();

      analytics.destroy();

      const newInstance = Analytics.getInstance();
      expect(newInstance).not.toBe(analytics);
    });
  });
});
