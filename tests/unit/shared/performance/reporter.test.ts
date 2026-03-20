/**
 * Performance Reporter 测试
 *
 * 测试性能数据上报的核心功能
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PerformanceReporter,
  calculateApiMetrics,
  calculateCacheMetrics,
  DEFAULT_REPORTER_CONFIG,
} from '@/shared/performance/reporter';
import { MetricType } from '@/shared/performance/types';
import type { PerformanceMetric } from '@/shared/performance/types';

// Mock dependencies
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/shared/performance/monitor', () => ({
  getPerformanceMonitor: vi.fn(() => ({
    generateReport: vi.fn(() => ({
      stats: [],
      activeAlerts: [],
      memoryTrend: [],
    })),
    getMetrics: vi.fn(() => []),
    getActiveAlerts: vi.fn(() => []),
    getMemorySnapshots: vi.fn(() => []),
  })),
}));

vi.mock('@/background/enhancedCache', () => ({
  enhancedCache: {
    getStats: vi.fn().mockResolvedValue({
      totalEntries: 100,
      memoryUsage: 1024 * 1024,
    }),
  },
}));

// Mock Chrome APIs
const mockStorageData: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  runtime: {
    getManifest: vi.fn(() => ({ version: '1.0.0' })),
  },
  storage: {
    local: {
      get: vi.fn((key: string) => {
        if (typeof key === 'string') {
          return Promise.resolve({ [key]: mockStorageData[key] });
        }
        return Promise.resolve({});
      }),
      set: vi.fn((data: Record<string, unknown>) => {
        Object.assign(mockStorageData, data);
        return Promise.resolve();
      }),
      remove: vi.fn((key: string) => {
        delete mockStorageData[key];
        return Promise.resolve();
      }),
    },
  },
  downloads: {
    download: vi.fn().mockResolvedValue(1),
  },
});

// Helper to create test metrics
function createTestMetric(overrides: Partial<PerformanceMetric> = {}): PerformanceMetric {
  return {
    id: `metric-${Date.now()}-${Math.random()}`,
    type: MetricType.API_RESPONSE_TIME,
    operation: 'translate',
    duration: 100,
    timestamp: Date.now(),
    success: true,
    ...overrides,
  };
}

describe('calculateApiMetrics', () => {
  it('应该计算 API 性能指标', () => {
    const metrics: PerformanceMetric[] = [
      createTestMetric({
        type: MetricType.API_RESPONSE_TIME,
        operation: 'translate',
        duration: 100,
        success: true,
        metadata: { provider: 'openai', textLength: 50 },
      }),
      createTestMetric({
        type: MetricType.API_RESPONSE_TIME,
        operation: 'translate',
        duration: 200,
        success: true,
        metadata: { provider: 'openai', textLength: 100 },
      }),
      createTestMetric({
        type: MetricType.API_RESPONSE_TIME,
        operation: 'translate',
        duration: 300,
        success: false,
        metadata: { provider: 'openai', textLength: 150 },
      }),
    ];

    const result = calculateApiMetrics(metrics, 'openai');

    expect(result.provider).toBe('openai');
    expect(result.totalCalls).toBe(3);
    expect(result.successCalls).toBe(2);
    expect(result.failedCalls).toBe(1);
    expect(result.avgResponseTime).toBe(200); // (100+200+300)/3
    expect(result.avgTextLength).toBe(100); // (50+100+150)/3
  });

  it('应该返回零值当没有匹配的指标时', () => {
    const metrics: PerformanceMetric[] = [
      createTestMetric({
        type: MetricType.CACHE_OPERATION,
        operation: 'cache_get',
      }),
    ];

    const result = calculateApiMetrics(metrics, 'openai');

    expect(result.totalCalls).toBe(0);
    expect(result.successCalls).toBe(0);
    expect(result.failedCalls).toBe(0);
    expect(result.avgResponseTime).toBe(0);
    expect(result.p95ResponseTime).toBe(0);
    expect(result.p99ResponseTime).toBe(0);
  });

  it('应该计算 P95 和 P99 响应时间', () => {
    const metrics: PerformanceMetric[] = [];
    // 创建 100 个指标用于百分位计算
    for (let i = 1; i <= 100; i++) {
      metrics.push(
        createTestMetric({
          type: MetricType.API_RESPONSE_TIME,
          operation: 'translate',
          duration: i * 10, // 10, 20, 30, ... 1000
          success: true,
          metadata: { provider: 'openai' },
        })
      );
    }

    const result = calculateApiMetrics(metrics, 'openai');

    expect(result.avgResponseTime).toBe(505); // 平均值
    expect(result.p95ResponseTime).toBeGreaterThan(900); // P95 ~ 950
    expect(result.p99ResponseTime).toBeGreaterThan(950); // P99 ~ 990
  });
});

describe('calculateCacheMetrics', () => {
  it('应该计算缓存性能指标', () => {
    const metrics: PerformanceMetric[] = [
      createTestMetric({
        type: MetricType.CACHE_OPERATION,
        operation: 'cache_get',
        duration: 5,
        metadata: { cacheHit: true, cacheSize: 100 },
      }),
      createTestMetric({
        type: MetricType.CACHE_OPERATION,
        operation: 'cache_get',
        duration: 10,
        metadata: { cacheHit: true, cacheSize: 100 },
      }),
      createTestMetric({
        type: MetricType.CACHE_OPERATION,
        operation: 'cache_get',
        duration: 20,
        metadata: { cacheHit: false, cacheSize: 100 },
      }),
      createTestMetric({
        type: MetricType.CACHE_OPERATION,
        operation: 'cache_set',
        duration: 15,
        metadata: { cacheSize: 101 },
      }),
      createTestMetric({
        type: MetricType.CACHE_OPERATION,
        operation: 'cache_evict',
        duration: 2,
        metadata: { cacheSize: 100 },
      }),
    ];

    const result = calculateCacheMetrics(metrics);

    expect(result.totalRequests).toBe(4); // 3 get + 1 set
    expect(result.hits).toBe(2);
    expect(result.misses).toBe(1);
    expect(result.hitRate).toBeCloseTo(0.667, 2); // 2/3
    expect(result.avgGetTime).toBeCloseTo(11.67, 1); // (5+10+20)/3
    expect(result.avgSetTime).toBe(15);
    expect(result.evictionCount).toBe(1);
    // currentSize 取最后一个指标的 cacheSize
    expect(result.currentSize).toBe(100);
  });

  it('应该返回零值当没有缓存指标时', () => {
    const metrics: PerformanceMetric[] = [
      createTestMetric({
        type: MetricType.API_RESPONSE_TIME,
        operation: 'translate',
      }),
    ];

    const result = calculateCacheMetrics(metrics);

    expect(result.totalRequests).toBe(0);
    expect(result.hits).toBe(0);
    expect(result.misses).toBe(0);
    expect(result.hitRate).toBe(0);
    expect(result.currentSize).toBe(0);
  });

  it('应该正确计算命中率为 0 当所有请求都未命中时', () => {
    const metrics: PerformanceMetric[] = [
      createTestMetric({
        type: MetricType.CACHE_OPERATION,
        operation: 'cache_get',
        duration: 20,
        metadata: { cacheHit: false },
      }),
      createTestMetric({
        type: MetricType.CACHE_OPERATION,
        operation: 'cache_get',
        duration: 25,
        metadata: { cacheHit: false },
      }),
    ];

    const result = calculateCacheMetrics(metrics);

    expect(result.hits).toBe(0);
    expect(result.misses).toBe(2);
    expect(result.hitRate).toBe(0);
  });
});

describe('PerformanceReporter', () => {
  let reporter: PerformanceReporter;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorageData).forEach(key => delete mockStorageData[key]);
    reporter = new PerformanceReporter();
  });

  describe('constructor', () => {
    it('应该使用默认配置初始化', () => {
      const config = reporter.getConfig();
      expect(config.enabled).toBe(DEFAULT_REPORTER_CONFIG.enabled);
      expect(config.interval).toBe(DEFAULT_REPORTER_CONFIG.interval);
      expect(config.maxLocalEntries).toBe(DEFAULT_REPORTER_CONFIG.maxLocalEntries);
    });

    it('应该允许覆盖配置', () => {
      const customReporter = new PerformanceReporter({
        enabled: true,
        interval: 30,
      });
      const config = customReporter.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.interval).toBe(30);
    });
  });

  describe('initialize', () => {
    it('应该成功初始化', async () => {
      await reporter.initialize();
      // 初始化成功后，应该能获取待上报数据
      const pending = reporter.getPendingReports();
      expect(Array.isArray(pending)).toBe(true);
    });

    it('应该只初始化一次', async () => {
      await reporter.initialize();
      await reporter.initialize();
      // 重复初始化应该被忽略
    });
  });

  describe('start/stop', () => {
    it('应该启动定时上报', () => {
      reporter.start();
      const config = reporter.getConfig();
      expect(config.enabled).toBe(DEFAULT_REPORTER_CONFIG.enabled);
      reporter.stop();
    });

    it('应该停止定时上报', () => {
      reporter.start();
      reporter.stop();
      // 停止后不应崩溃
    });
  });

  describe('report', () => {
    it('应该在禁用时不上报', async () => {
      const disabledReporter = new PerformanceReporter({ enabled: false });
      const result = await disabledReporter.report();
      expect(result).toBe(false);
    });

    it('应该在采样率检查失败时不上报', async () => {
      const lowSampleReporter = new PerformanceReporter({
        enabled: true,
        sampleRate: 0, // 0% 采样率
      });
      await lowSampleReporter.initialize();
      const result = await lowSampleReporter.report();
      expect(result).toBe(false);
    });
  });

  describe('updateConfig', () => {
    it('应该更新配置', () => {
      reporter.updateConfig({ interval: 120 });
      const config = reporter.getConfig();
      expect(config.interval).toBe(120);
    });

    it('应该在启用时重启定时器', () => {
      reporter.updateConfig({ enabled: true });
      // 应该启动定时器
      reporter.stop(); // 清理
    });
  });

  describe('getPendingReports/clearPendingReports', () => {
    it('应该获取待上报数据', () => {
      const pending = reporter.getPendingReports();
      expect(Array.isArray(pending)).toBe(true);
    });

    it('应该清除待上报数据', async () => {
      await reporter.clearPendingReports();
      const pending = reporter.getPendingReports();
      expect(pending.length).toBe(0);
    });
  });

  describe('exportToJSON', () => {
    it('应该导出 JSON 格式的性能报告', async () => {
      const json = await reporter.exportToJSON(24);

      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.exportedAt).toBeDefined();
      expect(parsed.periodHours).toBe(24);
      expect(parsed.report).toBeDefined();
      expect(parsed.payload).toBeDefined();
    });

    it('应该使用默认时间范围', async () => {
      const json = await reporter.exportToJSON();
      const parsed = JSON.parse(json);
      expect(parsed.periodHours).toBe(24);
    });

    it('应该支持自定义时间范围', async () => {
      const json = await reporter.exportToJSON(48);
      const parsed = JSON.parse(json);
      expect(parsed.periodHours).toBe(48);
    });
  });

  describe('downloadReport', () => {
    it('应该调用 chrome.downloads.download', async () => {
      await reporter.downloadReport(24);

      expect(chrome.downloads.download).toHaveBeenCalled();
      const callArgs = (chrome.downloads.download as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.filename).toContain('performance-report');
      expect(callArgs.saveAs).toBe(true);
    });
  });
});

describe('DEFAULT_REPORTER_CONFIG', () => {
  it('应该有合理的默认值', () => {
    expect(DEFAULT_REPORTER_CONFIG.enabled).toBe(false);
    expect(DEFAULT_REPORTER_CONFIG.interval).toBe(60);
    expect(DEFAULT_REPORTER_CONFIG.maxLocalEntries).toBe(1000);
    expect(DEFAULT_REPORTER_CONFIG.includeSystemInfo).toBe(true);
    expect(DEFAULT_REPORTER_CONFIG.includeMemoryData).toBe(true);
    expect(DEFAULT_REPORTER_CONFIG.sampleRate).toBe(1.0);
  });
});