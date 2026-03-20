/**
 * 性能监控模块测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MetricType,
  PerformanceMonitor,
  getPerformanceMonitor,
  initPerformanceMonitor,
  recordMetric,
  createTimer,
  measureAsync,
  measureSync,
  DEFAULT_PERFORMANCE_CONFIG,
} from '@/shared/performance';

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    // 每次测试创建新的监控实例
    monitor = new PerformanceMonitor({ enabled: false });
  });

  afterEach(() => {
    monitor.stop();
    monitor.clear();
  });

  describe('构造函数和配置', () => {
    it('应该使用默认配置创建实例', () => {
      const config = monitor.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.maxStoredMetrics).toBe(DEFAULT_PERFORMANCE_CONFIG.maxStoredMetrics);
    });

    it('应该允许自定义配置', () => {
      const customMonitor = new PerformanceMonitor({
        enabled: false,
        maxStoredMetrics: 5000,
      });
      const config = customMonitor.getConfig();
      expect(config.maxStoredMetrics).toBe(5000);
      customMonitor.stop();
    });
  });

  describe('recordMetric', () => {
    it('应该记录性能指标', () => {
      const metric = monitor.recordMetric(
        MetricType.API_RESPONSE_TIME,
        'translate',
        150,
        true
      );

      expect(metric).not.toBeNull();
      expect(metric!.type).toBe(MetricType.API_RESPONSE_TIME);
      expect(metric!.operation).toBe('translate');
      expect(metric!.duration).toBe(150);
      expect(metric!.success).toBe(true);
    });

    it('应该记录失败的指标', () => {
      const metric = monitor.recordMetric(
        MetricType.API_RESPONSE_TIME,
        'translate',
        0,
        false,
        { errorMessage: 'Network error' }
      );

      expect(metric).not.toBeNull();
      expect(metric!.success).toBe(false);
      expect(metric!.metadata?.errorMessage).toBe('Network error');
    });

    it('应该包含元数据', () => {
      const metric = monitor.recordMetric(
        MetricType.API_RESPONSE_TIME,
        'translate',
        100,
        true,
        { textLength: 50, provider: 'deepl' }
      );

      expect(metric).not.toBeNull();
      expect(metric!.metadata?.textLength).toBe(50);
      expect(metric!.metadata?.provider).toBe('deepl');
    });

    it('应该生成唯一 ID', () => {
      const metric1 = monitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);
      const metric2 = monitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);

      expect(metric1!.id).not.toBe(metric2!.id);
    });

    it('应该包含时间戳', () => {
      const before = Date.now();
      const metric = monitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);
      const after = Date.now();

      expect(metric!.timestamp).toBeGreaterThanOrEqual(before);
      expect(metric!.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('getMetrics', () => {
    // 使用采样率为 1.0 的监控器确保测试稳定
    let filterMonitor: PerformanceMonitor;

    beforeEach(() => {
      filterMonitor = new PerformanceMonitor({
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
            type: MetricType.DOM_RENDER_TIME,
            warning: 100,
            critical: 500,
            sampleRate: 1.0,
            enabled: true,
          },
        ],
      });
      // 添加一些测试数据
      filterMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);
      filterMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 200);
      filterMonitor.recordMetric(MetricType.DOM_RENDER_TIME, 'dom_render', 50);
    });

    afterEach(() => {
      filterMonitor.stop();
      filterMonitor.clear();
    });

    it('应该获取所有指标', () => {
      const metrics = filterMonitor.getMetrics();
      expect(metrics.length).toBe(3);
    });

    it('应该按类型过滤', () => {
      const metrics = filterMonitor.getMetrics({ type: MetricType.API_RESPONSE_TIME });
      expect(metrics.length).toBe(2);
      expect(metrics.every(m => m.type === MetricType.API_RESPONSE_TIME)).toBe(true);
    });

    it('应该按操作过滤', () => {
      const metrics = filterMonitor.getMetrics({ operation: 'dom_render' });
      expect(metrics.length).toBe(1);
    });

    it('应该限制数量', () => {
      const metrics = filterMonitor.getMetrics({ limit: 2 });
      expect(metrics.length).toBe(2);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      // 添加一些测试数据用于统计计算
      for (let i = 1; i <= 10; i++) {
        monitor.recordMetric(
          MetricType.API_RESPONSE_TIME,
          'translate',
          i * 10, // 10, 20, 30, ..., 100
          i % 3 !== 0 // 每3个失败一次
        );
      }
    });

    it('应该计算正确的统计值', () => {
      const stats = monitor.getStats(MetricType.API_RESPONSE_TIME, 'translate');

      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(10);
      expect(stats!.minDuration).toBe(10);
      expect(stats!.maxDuration).toBe(100);
      expect(stats!.avgDuration).toBe(55); // (10+20+...+100)/10
    });

    it('应该计算成功率', () => {
      const stats = monitor.getStats(MetricType.API_RESPONSE_TIME, 'translate');

      // 10个中有3个失败 (第3, 6, 9个)
      expect(stats!.successRate).toBeCloseTo(0.7, 2);
    });

    it('应该计算百分位数', () => {
      const stats = monitor.getStats(MetricType.API_RESPONSE_TIME, 'translate');

      expect(stats!.p50).toBe(50); // 中位数
      expect(stats!.p95).toBe(100);
    });

    it('没有数据时应该返回 null', () => {
      const stats = monitor.getStats(MetricType.CACHE_OPERATION, 'cache_get');
      expect(stats).toBeNull();
    });
  });

  describe('createTimer', () => {
    it('应该返回计时函数', () => {
      const timer = monitor.createTimer();
      expect(typeof timer).toBe('function');
    });

    it('应该测量经过的时间', async () => {
      const timer = monitor.createTimer();
      await new Promise(resolve => setTimeout(resolve, 50));
      const elapsed = timer();

      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('wrapAsync', () => {
    it('应该包装成功的异步函数', async () => {
      const result = await monitor.wrapAsync(
        MetricType.API_RESPONSE_TIME,
        'translate',
        async () => 'success'
      );

      expect(result).toBe('success');

      const metrics = monitor.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].success).toBe(true);
    });

    it('应该包装失败的异步函数', async () => {
      await expect(
        monitor.wrapAsync(
          MetricType.API_RESPONSE_TIME,
          'translate',
          async () => {
            throw new Error('Test error');
          }
        )
      ).rejects.toThrow('Test error');

      const metrics = monitor.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].success).toBe(false);
    });
  });

  describe('wrapSync', () => {
    // 创建一个采样率为 1.0 的监控器，确保测试稳定
    let syncMonitor: PerformanceMonitor;

    beforeEach(() => {
      syncMonitor = new PerformanceMonitor({
        enabled: false,
        thresholds: [
          {
            type: MetricType.DOM_RENDER_TIME,
            warning: 100,
            critical: 500,
            sampleRate: 1.0, // 确保每次都记录
            enabled: true,
          },
        ],
      });
    });

    afterEach(() => {
      syncMonitor.stop();
      syncMonitor.clear();
    });

    it('应该包装成功的同步函数', () => {
      const result = syncMonitor.wrapSync(
        MetricType.DOM_RENDER_TIME,
        'dom_render',
        () => 'done'
      );

      expect(result).toBe('done');

      const metrics = syncMonitor.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].success).toBe(true);
    });

    it('应该包装失败的同步函数', () => {
      expect(() =>
        syncMonitor.wrapSync(
          MetricType.DOM_RENDER_TIME,
          'dom_render',
          () => {
            throw new Error('Sync error');
          }
        )
      ).toThrow('Sync error');

      const metrics = syncMonitor.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].success).toBe(false);
    });
  });

  describe('告警功能', () => {
    it('应该在超出阈值时创建告警', () => {
      // 创建一个带低阈值的监控器
      const alertMonitor = new PerformanceMonitor({
        enabled: false,
        thresholds: [
          {
            type: MetricType.API_RESPONSE_TIME,
            warning: 100,
            critical: 500,
            sampleRate: 1.0,
            enabled: true,
          },
        ],
      });

      // 记录一个超过警告阈值的指标
      alertMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 200);

      const alerts = alertMonitor.getActiveAlerts();
      expect(alerts.length).toBe(1);
      expect(alerts[0].level).toBe('warning');

      alertMonitor.stop();
    });

    it('应该创建严重级别告警', () => {
      const alertMonitor = new PerformanceMonitor({
        enabled: false,
        thresholds: [
          {
            type: MetricType.API_RESPONSE_TIME,
            warning: 100,
            critical: 500,
            sampleRate: 1.0,
            enabled: true,
          },
        ],
      });

      alertMonitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 600);

      const alerts = alertMonitor.getActiveAlerts();
      expect(alerts.length).toBe(1);
      expect(alerts[0].level).toBe('critical');

      alertMonitor.stop();
    });
  });

  describe('监听器', () => {
    it('应该通知指标监听器', () => {
      const listener = vi.fn();
      monitor.addListener(listener);

      monitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        type: MetricType.API_RESPONSE_TIME,
        operation: 'translate',
      }));
    });

    it('应该返回取消订阅函数', () => {
      const listener = vi.fn();
      const unsubscribe = monitor.addListener(listener);

      monitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      monitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);
      expect(listener).toHaveBeenCalledTimes(1); // 没有增加
    });
  });

  describe('clear', () => {
    it('应该清空所有数据', () => {
      monitor.recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);
      monitor.recordMetric(MetricType.DOM_RENDER_TIME, 'dom_render', 50);

      monitor.clear();

      expect(monitor.getMetrics().length).toBe(0);
    });
  });
});

describe('便捷函数', () => {
  beforeEach(() => {
    // 初始化全局监控器
    initPerformanceMonitor({ enabled: false });
  });

  afterEach(() => {
    const monitor = getPerformanceMonitor();
    monitor.stop();
    monitor.clear();
  });

  describe('recordMetric', () => {
    it('应该使用全局监控器记录指标', () => {
      const metric = recordMetric(MetricType.API_RESPONSE_TIME, 'translate', 100);

      expect(metric).not.toBeNull();
      expect(metric!.type).toBe(MetricType.API_RESPONSE_TIME);
    });
  });

  describe('createTimer', () => {
    it('应该返回计时函数', () => {
      const timer = createTimer();
      expect(typeof timer).toBe('function');
    });
  });

  describe('measureAsync', () => {
    it('应该测量异步函数', async () => {
      const result = await measureAsync(
        MetricType.API_RESPONSE_TIME,
        'translate',
        async () => 'test result'
      );

      expect(result).toBe('test result');
    });
  });

  describe('measureSync', () => {
    it('应该测量同步函数', () => {
      const result = measureSync(
        MetricType.DOM_RENDER_TIME,
        'dom_render',
        () => 'sync result'
      );

      expect(result).toBe('sync result');
    });
  });
});

describe('MetricType 枚举', () => {
  it('应该包含所有预期的指标类型', () => {
    expect(MetricType.API_RESPONSE_TIME).toBe('api_response_time');
    expect(MetricType.DOM_RENDER_TIME).toBe('dom_render_time');
    expect(MetricType.STORAGE_OPERATION).toBe('storage_operation');
    expect(MetricType.MEMORY_USAGE).toBe('memory_usage');
    expect(MetricType.BATCH_TRANSLATION).toBe('batch_translation');
    expect(MetricType.CACHE_OPERATION).toBe('cache_operation');
    expect(MetricType.MESSAGE_LATENCY).toBe('message_latency');
    expect(MetricType.TRANSLATION_TOTAL_TIME).toBe('translation_total_time');
  });
});

describe('DEFAULT_PERFORMANCE_CONFIG', () => {
  it('应该有合理的默认值', () => {
    expect(DEFAULT_PERFORMANCE_CONFIG.enabled).toBe(true);
    expect(DEFAULT_PERFORMANCE_CONFIG.maxStoredMetrics).toBe(10000);
    expect(DEFAULT_PERFORMANCE_CONFIG.autoReportInterval).toBe(60);
    expect(DEFAULT_PERFORMANCE_CONFIG.thresholds.length).toBeGreaterThan(0);
  });

  it('阈值应该配置正确', () => {
    const apiThreshold = DEFAULT_PERFORMANCE_CONFIG.thresholds.find(
      t => t.type === MetricType.API_RESPONSE_TIME
    );

    expect(apiThreshold).toBeDefined();
    expect(apiThreshold!.warning).toBe(2000);
    expect(apiThreshold!.critical).toBe(5000);
    expect(apiThreshold!.enabled).toBe(true);
  });
});