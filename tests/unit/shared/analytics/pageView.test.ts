/**
 * pageView 测试
 *
 * 覆盖页面访问追踪、性能收集、会话管理、来源解析
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockTrack = vi.fn().mockResolvedValue(undefined);

vi.mock('@/shared/analytics/Analytics', () => ({
  analytics: {
    track: (...args: any[]) => mockTrack(...args),
  },
}));

describe('pageView', () => {
  let pageView: typeof import('@/shared/analytics/pageView');

  beforeEach(async () => {
    vi.resetAllMocks();
    mockTrack.mockResolvedValue(undefined);
    vi.resetModules();
    pageView = await import('@/shared/analytics/pageView');
  });

  describe('startPageViewTracking / stopPageViewTracking', () => {
    it('开始追踪页面访问', () => {
      const result = pageView.startPageViewTracking('content_script');
      expect(result).toBe(true);
    });

    it('重复开始返回 false', () => {
      pageView.startPageViewTracking();
      const result = pageView.startPageViewTracking();
      expect(result).toBe(false);
    });

    it('停止追踪返回数据', () => {
      pageView.startPageViewTracking('popup');
      const result = pageView.stopPageViewTracking();

      expect(result).not.toBeNull();
      expect(result!.pageType).toBe('popup');
      expect(result!.duration).toBeGreaterThanOrEqual(0);
    });

    it('未追踪时停止返回 null', () => {
      const result = pageView.stopPageViewTracking();
      expect(result).toBeNull();
    });

    it('追踪页面访问事件', () => {
      pageView.startPageViewTracking('options');
      expect(mockTrack).toHaveBeenCalledWith(
        'page_view',
        expect.objectContaining({ pageType: 'options' })
      );
    });

    it('追踪页面离开事件', () => {
      pageView.startPageViewTracking();
      pageView.stopPageViewTracking();
      expect(mockTrack).toHaveBeenCalledWith(
        'page_leave',
        expect.objectContaining({ duration: expect.any(Number) })
      );
    });
  });

  describe('getCurrentPageView', () => {
    it('返回当前页面访问数据', () => {
      pageView.startPageViewTracking('test');
      const result = pageView.getCurrentPageView();

      expect(result).not.toBeNull();
      expect(result!.url).toBeTruthy();
      expect(result!.duration).toBeGreaterThanOrEqual(0);
    });

    it('未追踪时返回 null', () => {
      expect(pageView.getCurrentPageView()).toBeNull();
    });
  });

  describe('collectPagePerformanceData', () => {
    it('收集页面性能数据', () => {
      const mockEntry = {
        domainLookupEnd: 10,
        domainLookupStart: 5,
        connectEnd: 20,
        connectStart: 10,
        responseEnd: 50,
        responseStart: 30,
        domContentLoadedEventEnd: 80,
        loadEventEnd: 100,
        startTime: 0,
      };

      vi.stubGlobal('performance', {
        getEntriesByType: vi.fn((type: string) => {
          if (type === 'navigation') return [mockEntry];
          if (type === 'paint') return [{ name: 'first-contentful-paint', startTime: 25 }];
          return [];
        }),
      });

      const result = pageView.collectPagePerformanceData();

      expect(result).not.toBeNull();
      expect(result!.dnsTime).toBe(5);
      expect(result!.connectTime).toBe(10);
      expect(result!.responseTime).toBe(20);
      expect(result!.domParseTime).toBe(30);
      expect(result!.loadTime).toBe(100);
      expect(result!.fcpTime).toBe(25);

      vi.unstubAllGlobals();
    });

    it('无 performance 数据返回 null', () => {
      vi.stubGlobal('performance', undefined);
      expect(pageView.collectPagePerformanceData()).toBeNull();
      vi.unstubAllGlobals();
    });

    it('无 navigation entry 返回 null', () => {
      vi.stubGlobal('performance', {
        getEntriesByType: vi.fn(() => []),
      });
      expect(pageView.collectPagePerformanceData()).toBeNull();
      vi.unstubAllGlobals();
    });
  });

  describe('trackPagePerformance', () => {
    it('追踪性能数据', async () => {
      const mockEntry = {
        domainLookupEnd: 10,
        domainLookupStart: 5,
        connectEnd: 20,
        connectStart: 10,
        responseEnd: 50,
        responseStart: 30,
        domContentLoadedEventEnd: 80,
        loadEventEnd: 100,
        startTime: 0,
      };

      vi.stubGlobal('performance', {
        getEntriesByType: vi.fn((type: string) => {
          if (type === 'navigation') return [mockEntry];
          return [];
        }),
      });

      await pageView.trackPagePerformance();
      expect(mockTrack).toHaveBeenCalledWith(
        'page_performance',
        expect.objectContaining({
          dnsTime: 5,
          loadTime: 100,
        })
      );

      vi.unstubAllGlobals();
    });

    it('无数据时不追踪', async () => {
      vi.stubGlobal('performance', undefined);
      await pageView.trackPagePerformance();
      expect(mockTrack).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe('startSession / endSession / getCurrentSessionId', () => {
    it('开始会话返回会话ID', () => {
      const sessionId = pageView.startSession('organic', 'https://google.com');
      expect(sessionId).toMatch(/^sess_/);
      expect(pageView.getCurrentSessionId()).toBe(sessionId);
    });

    it('追踪会话开始事件', () => {
      pageView.startSession('referral', 'https://example.com');
      expect(mockTrack).toHaveBeenCalledWith(
        'session_start',
        expect.objectContaining({
          sessionId: expect.any(String),
          sourceType: 'referral',
          referrer: 'https://example.com',
        })
      );
    });

    it('结束会话追踪事件', async () => {
      pageView.startSession();
      mockTrack.mockClear();

      await pageView.endSession();
      expect(mockTrack).toHaveBeenCalledWith(
        'session_end',
        expect.objectContaining({
          sessionId: expect.any(String),
          duration: expect.any(Number),
        })
      );
    });

    it('未开始会话时结束不报错', async () => {
      await expect(pageView.endSession()).resolves.not.toThrow();
      expect(mockTrack).not.toHaveBeenCalled();
    });

    it('会话结束后 ID 为 null', async () => {
      pageView.startSession();
      await pageView.endSession();
      expect(pageView.getCurrentSessionId()).toBeNull();
    });
  });

  describe('getCurrentUrlInfo', () => {
    it('返回 URL 信息', () => {
      const result = pageView.getCurrentUrlInfo();
      expect(result.url).toBeTruthy();
      expect(result.path).toBeDefined();
      expect(result.hostname).toBeDefined();
    });
  });

  describe('parseReferrer', () => {
    it('空 referrer 返回 direct', () => {
      expect(pageView.parseReferrer('')).toEqual({ source: 'direct', medium: 'none' });
    });

    it('解析 Google 来源', () => {
      expect(pageView.parseReferrer('https://www.google.com/search?q=test')).toEqual({
        source: 'google',
        medium: 'organic',
      });
    });

    it('解析 Bing 来源', () => {
      expect(pageView.parseReferrer('https://www.bing.com/search?q=test')).toEqual({
        source: 'bing',
        medium: 'organic',
      });
    });

    it('解析 Baidu 来源', () => {
      expect(pageView.parseReferrer('https://www.baidu.com/s?wd=test')).toEqual({
        source: 'baidu',
        medium: 'organic',
      });
    });

    it('解析 Twitter 来源', () => {
      expect(pageView.parseReferrer('https://twitter.com/home')).toEqual({
        source: 'twitter',
        medium: 'social',
      });
    });

    it('解析 x.com 来源', () => {
      expect(pageView.parseReferrer('https://x.com/home')).toEqual({
        source: 'twitter',
        medium: 'social',
      });
    });

    it('解析 Facebook 来源', () => {
      expect(pageView.parseReferrer('https://www.facebook.com/groups/test')).toEqual({
        source: 'facebook',
        medium: 'social',
      });
    });

    it('解析 LinkedIn 来源', () => {
      expect(pageView.parseReferrer('https://www.linkedin.com/feed/')).toEqual({
        source: 'linkedin',
        medium: 'social',
      });
    });

    it('未知来源返回 hostname', () => {
      expect(pageView.parseReferrer('https://example.com/page')).toEqual({
        source: 'example.com',
        medium: 'referral',
      });
    });

    it('无效 URL 返回 unknown', () => {
      expect(pageView.parseReferrer('not-a-url')).toEqual({
        source: 'unknown',
        medium: 'referral',
      });
    });
  });
});
