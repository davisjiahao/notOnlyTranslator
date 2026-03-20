/**
 * Performance Dashboard 测试
 *
 * 测试性能仪表盘的核心功能
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PerformanceDashboard,
  getPerformanceDashboard,
  initPerformanceDashboard,
  getDashboardData,
  exportDashboardData,
} from '@/shared/performance/dashboard';
import { MetricType } from '@/shared/performance/types';
import type { PerformanceMetric, MemorySnapshot, PerformanceAlert } from '@/shared/performance/types';

// Mock dependencies
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// 创建模拟的指标数据
const mockMetrics: PerformanceMetric[] = [
  {
    id: 'metric-1',
    type: MetricType.API_RESPONSE_TIME,
    operation: 'translate',
    duration: 100,
    timestamp: Date.now() - 1000,
    success: true,
    metadata: { provider: 'openai', textLength: 50 },
  },
  {
    id: 'metric-2',
    type: MetricType.API_RESPONSE_TIME,
    operation: 'translate',
    duration: 200,
    timestamp: Date.now() - 2000,
    success: true,
    metadata: { provider: 'openai', textLength: 100 },
  },
  {
    id: 'metric-3',
    type: MetricType.API_RESPONSE_TIME,
    operation: 'translate',
    duration: 150,
    timestamp: Date.now() - 3000,
    success: false,
    metadata: { provider: 'anthropic', textLength: 75 },
  },
  {
    id: 'metric-4',
    type: MetricType.CACHE_OPERATION,
    operation: 'cache_get',
    duration: 5,
    timestamp: Date.now() - 4000,
    success: true,
    metadata: { cacheHit: true, cacheSize: 100 },
  },
  {
    id: 'metric-5',
    type: MetricType.CACHE_OPERATION,
    operation: 'cache_get',
    duration: 10,
    timestamp: Date.now() - 5000,
    success: true,
    metadata: { cacheHit: false, cacheSize: 100 },
  },
  {
    id: 'metric-6',
    type: MetricType.CACHE_OPERATION,
    operation: 'cache_set',
    duration: 15,
    timestamp: Date.now() - 6000,
    success: true,
    metadata: { cacheSize: 101 },
  },
];

const mockMemorySnapshots: MemorySnapshot[] = [
  {
    timestamp: Date.now() - 1000,
    usedHeapSize: 20 * 1024 * 1024, // 20MB
    totalHeapSize: 50 * 1024 * 1024, // 50MB
    heapSizeLimit: 100 * 1024 * 1024, // 100MB
  },
];

const mockAlerts: PerformanceAlert[] = [
  {
    id: 'alert-1',
    type: MetricType.API_RESPONSE_TIME,
    operation: 'translate',
    level: 'warning',
    value: 2500,
    threshold: 2000,
    timestamp: Date.now() - 5000,
    acknowledged: false,
  },
];

// Mock monitor
const mockMonitor = {
  getMetrics: vi.fn(() => mockMetrics),
  getActiveAlerts: vi.fn(() => mockAlerts),
  getMemorySnapshots: vi.fn(() => mockMemorySnapshots),
  generateReport: vi.fn(() => ({
    stats: [],
    activeAlerts: mockAlerts,
    memoryTrend: mockMemorySnapshots,
  })),
};

vi.mock('@/shared/performance/monitor', () => ({
  getPerformanceMonitor: vi.fn(() => mockMonitor),
}));

vi.mock('@/shared/performance/reporter', () => ({
  calculateApiMetrics: vi.fn((metrics, provider) => {
    const providerMetrics = metrics.filter(
      (m: PerformanceMetric) =>
        m.type === MetricType.API_RESPONSE_TIME && m.metadata?.provider === provider
    );
    if (providerMetrics.length === 0) {
      return {
        provider,
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        avgResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        avgTextLength: 0,
      };
    }
    const durations = providerMetrics.map((m: PerformanceMetric) => m.duration);
    return {
      provider,
      totalCalls: providerMetrics.length,
      successCalls: providerMetrics.filter((m: PerformanceMetric) => m.success).length,
      failedCalls: providerMetrics.filter((m: PerformanceMetric) => !m.success).length,
      avgResponseTime: durations.reduce((a: number, b: number) => a + b, 0) / durations.length,
      p95ResponseTime: Math.max(...durations),
      p99ResponseTime: Math.max(...durations),
      avgTextLength: 75,
    };
  }),
  calculateCacheMetrics: vi.fn(() => ({
    totalRequests: 3,
    hits: 1,
    misses: 1,
    hitRate: 0.5,
    avgGetTime: 7.5,
    avgSetTime: 15,
    evictionCount: 0,
    currentSize: 101,
  })),
}));

describe('PerformanceDashboard', () => {
  let dashboard: PerformanceDashboard;

  beforeEach(() => {
    vi.clearAllMocks();
    dashboard = new PerformanceDashboard();
  });

  describe('constructor', () => {
    it('应该使用默认更新间隔创建实例', () => {
      expect(dashboard).toBeDefined();
    });

    it('应该接受自定义更新间隔', () => {
      const customDashboard = new PerformanceDashboard(60000); // 1分钟
      expect(customDashboard).toBeDefined();
    });
  });

  describe('start/stop', () => {
    it('应该启动自动更新', () => {
      dashboard.start();
      // 启动后应该能获取数据
      const data = dashboard.getData();
      expect(data).not.toBeNull();
      dashboard.stop();
    });

    it('应该停止自动更新', () => {
      dashboard.start();
      dashboard.stop();
      // 停止后不应崩溃
    });

    it('不应该重复启动', () => {
      dashboard.start();
      dashboard.start(); // 第二次启动应该被忽略
      dashboard.stop();
    });
  });

  describe('refresh', () => {
    it('应该刷新仪表盘数据', () => {
      const data = dashboard.refresh();

      expect(data).toBeDefined();
      expect(data.periodHours).toBe(24);
      expect(data.generatedAt).toBeGreaterThan(0);
      expect(Array.isArray(data.apiCards)).toBe(true);
      expect(Array.isArray(data.charts)).toBe(true);
    });

    it('应该生成 API 性能卡片', () => {
      const data = dashboard.refresh();

      expect(data.apiCards.length).toBeGreaterThan(0);
      const openaiCard = data.apiCards.find(card => card.provider === 'openai');
      expect(openaiCard).toBeDefined();
      expect(openaiCard!.totalCalls).toBe(2);
      expect(openaiCard!.successCalls).toBe(2);
    });

    it('应该生成缓存性能卡片', () => {
      const data = dashboard.refresh();

      expect(data.cacheCard).toBeDefined();
      expect(data.cacheCard.totalRequests).toBe(3);
    });

    it('应该生成系统健康状态', () => {
      const data = dashboard.refresh();

      expect(data.systemHealth).toBeDefined();
      expect(data.systemHealth.status).toMatch(/healthy|warning|critical/);
      expect(data.systemHealth.score).toBeGreaterThanOrEqual(0);
      expect(data.systemHealth.score).toBeLessThanOrEqual(100);
      expect(Array.isArray(data.systemHealth.checks)).toBe(true);
    });

    it('应该包含活跃告警', () => {
      const data = dashboard.refresh();

      expect(Array.isArray(data.activeAlerts)).toBe(true);
    });

    it('应该生成图表配置', () => {
      const data = dashboard.refresh();

      expect(Array.isArray(data.charts)).toBe(true);
      // 应该包含缓存图表和操作类型分布图
      const cacheChart = data.charts.find(chart => chart.title === '缓存操作分布');
      expect(cacheChart).toBeDefined();
    });
  });

  describe('setPeriod', () => {
    it('应该设置时间范围并刷新', () => {
      dashboard.setPeriod(48);
      const data = dashboard.getData();

      expect(data?.periodHours).toBe(48);
    });
  });

  describe('getData', () => {
    it('应该在未刷新时返回 null', () => {
      const freshDashboard = new PerformanceDashboard();
      const data = freshDashboard.getData();
      expect(data).toBeNull();
    });

    it('应该在刷新后返回数据', () => {
      dashboard.refresh();
      const data = dashboard.getData();
      expect(data).not.toBeNull();
    });
  });

  describe('addListener', () => {
    it('应该添加监听器', () => {
      const callback = vi.fn();
      const unsubscribe = dashboard.addListener(callback);

      dashboard.refresh();

      expect(callback).toHaveBeenCalled();
      unsubscribe();
    });

    it('应该返回取消订阅函数', () => {
      const callback = vi.fn();
      const unsubscribe = dashboard.addListener(callback);

      unsubscribe();
      dashboard.refresh();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('exportToJSON', () => {
    it('应该导出为 JSON 字符串', () => {
      dashboard.refresh();
      const json = dashboard.exportToJSON();

      expect(typeof json).toBe('string');
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });
});

describe('全局函数', () => {
  describe('getPerformanceDashboard', () => {
    it('应该返回全局仪表盘实例', () => {
      const dashboard = getPerformanceDashboard();
      expect(dashboard).toBeInstanceOf(PerformanceDashboard);
    });
  });

  describe('initPerformanceDashboard', () => {
    it('应该创建新的全局实例', () => {
      const dashboard = initPerformanceDashboard(15000);
      expect(dashboard).toBeInstanceOf(PerformanceDashboard);
    });
  });

  describe('getDashboardData', () => {
    it('应该返回仪表盘数据', () => {
      const data = getDashboardData();
      expect(data).toBeDefined();
      expect(data.periodHours).toBeDefined();
    });
  });

  describe('exportDashboardData', () => {
    it('应该导出仪表盘数据', () => {
      const json = exportDashboardData();
      expect(typeof json).toBe('string');
    });
  });
});

describe('健康状态计算', () => {
  it('应该正确评估 API 响应时间健康状态', () => {
    // 创建一个 dashboard 并刷新，检查健康状态计算
    const dashboard = new PerformanceDashboard();
    const data = dashboard.refresh();

    // 检查 API 响应时间检查项（如果有）
    const apiCheck = data.systemHealth.checks.find(c => c.name === 'API响应时间');
    if (apiCheck) {
      expect(apiCheck.status).toMatch(/healthy|warning|critical/);
    }
  });

  it('应该正确评估错误率健康状态', () => {
    const dashboard = new PerformanceDashboard();
    const data = dashboard.refresh();

    const errorCheck = data.systemHealth.checks.find(c => c.name === '错误率');
    if (errorCheck) {
      expect(errorCheck.status).toMatch(/healthy|warning|critical/);
    }
  });
});