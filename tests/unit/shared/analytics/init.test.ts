/**
 * Analytics init 模块测试
 *
 * 覆盖初始化、事件追踪、实验注册、资源清理
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockAnalyticsInitialize = vi.fn();
const mockAnalyticsGetUserId = vi.fn();
const mockAnalyticsGetSessionId = vi.fn();
const mockAnalyticsDestroy = vi.fn();
const mockAnalyticsTrack = vi.fn();

const mockInitializeUserProfile = vi.fn();
const mockTrackUserEvent = vi.fn();
const mockInitPeriodicFlush = vi.fn();
const mockCleanupFn = vi.fn();

const mockRegisterExperiment = vi.fn();
const mockGetGroupForUser = vi.fn();
const mockIsInVariant = vi.fn();

vi.mock('@/shared/analytics/Analytics', () => ({
  analytics: {
    initialize: (...args: any[]) => mockAnalyticsInitialize(...args),
    getUserId: (...args: any[]) => mockAnalyticsGetUserId(...args),
    getSessionId: (...args: any[]) => mockAnalyticsGetSessionId(...args),
    destroy: (...args: any[]) => mockAnalyticsDestroy(...args),
    track: (...args: any[]) => mockAnalyticsTrack(...args),
  },
}));

vi.mock('@/shared/analytics/userProfile', () => ({
  initializeUserProfile: (...args: any[]) => mockInitializeUserProfile(...args),
  trackUserEvent: (...args: any[]) => mockTrackUserEvent(...args),
}));

vi.mock('@/shared/analytics/eventQueue', () => ({
  initPeriodicFlush: () => mockInitPeriodicFlush(),
}));

vi.mock('@/shared/analytics/ExperimentFramework', () => ({
  experimentFramework: {
    registerExperiment: (...args: any[]) => mockRegisterExperiment(...args),
    getGroupForUser: (...args: any[]) => mockGetGroupForUser(...args),
    isInVariant: (...args: any[]) => mockIsInVariant(...args),
  },
}));

// 动态导入被测模块，确保每次测试都加载最新 mock
async function loadInit() {
  const mod = await import('@/shared/analytics/init');
  return mod;
}

describe('analytics/init', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockInitPeriodicFlush.mockReturnValue(mockCleanupFn);
    mockAnalyticsInitialize.mockResolvedValue(undefined);
    mockAnalyticsGetUserId.mockReturnValue('user-123');
    mockAnalyticsGetSessionId.mockReturnValue('sess-456');
    mockInitializeUserProfile.mockResolvedValue(undefined);
    mockTrackUserEvent.mockResolvedValue(undefined);
    mockGetGroupForUser.mockResolvedValue({ id: 'g1', name: 'Test', weight: 100, variant: 'control' });
    mockIsInVariant.mockReturnValue(true);
  });

  describe('initAnalytics', () => {
    it('成功初始化', async () => {
      const { initAnalytics } = await loadInit();
      const result = await initAnalytics({ installSource: 'store' });

      expect(result).toBe(true);
      expect(mockAnalyticsInitialize).toHaveBeenCalledTimes(1);
      expect(mockInitializeUserProfile).toHaveBeenCalledWith(
        expect.objectContaining({ installSource: 'store' })
      );
      expect(mockInitPeriodicFlush).toHaveBeenCalledTimes(1);
    });

    it('重复初始化返回 true 不重复执行', async () => {
      const { initAnalytics } = await loadInit();
      await initAnalytics();
      expect(mockAnalyticsInitialize).toHaveBeenCalledTimes(1);

      const result = await initAnalytics();
      expect(result).toBe(true);
      // 不应再次调用
      expect(mockAnalyticsInitialize).toHaveBeenCalledTimes(1);
    });

    it('初始化失败返回 false', async () => {
      mockAnalyticsInitialize.mockRejectedValue(new Error('Init failed'));
      const { initAnalytics } = await loadInit();

      const result = await initAnalytics();
      expect(result).toBe(false);
    });

    it('并发初始化等待完成', async () => {
      let resolveInit: () => void;
      const initPromise = new Promise<void>((resolve) => {
        resolveInit = resolve;
      });
      mockAnalyticsInitialize.mockImplementation(() => initPromise);

      const { initAnalytics } = await loadInit();
      const p1 = initAnalytics();
      const p2 = initAnalytics();

      resolveInit!();
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(mockAnalyticsInitialize).toHaveBeenCalledTimes(1);
    });

    it('传递所有选项到用户画像', async () => {
      const { initAnalytics } = await loadInit();
      await initAnalytics({
        installSource: 'store',
        initialLevel: 'B1',
        apiProvider: 'openai',
        referrerId: 'ref-123',
      });

      expect(mockInitializeUserProfile).toHaveBeenCalledWith({
        installSource: 'store',
        initialLevel: 'B1',
        apiProvider: 'openai',
        referrerId: 'ref-123',
      });
    });
  });

  describe('trackEvent', () => {
    it('已初始化直接追踪事件', async () => {
      const { initAnalytics, trackEvent } = await loadInit();
      await initAnalytics();

      await trackEvent('test_event', { foo: 'bar' });
      expect(mockTrackUserEvent).toHaveBeenCalledWith('test_event', { foo: 'bar' });
    });

    it('未初始化时先初始化再追踪', async () => {
      const { trackEvent } = await loadInit();

      await trackEvent('test_event');
      expect(mockAnalyticsInitialize).toHaveBeenCalledTimes(1);
      expect(mockTrackUserEvent).toHaveBeenCalledWith('test_event', {});
    });
  });

  describe('registerExperiment', () => {
    it('委托到 experimentFramework', async () => {
      const { registerExperiment } = await loadInit();
      const exp = { id: 'exp-1', name: 'Test' } as any;

      registerExperiment(exp);
      expect(mockRegisterExperiment).toHaveBeenCalledWith(exp);
    });
  });

  describe('getExperimentGroup', () => {
    it('委托到 experimentFramework', async () => {
      const { getExperimentGroup } = await loadInit();

      const result = await getExperimentGroup('exp-1');
      expect(mockGetGroupForUser).toHaveBeenCalledWith('exp-1');
      expect(result).toEqual({ id: 'g1', name: 'Test', weight: 100, variant: 'control' });
    });
  });

  describe('isInVariant', () => {
    it('委托到 experimentFramework', async () => {
      const { isInVariant } = await loadInit();

      const result = isInVariant('exp-1', 'control');
      expect(mockIsInVariant).toHaveBeenCalledWith('exp-1', 'control');
      expect(result).toBe(true);
    });
  });

  describe('getUserId / getSessionId', () => {
    it('返回用户ID', async () => {
      const { getUserId } = await loadInit();
      expect(getUserId()).toBe('user-123');
    });

    it('返回会话ID', async () => {
      const { getSessionId } = await loadInit();
      expect(getSessionId()).toBe('sess-456');
    });
  });

  describe('destroyAnalytics', () => {
    it('清理资源并允许重新初始化', async () => {
      const { initAnalytics, destroyAnalytics } = await loadInit();
      await initAnalytics();
      expect(mockInitPeriodicFlush).toHaveBeenCalledTimes(1);

      destroyAnalytics();
      expect(mockCleanupFn).toHaveBeenCalledTimes(1);
      expect(mockAnalyticsDestroy).toHaveBeenCalledTimes(1);

      // 重新初始化应成功
      mockAnalyticsInitialize.mockClear();
      const result = await initAnalytics();
      expect(result).toBe(true);
      expect(mockAnalyticsInitialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('AnalyticsEvents 重新导出', () => {
    it('导出 AnalyticsEvents', async () => {
      const { AnalyticsEvents } = await loadInit();
      expect(AnalyticsEvents).toBeDefined();
      expect(AnalyticsEvents.PAGE_VIEW).toBe('page_view');
    });
  });
});
