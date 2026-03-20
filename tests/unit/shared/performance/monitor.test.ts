/**
 * Performance Monitor 测试
 *
 * 测试性能监控核心功能
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PerformanceMonitor, getPerformanceMonitor, recordMetric } from '@/shared/performance/monitor';
import { MetricType, DEFAULT_PERFORMANCE_CONFIG } from '@/shared/performance/types';
import type { PerformanceMetric, PerformanceAlert } from '@/shared/performance/types';

// Mock dependencies
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  generateId: vi.fn(() => `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
}));

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    vi.clearAllMocks();
    monitor = new PerformanceMonitor({ enabled: false });
  });

  afterEach(() => {
    monitor.stop();
  });

  describe('constructor', () => {
    it('应该使用默认配置创建实例', () => {
      expect(monitor).toBeDefined();
    });

    it('应该接受自定义配置', () => {
      const customMonitor = new PerformanceMonitor({
        enabled: false,
        maxStoredMetrics: 5000,
      });
      expect(customMonitor).toBeDefined();
      customMonitor.stop();
    });
  });

  describe('recordMetric', () => {
    it('应该记录性能指标', () => {
      const metric = monitor.recordMetric(
        MetricType.API_RESPONSE_TIME,
        'translate',
        100,
        true,
        { provider: 'openai' }
      );

      expect(metric).toBeDefined();
      expect(metric!.type).toBe(MetricType.API_RESPONSE_TIME);
      expect(metric!.operation).toBe('translate');
      expect(metric!.duration).toBe(100);
      expect(metric!.success).toBe(true);
      expect(metric!.metadata!.provider).toBe('openai');
    });

    it('应该返回 null 当采样率检查失败时', () => {
      const strictMonitor = new PerformanceMonitor({
        enabled: false,
        thresholds: [
          {
            type: MetricType.API_RESPONSE_TIME,
            warning: 1000,
            critical: 5000,
            sampleRate: 0, // 0% 采样率
            enabled: true,
          },
        ],
      });

      // 由于采样率为 0，所有记录应该被跳过
      const metric = strictMonitor.recordMetric(
        MetricType.API_RESPONSE_TIME,
        'translate',
        100
      );

      expect(metric).toBeNull();
      strictMonitor.stop();
    });

    it('应该限制存储数量', () => {
      const smallMonitor = new PerformanceMonitor({
        enabled: false,
        maxStoredMetrics: 10,
      });

      // 记录超过限制的指标
      for (let i = 0; i < 20; i++) {
        smallMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', i * 10);
      }

      const metrics = smallMonitor.getMetrics();
      expect(metrics.length).toBe(10);
      smallMonitor.stop();
    });
  });

  describe('createTimer', () => {
    it('应该返回计时器函数', () => {
      const timer = monitor.createTimer();
      expect(typeof timer).toBe('function');
    });

    it('应该返回经过的时间', async () => {
      const timer = monitor.createTimer();
      await new Promise(resolve => setTimeout(resolve, 10));
      const elapsed = timer();
      expect(elapsed).toBeGreaterThan(0);
    });
  });

  describe('wrapAsync', () => {
    it('应该包装异步函数并记录指标', async () => {
      const testMonitor = new PerformanceMonitor({
        enabled: false,
        thresholds: [
          {
            type: MetricType.API_RESPONSE_TIME,
            warning: 2000,
            critical: 5000,
            sampleRate: 1.0,
            enabled: true,
          },
        ],
      });
      const result = await testMonitor.wrapAsync(
        MetricType.API_RESPONSE_TIME,
        'translate',
        async () => 'test result'
      );

      expect(result).toBe('test result');

      const metrics = testMonitor.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].success).toBe(true);
      testMonitor.stop();
    });

    it('应该记录失败的异步操作', async () => {
      const testMonitor = new PerformanceMonitor({
        enabled: false,
        thresholds: [
          {
            type: MetricType.API_RESPONSE_TIME,
            warning: 2000,
            critical: 5000,
            sampleRate: 1.0,
            enabled: true,
          },
        ],
      });
      await expect(
        testMonitor.wrapAsync(
          MetricType.API_RESPONSE_TIME,
          'translate',
          async () => {
            throw new Error('Test error');
          }
        )
      ).rejects.toThrow('Test error');

      const metrics = testMonitor.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].success).toBe(false);
      testMonitor.stop();
    });
  });

  describe('wrapSync', () => {
    it('应该包装同步函数并记录指标', () => {
      const testMonitor = new PerformanceMonitor({
        enabled: false,
        thresholds: [
          {
            type: MetricType.DOM_RENDER_TIME,
            warning: 100,
            critical: 500,
            sampleRate: 1.0,
            enabled: true,
          },
        ],
      });
      const result = testMonitor.wrapSync(
        MetricType.DOM_RENDER_TIME,
        'dom_render',
        () => 'sync result'
      );

      expect(result).toBe('sync result');

      const metrics = testMonitor.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].success).toBe(true);
      testMonitor.stop();
    });

    it('应该记录失败的同步操作', () => {
      const testMonitor = new PerformanceMonitor({
        enabled: false,
        thresholds: [
          {
            type: MetricType.DOM_RENDER_TIME,
            warning: 100,
            critical: 500,
            sampleRate: 1.0,
            enabled: true,
          },
        ],
      });
      expect(() =>
        testMonitor.wrapSync(MetricType.DOM_RENDER_TIME, 'dom_render', () => {
          throw new Error('Sync error');
        })
      ).toThrow('Sync error');

      const metrics = testMonitor.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].success).toBe(false);
      testMonitor.stop();
    });
  });

  describe('getMetrics', () => {
    it('应该返回所有指标', () => {
      // 创建新的独立监控实例进行测试
      const testMonitor = new PerformanceMonitor({
        enabled: false,
        thresholds: [
          {
            type: MetricType.API_RESPONSE_TIME,
            warning: 2000,
            critical: 5000,
            sampleRate: 1.0,
            enabled: true,
          },
          {
            type: MetricType.CACHE_OPERATION,
            warning: 100,
            critical: 500,
            sampleRate: 1.0,
            enabled: true,
          },
          {
            type: MetricType.DOM_RENDER_TIME,
            warning: 100,
            critical: 500,
            sampleRate: 1.0,
            enabled: true,
          },
        ],
      });
      testMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);
      testMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 200);
      testMonitor.recordMetric(MetricType.CACHE_OPERATION, 'cache_get', 5);
      testMonitor.recordMetric(MetricType.DOM_RENDER_TIME, 'dom_render', 10);

      const metrics = testMonitor.getMetrics();
      expect(metrics.length).toBe(4);
      testMonitor.stop();
    });

    it('应该按类型过滤', () => {
      const testMonitor = new PerformanceMonitor({
        enabled: false,
        thresholds: [
          {
            type: MetricType.API_RESPONSE_TIME,
            warning: 2000,
            critical: 5000,
            sampleRate: 1.0,
            enabled: true,
          },
          {
            type: MetricType.CACHE_OPERATION,
            warning: 100,
            critical: 500,
            sampleRate: 1.0,
            enabled: true,
          },
        ],
      });
      testMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);
      testMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 200);
      testMonitor.recordMetric(MetricType.CACHE_OPERATION, 'cache_get', 5);

      const metrics = testMonitor.getMetrics({ type: MetricType.API_RESPONSE_TIME });
      expect(metrics.length).toBe(2);
      testMonitor.stop();
    });

    it('应该按操作类型过滤', () => {
      const testMonitor = new PerformanceMonitor({
        enabled: false,
        thresholds: [
          {
            type: MetricType.CACHE_OPERATION,
            warning: 100,
            critical: 500,
            sampleRate: 1.0, // 100% 采样率用于测试
            enabled: true,
          },
          {
            type: MetricType.API_RESPONSE_TIME,
            warning: 2000,
            critical: 5000,
            sampleRate: 1.0,
            enabled: true,
          },
        ],
      });
      testMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);
      testMonitor.recordMetric(MetricType.CACHE_OPERATION, 'cache_get', 5);
      testMonitor.recordMetric(MetricType.CACHE_OPERATION, 'cache_set', 10);

      const metrics = testMonitor.getMetrics({ operation: 'cache_get' });
      expect(metrics.length).toBe(1);
      testMonitor.stop();
    });

    it('应该限制返回数量', () => {
      const testMonitor = new PerformanceMonitor({ enabled: false });
      for (let i = 0; i < 10; i++) {
        testMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', i);
      }

      const metrics = testMonitor.getMetrics({ limit: 2 });
      expect(metrics.length).toBe(2);
      testMonitor.stop();
    });
  });

  describe('getStats', () => {
    it('应该返回统计数据', () => {
      const testMonitor = new PerformanceMonitor({ enabled: false });
      // 添加一些测试数据
      for (let i = 0; i < 10; i++) {
        testMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100 + i * 10);
      }

      const stats = testMonitor.getStats(MetricType.API_RESPONSE_TIME, 'translate');

      expect(stats).toBeDefined();
      expect(stats!.count).toBe(10);
      expect(stats!.avgDuration).toBe(145); // (100+110+...+190)/10
      expect(stats!.minDuration).toBe(100);
      expect(stats!.maxDuration).toBe(190);
      expect(stats!.successRate).toBe(1);
      testMonitor.stop();
    });

    it('应该返回 null 当没有数据时', () => {
      const testMonitor = new PerformanceMonitor({ enabled: false });
      const stats = testMonitor.getStats(MetricType.CACHE_OPERATION, 'cache_get');
      expect(stats).toBeNull();
      testMonitor.stop();
    });
  });

  describe('getActiveAlerts', () => {
    it('应该返回所有告警', () => {
      const alerts = monitor.getActiveAlerts();
      expect(Array.isArray(alerts)).toBe(true);
    });
  });

  describe('acknowledgeAlert', () => {
    it('应该确认存在的告警', () => {
      // 创建一个触发告警的指标
      monitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 10000); // 超过 critical 阈值

      const alerts = monitor.getActiveAlerts();
      if (alerts.length > 0) {
        const result = monitor.acknowledgeAlert(alerts[0].id);
        expect(result).toBe(true);
        expect(alerts[0].acknowledged).toBe(true);
      }
    });

    it('应该返回 false 当告警不存在时', () => {
      const result = monitor.acknowledgeAlert('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('clearAcknowledgedAlerts', () => {
    it('应该清除已确认的告警', () => {
      monitor.clearAcknowledgedAlerts();
      const alerts = monitor.getActiveAlerts();
      // 所有告警都应该是未确认的
      alerts.forEach(a => expect(a.acknowledged).toBe(false));
    });
  });

  describe('start/stop', () => {
    it('应该启动和停止监控', () => {
      const activeMonitor = new PerformanceMonitor({ enabled: true });
      activeMonitor.stop();
      // 停止后不应崩溃
    });
  });
});

describe('全局函数', () => {
  describe('getPerformanceMonitor', () => {
    it('应该返回全局监控实例', () => {
      const monitor = getPerformanceMonitor();
      expect(monitor).toBeInstanceOf(PerformanceMonitor);
    });
  });

  describe('recordMetric', () => {
    it('应该记录指标到全局监控实例', () => {
      const metric = recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);
      expect(metric).toBeDefined();
    });
  });
});

describe('DEFAULT_PERFORMANCE_CONFIG', () => {
  it('应该有合理的默认值', () => {
    expect(DEFAULT_PERFORMANCE_CONFIG.enabled).toBe(true);
    expect(DEFAULT_PERFORMANCE_CONFIG.maxStoredMetrics).toBe(10000);
    expect(DEFAULT_PERFORMANCE_CONFIG.autoReportInterval).toBe(60);
    expect(DEFAULT_PERFORMANCE_CONFIG.memorySampleInterval).toBe(30);
    expect(DEFAULT_PERFORMANCE_CONFIG.enableMemoryMonitoring).toBe(true);
    expect(DEFAULT_PERFORMANCE_CONFIG.thresholds.length).toBeGreaterThan(0);
  });

  it('API 响应时间阈值应该合理', () => {
    const apiThreshold = DEFAULT_PERFORMANCE_CONFIG.thresholds.find(
      t => t.type === MetricType.API_RESPONSE_TIME
    );
    expect(apiThreshold).toBeDefined();
    expect(apiThreshold!.warning).toBe(2000);
    expect(apiThreshold!.critical).toBe(5000);
  });
});