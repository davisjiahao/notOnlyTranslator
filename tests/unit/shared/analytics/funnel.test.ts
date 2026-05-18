/**
 * 转化漏斗分析测试
 *
 * 测试漏斗配置、事件追踪和分析功能
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  trackConversion,
  analyzeFunnel,
  trackAcquisition,
  trackActivation,
  trackRetention,
  trackReferral,
  PredefinedFunnels,
  type FunnelStage,
  type ConversionEvent,
  type FunnelConversionData,
} from '@/shared/analytics/funnel';
import type { FunnelConfig } from '@/shared/analytics/types';

// Mock dependencies
const mockTrack = vi.fn().mockResolvedValue(undefined);
vi.mock('@/shared/analytics/Analytics', () => ({
  analytics: {
    track: (...args: unknown[]) => mockTrack(...args),
  },
}));

// Mock chrome.storage.local
const mockStorageData: Record<string, unknown> = {};
const mockChrome = {
  storage: {
    local: {
      get: vi.fn((key: string | string[]) => {
        const result: Record<string, unknown> = {};
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) {
          if (k in mockStorageData) {
            result[k] = mockStorageData[k];
          }
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((data: Record<string, unknown>) => {
        Object.assign(mockStorageData, data);
        return Promise.resolve();
      }),
    },
  },
};

Object.defineProperty(global, 'chrome', {
  value: mockChrome,
  writable: true,
  configurable: true,
});

describe('PredefinedFunnels', () => {
  it('should define user acquisition funnel', () => {
    expect(PredefinedFunnels.userAcquisition).toBeDefined();
    expect(PredefinedFunnels.userAcquisition.steps).toHaveLength(3);
  });

  it('should define user activation funnel', () => {
    expect(PredefinedFunnels.userActivation).toBeDefined();
    expect(PredefinedFunnels.userActivation.steps).toHaveLength(4);
  });

  it('should define user retention funnel', () => {
    expect(PredefinedFunnels.userRetention).toBeDefined();
    expect(PredefinedFunnels.userRetention.steps).toHaveLength(4);
  });

  it('should define user referral funnel', () => {
    expect(PredefinedFunnels.userReferral).toBeDefined();
    expect(PredefinedFunnels.userReferral.steps).toHaveLength(4);
  });

  it('all funnels should have at least 2 steps', () => {
    for (const [name, funnel] of Object.entries(PredefinedFunnels)) {
      expect(funnel.steps.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('trackConversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorageData).forEach(k => delete mockStorageData[k]);
  });

  it('should track event and store conversion', async () => {
    await trackConversion('acquisition', 'test_event', { foo: 'bar' });

    expect(mockTrack).toHaveBeenCalledWith('test_event', expect.objectContaining({
      stage: 'acquisition',
      foo: 'bar',
    }));
  });

  it('should store conversion event in storage', async () => {
    await trackConversion('activation', 'test_event');

    const stored = mockStorageData['analytics_conversions'] as ConversionEvent[];
    expect(stored).toBeDefined();
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(1);
    expect(stored[0].event).toBe('test_event');
    expect(stored[0].stage).toBe('activation');
  });

  it('should include timestamp in stored event', async () => {
    const before = Date.now();
    await trackConversion('retention', 'timed_event');
    const after = Date.now();

    const stored = mockStorageData['analytics_conversions'] as ConversionEvent[];
    expect(stored[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(stored[0].timestamp).toBeLessThanOrEqual(after);
  });

  it('should limit stored events to 1000', async () => {
    // Pre-fill with 999 events
    const existing = Array.from({ length: 999 }, (_, i) => ({
      event: `event_${i}`,
      stage: 'acquisition' as FunnelStage,
      properties: {},
      timestamp: Date.now(),
    }));
    mockStorageData['analytics_conversions'] = existing;

    await trackConversion('acquisition', 'event_1000');

    const stored = mockStorageData['analytics_conversions'] as ConversionEvent[];
    expect(stored).toHaveLength(1000);
  });

  it('should handle storage errors gracefully', async () => {
    mockChrome.storage.local.set.mockRejectedValueOnce(new Error('storage error'));

    // Should not throw
    await expect(trackConversion('acquisition', 'test')).resolves.not.toThrow();
  });
});

describe('analyzeFunnel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorageData).forEach(k => delete mockStorageData[k]);
  });

  it('should return empty steps when no data', async () => {
    const config: FunnelConfig = {
      id: 'test',
      name: 'Test Funnel',
      steps: [
        { name: 'Step 1', event: 'step_1' },
        { name: 'Step 2', event: 'step_2' },
      ],
    };

    const result = await analyzeFunnel(config);

    expect(result.funnelName).toBe('Test Funnel');
    expect(result.steps).toHaveLength(2);
    expect(result.totalConversionRate).toBe(0);
    expect(result.totalUsers).toBe(0);
    expect(result.totalCompletedUsers).toBe(0);
  });

  it('should calculate conversion rates for each step', async () => {
    const config: FunnelConfig = {
      id: 'test',
      name: 'Test Funnel',
      steps: [
        { name: 'View', event: 'view' },
        { name: 'Click', event: 'click' },
        { name: 'Install', event: 'install' },
      ],
    };

    // Simulate conversion data: 10 views, 5 clicks, 2 installs
    const conversions: ConversionEvent[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        event: 'view',
        stage: 'acquisition' as FunnelStage,
        userId: `user-${i}`,
        properties: {},
        timestamp: Date.now() - 1000,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        event: 'click',
        stage: 'acquisition' as FunnelStage,
        userId: `user-${i}`,
        properties: {},
        timestamp: Date.now() - 500,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        event: 'install',
        stage: 'acquisition' as FunnelStage,
        userId: `user-${i}`,
        properties: {},
        timestamp: Date.now(),
      })),
    ];
    mockStorageData['analytics_conversions'] = conversions;

    const result = await analyzeFunnel(config);

    expect(result.steps[0].name).toBe('View');
    expect(result.steps[0].completedUsers).toBe(10);
    expect(result.steps[1].completedUsers).toBe(5);
    expect(result.steps[2].completedUsers).toBe(2);
  });

  it('should return default result on error', async () => {
    mockChrome.storage.local.get.mockRejectedValueOnce(new Error('read error'));

    const config: FunnelConfig = {
      id: 'test',
      name: 'Error Funnel',
      steps: [{ name: 'Step', event: 'step' }],
    };

    const result = await analyzeFunnel(config);

    expect(result.funnelName).toBe('Error Funnel');
    expect(result.steps).toEqual([]);
    expect(result.totalConversionRate).toBe(0);
  });

  it('should respect time range filter', async () => {
    const config: FunnelConfig = {
      id: 'test',
      name: 'Test',
      steps: [{ name: 'Step', event: 'step_event' }],
    };

    const conversions: ConversionEvent[] = [
      { event: 'step_event', stage: 'acquisition', userId: 'old', properties: {}, timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 },
      { event: 'step_event', stage: 'acquisition', userId: 'new', properties: {}, timestamp: Date.now() - 1000 },
    ];
    mockStorageData['analytics_conversions'] = conversions;

    // 7 day range
    const result = await analyzeFunnel(config, 7 * 24 * 60 * 60 * 1000);
    expect(result.steps[0].completedUsers).toBe(1); // only 'new' user
  });
});

describe('trackAcquisition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorageData).forEach(k => delete mockStorageData[k]);
  });

  it('should track acquisition event', async () => {
    await new Promise<void>(resolve => {
      trackAcquisition('store_view', { page: 'home' });
      // trackAcquisition is async internally (uses trackConversion which is async)
      setTimeout(resolve, 50);
    });

    expect(mockTrack).toHaveBeenCalled();
  });
});

describe('trackActivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorageData).forEach(k => delete mockStorageData[k]);
  });

  it('should track activation event', async () => {
    await new Promise<void>(resolve => {
      trackActivation('onboarding_start');
      setTimeout(resolve, 50);
    });

    expect(mockTrack).toHaveBeenCalled();
  });
});

describe('trackRetention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorageData).forEach(k => delete mockStorageData[k]);
  });

  it('should track retention event', async () => {
    await new Promise<void>(resolve => {
      trackRetention('translation_request');
      setTimeout(resolve, 50);
    });

    expect(mockTrack).toHaveBeenCalled();
  });
});

describe('trackReferral', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorageData).forEach(k => delete mockStorageData[k]);
  });

  it('should track referral event', async () => {
    await new Promise<void>(resolve => {
      trackReferral('achievement_unlocked', { achievement: 'first_translation' });
      setTimeout(resolve, 50);
    });

    expect(mockTrack).toHaveBeenCalled();
  });
});
