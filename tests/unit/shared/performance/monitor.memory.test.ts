import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerformanceMonitor } from '@/shared/performance/monitor';
import { DEFAULT_PERFORMANCE_CONFIG, MetricType } from '@/shared/performance/types';
import { logger } from '@/shared/utils';

vi.mock('@/shared/utils', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  generateId: vi.fn(() => String(Date.now())),
}));

const MIB = 1024 * 1024;
const SAMPLE_INTERVAL = DEFAULT_PERFORMANCE_CONFIG.memorySampleInterval * 1000;

function setHeapUsage(usedJSHeapSize: number): void {
  vi.stubGlobal('performance', {
    memory: {
      usedJSHeapSize,
      totalJSHeapSize: 128 * MIB,
      jsHeapSizeLimit: 2048 * MIB,
    },
  });
}

describe('PerformanceMonitor 内存采样与告警单位', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    monitor = new PerformanceMonitor({ autoReportInterval: 0 });
  });

  afterEach(() => {
    monitor.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('真实告警数值应显示字节，并保留快照、指标、告警和统计的字节契约', () => {
    const bytes = 66233304;
    const listener = vi.fn();
    monitor.addAlertListener(listener);
    setHeapUsage(bytes);

    vi.advanceTimersByTime(SAMPLE_INTERVAL);

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'PerformanceMonitor: warning 告警 - memory_usage (memory_check): 63.17 MiB (66233304 B)'
    );
    expect(monitor.getMemorySnapshots()).toEqual([{
      timestamp: Date.now(),
      usedHeapSize: bytes,
      totalHeapSize: 128 * MIB,
      heapSizeLimit: 2048 * MIB,
    }]);
    expect(monitor.getMetrics()).toEqual([expect.objectContaining({
      type: MetricType.MEMORY_USAGE,
      operation: 'memory_check',
      duration: bytes,
      metadata: { memoryUsage: bytes },
    })]);
    expect(monitor.getActiveAlerts()).toEqual([expect.objectContaining({
      type: MetricType.MEMORY_USAGE,
      level: 'warning',
      value: bytes,
      threshold: 50 * MIB,
      metadata: { memoryUsage: bytes },
    })]);
    expect(listener).toHaveBeenCalledExactlyOnceWith(monitor.getActiveAlerts()[0]);
    expect(monitor.generateReport().stats).toEqual([expect.objectContaining({
      count: 1,
      avgDuration: bytes,
      minDuration: bytes,
      maxDuration: bytes,
      p50: bytes,
      p95: bytes,
      p99: bytes,
    })]);
  });

  it.each([
    [0, null],
    [50 * MIB - 1, null],
    [50 * MIB, 'warning'],
    [100 * MIB - 1, 'warning'],
    [100 * MIB, 'critical'],
    [512 * MIB, 'critical'],
  ])('内存 %i 字节应按字节阈值产生 %s 告警', (bytes, level) => {
    setHeapUsage(bytes);
    vi.advanceTimersByTime(SAMPLE_INTERVAL);

    expect(monitor.getMetrics()[0].duration).toBe(bytes);
    if (level === null) {
      expect(monitor.getActiveAlerts()).toEqual([]);
      expect(logger.warn).not.toHaveBeenCalled();
    } else {
      expect(monitor.getActiveAlerts()).toEqual([expect.objectContaining({ level, value: bytes })]);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        `PerformanceMonitor: ${level} 告警 - memory_usage (memory_check): ${(bytes / MIB).toFixed(2)} MiB (${bytes} B)`
      );
    }
  });

  it('应保持默认30秒采样及持续超阈时的告警语义，停止后不再采样', () => {
    setHeapUsage(66233304);
    monitor.start();
    vi.advanceTimersByTime(SAMPLE_INTERVAL - 1);
    expect(monitor.getMetrics()).toEqual([]);

    vi.advanceTimersByTime(SAMPLE_INTERVAL + 1);
    expect(monitor.getMetrics()).toHaveLength(2);
    expect(monitor.getMemorySnapshots()).toHaveLength(2);
    expect(monitor.getActiveAlerts()).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledTimes(2);

    monitor.stop();
    vi.advanceTimersByTime(SAMPLE_INTERVAL);
    expect(monitor.getMetrics()).toHaveLength(2);
  });

  it('浏览器未提供内存接口时应跳过采样与告警', () => {
    vi.stubGlobal('performance', {});
    vi.advanceTimersByTime(SAMPLE_INTERVAL);

    expect(monitor.getMemorySnapshots()).toEqual([]);
    expect(monitor.getMetrics()).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each(Object.values(MetricType).filter(type => type !== MetricType.MEMORY_USAGE))(
    '时间类指标 %s 应保留毫秒日志和阈值语义',
    type => {
      monitor.updateConfig({
        thresholds: [{ type, warning: 100, critical: 200, sampleRate: 1, enabled: true }],
      });

      monitor.recordMetric(type, 'translate', 100);
      monitor.recordMetric(type, 'translate', 200);

      expect(logger.warn).toHaveBeenNthCalledWith(
        1, `PerformanceMonitor: warning 告警 - ${type} (translate): 100ms`
      );
      expect(logger.warn).toHaveBeenNthCalledWith(
        2, `PerformanceMonitor: critical 告警 - ${type} (translate): 200ms`
      );
      expect(monitor.getActiveAlerts().map(({ value, threshold }) => ({ value, threshold })))
        .toEqual([{ value: 100, threshold: 100 }, { value: 200, threshold: 200 }]);
    }
  );
});
