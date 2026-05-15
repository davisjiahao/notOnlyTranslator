/**
 * CacheMetrics 测试
 *
 * 覆盖 recordHit, recordMiss, recordApiCall, recordTotalDuration,
 * getReport, getMetrics, reset — 纯函数部分。
 * Mock chrome.storage.local 用于测试。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CacheMetricsManager, CacheMetrics } from '@/background/cacheMetrics';

/**
 * Create a mock for chrome.storage.local
 */
function createMockChromeStorage() {
  const store: Record<string, unknown> = {};

  return {
    chrome: {
      storage: {
        local: {
          get: (keys: string | string[] | null) => {
            if (typeof keys === 'string') {
              return Promise.resolve({ [keys]: store[keys] });
            }
            if (Array.isArray(keys)) {
              const result: Record<string, unknown> = {};
              for (const key of keys) {
                result[key] = store[key];
              }
              return Promise.resolve(result);
            }
            return Promise.resolve({ ...store });
          },
          set: (data: Record<string, unknown>) => {
            Object.assign(store, data);
            return Promise.resolve();
          },
        },
      },
    },
    store,
    clear() {
      Object.keys(store).forEach(k => delete store[k]);
    },
  };
}

describe('CacheMetricsManager — basic recording', () => {
  let savedChrome: unknown;

  beforeEach(() => {
    const mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('starts with zero metrics', () => {
    const manager = new CacheMetricsManager();
    const metrics = manager.getMetrics();
    expect(metrics.hits).toBe(0);
    expect(metrics.misses).toBe(0);
    expect(metrics.apiCalls).toBe(0);
    expect(metrics.totalRequests).toBe(0);
  });

  it('records cache hits', () => {
    const manager = new CacheMetricsManager();
    manager.recordHit(100);
    manager.recordHit(200);

    expect(manager.getMetrics().hits).toBe(2);
    expect(manager.getMetrics().totalRequests).toBe(2);
  });

  it('records cache misses', () => {
    const manager = new CacheMetricsManager();
    manager.recordMiss();
    manager.recordMiss();

    expect(manager.getMetrics().misses).toBe(2);
    expect(manager.getMetrics().totalRequests).toBe(2);
  });

  it('records API calls', () => {
    const manager = new CacheMetricsManager();
    manager.recordApiCall(500);
    manager.recordApiCall(300);

    expect(manager.getMetrics().apiCalls).toBe(2);
    expect(manager.getMetrics().apiTotalDuration).toBe(800);
  });

  it('records total duration', () => {
    const manager = new CacheMetricsManager();
    manager.recordTotalDuration(150);

    expect(manager.getMetrics().totalDuration).toBe(150);
  });
});

describe('CacheMetricsManager — report', () => {
  let savedChrome: unknown;

  beforeEach(() => {
    const mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('returns zero report when no data', () => {
    const manager = new CacheMetricsManager();
    const report = manager.getReport();

    expect(report.hitRate).toBe(0);
    expect(report.avgApiDuration).toBe(0);
    expect(report.avgTotalDuration).toBe(0);
    expect(report.totalRequests).toBe(0);
    expect(report.hits).toBe(0);
    expect(report.misses).toBe(0);
  });

  it('calculates hit rate correctly', () => {
    const manager = new CacheMetricsManager();
    manager.recordHit(50);
    manager.recordHit(60);
    manager.recordHit(70);
    manager.recordMiss();

    const report = manager.getReport();

    expect(report.hits).toBe(3);
    expect(report.misses).toBe(1);
    expect(report.totalRequests).toBe(4);
    expect(report.hitRate).toBeCloseTo(75, 1);
  });

  it('calculates average API duration', () => {
    const manager = new CacheMetricsManager();
    manager.recordApiCall(400);
    manager.recordApiCall(600);

    const report = manager.getReport();

    expect(report.avgApiDuration).toBeCloseTo(500, 1);
  });

  it('calculates average total duration', () => {
    const manager = new CacheMetricsManager();
    // recordHit adds to totalDuration (first param), recordTotalDuration adds more
    manager.recordHit(100); // totalDuration += 100, totalRequests = 1
    manager.recordTotalDuration(200); // totalDuration += 200
    manager.recordHit(50); // totalDuration += 50, totalRequests = 2
    manager.recordTotalDuration(100); // totalDuration += 100

    // totalDuration = 100 + 200 + 50 + 100 = 450, totalRequests = 2
    const report = manager.getReport();

    expect(report.avgTotalDuration).toBeCloseTo(225, 0);
  });
});

describe('CacheMetricsManager — reset', () => {
  let savedChrome: unknown;

  beforeEach(() => {
    const mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('resets all metrics to zero', async () => {
    const manager = new CacheMetricsManager();
    manager.recordHit(100);
    manager.recordMiss();
    manager.recordApiCall(500);

    await manager.reset();

    const metrics = manager.getMetrics();
    expect(metrics.hits).toBe(0);
    expect(metrics.misses).toBe(0);
    expect(metrics.apiCalls).toBe(0);
    expect(metrics.totalDuration).toBe(0);
    expect(metrics.totalRequests).toBe(0);
  });
});

describe('CacheMetrics — convenience exports', () => {
  let savedChrome: unknown;

  beforeEach(() => {
    const mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('exposes CacheMetrics convenience methods', () => {
    expect(typeof CacheMetrics.recordCacheHit).toBe('function');
    expect(typeof CacheMetrics.recordCacheMiss).toBe('function');
    expect(typeof CacheMetrics.recordApiCall).toBe('function');
    expect(typeof CacheMetrics.getReport).toBe('function');
    expect(typeof CacheMetrics.getMetrics).toBe('function');
    expect(typeof CacheMetrics.reset).toBe('function');
    expect(typeof CacheMetrics.initialize).toBe('function');
  });
});
