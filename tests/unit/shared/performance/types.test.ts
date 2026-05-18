/**
 * 性能监控类型和配置测试
 */
import { describe, it, expect } from 'vitest';
import {
  MetricType,
  DEFAULT_PERFORMANCE_CONFIG,
} from '@/shared/performance/types';
import type { OperationType, PerformanceThreshold } from '@/shared/performance/types';

describe('MetricType', () => {
  it('should define all metric types', () => {
    expect(MetricType.API_RESPONSE_TIME).toBe('api_response_time');
    expect(MetricType.DOM_RENDER_TIME).toBe('dom_render_time');
    expect(MetricType.STORAGE_OPERATION).toBe('storage_operation');
    expect(MetricType.MEMORY_USAGE).toBe('memory_usage');
    expect(MetricType.BATCH_TRANSLATION).toBe('batch_translation');
    expect(MetricType.CACHE_OPERATION).toBe('cache_operation');
    expect(MetricType.MESSAGE_LATENCY).toBe('message_latency');
    expect(MetricType.TRANSLATION_TOTAL_TIME).toBe('translation_total_time');
  });

  it('should have 8 metric types', () => {
    expect(Object.keys(MetricType).length).toBe(8);
  });
});

describe('DEFAULT_PERFORMANCE_CONFIG', () => {
  it('should have enabled true', () => {
    expect(DEFAULT_PERFORMANCE_CONFIG.enabled).toBe(true);
  });

  it('should have maxStoredMetrics 10000', () => {
    expect(DEFAULT_PERFORMANCE_CONFIG.maxStoredMetrics).toBe(10000);
  });

  it('should have autoReportInterval 60 minutes', () => {
    expect(DEFAULT_PERFORMANCE_CONFIG.autoReportInterval).toBe(60);
  });

  it('should enable memory monitoring with 30s interval', () => {
    expect(DEFAULT_PERFORMANCE_CONFIG.enableMemoryMonitoring).toBe(true);
    expect(DEFAULT_PERFORMANCE_CONFIG.memorySampleInterval).toBe(30);
  });

  it('should have thresholds for all enabled metric types', () => {
    const thresholdTypes = DEFAULT_PERFORMANCE_CONFIG.thresholds.map(t => t.type);
    expect(thresholdTypes).toContain(MetricType.API_RESPONSE_TIME);
    expect(thresholdTypes).toContain(MetricType.DOM_RENDER_TIME);
    expect(thresholdTypes).toContain(MetricType.STORAGE_OPERATION);
    expect(thresholdTypes).toContain(MetricType.MEMORY_USAGE);
    expect(thresholdTypes).toContain(MetricType.BATCH_TRANSLATION);
    expect(thresholdTypes).toContain(MetricType.CACHE_OPERATION);
    expect(thresholdTypes).toContain(MetricType.MESSAGE_LATENCY);
  });

  it('API_RESPONSE_TIME thresholds should be reasonable', () => {
    const apiThreshold = DEFAULT_PERFORMANCE_CONFIG.thresholds.find(t => t.type === MetricType.API_RESPONSE_TIME)!;
    expect(apiThreshold.warning).toBe(2000);
    expect(apiThreshold.critical).toBe(5000);
    expect(apiThreshold.critical).toBeGreaterThan(apiThreshold.warning);
  });

  it('DOM_RENDER_TIME thresholds should be reasonable', () => {
    const domThreshold = DEFAULT_PERFORMANCE_CONFIG.thresholds.find(t => t.type === MetricType.DOM_RENDER_TIME)!;
    expect(domThreshold.warning).toBe(100);
    expect(domThreshold.critical).toBe(500);
    expect(domThreshold.critical).toBeGreaterThan(domThreshold.warning);
  });

  it('MEMORY_USAGE thresholds should be in megabytes', () => {
    const memThreshold = DEFAULT_PERFORMANCE_CONFIG.thresholds.find(t => t.type === MetricType.MEMORY_USAGE)!;
    expect(memThreshold.warning).toBe(50 * 1024 * 1024);
    expect(memThreshold.critical).toBe(100 * 1024 * 1024);
  });

  it('all thresholds should have critical > warning', () => {
    for (const threshold of DEFAULT_PERFORMANCE_CONFIG.thresholds) {
      expect(threshold.critical).toBeGreaterThan(threshold.warning);
    }
  });

  it('all thresholds should have valid sampleRate', () => {
    for (const threshold of DEFAULT_PERFORMANCE_CONFIG.thresholds) {
      expect(threshold.sampleRate).toBeGreaterThan(0);
      expect(threshold.sampleRate).toBeLessThanOrEqual(1);
    }
  });

  it('all thresholds should have positive warning values', () => {
    for (const threshold of DEFAULT_PERFORMANCE_CONFIG.thresholds) {
      expect(threshold.warning).toBeGreaterThan(0);
    }
  });

  it('all thresholds should have enabled true', () => {
    for (const threshold of DEFAULT_PERFORMANCE_CONFIG.thresholds) {
      expect(threshold.enabled).toBe(true);
    }
  });

  it('should have 7 threshold configurations', () => {
    expect(DEFAULT_PERFORMANCE_CONFIG.thresholds).toHaveLength(7);
  });
});
