/**
 * 错误追踪系统常量测试
 */
import { describe, it, expect } from 'vitest';
import {
  ERROR_STORAGE_KEY,
  ERROR_CONFIG_KEY,
  DEFAULT_ERROR_TRACKING_CONFIG,
  ERROR_REPORT_CONFIG,
  ERROR_AGGREGATION_CONFIG,
  ERROR_API_ENDPOINTS,
  EXTENSION_VERSION,
} from '@/shared/error-tracking/constants';

describe('错误追踪系统常量', () => {
  it('should define storage keys', () => {
    expect(ERROR_STORAGE_KEY).toBe('errorTracking');
    expect(ERROR_CONFIG_KEY).toBe('errorTrackingConfig');
  });

  it('should have default config with required fields', () => {
    expect(DEFAULT_ERROR_TRACKING_CONFIG.maxEntries).toBe(100);
    expect(DEFAULT_ERROR_TRACKING_CONFIG.autoReport).toBe(true);
    expect(DEFAULT_ERROR_TRACKING_CONFIG.reportInterval).toBe(5 * 60 * 1000);
    expect(DEFAULT_ERROR_TRACKING_CONFIG.captureGlobalErrors).toBe(true);
    expect(DEFAULT_ERROR_TRACKING_CONFIG.captureUnhandledRejections).toBe(true);
    expect(DEFAULT_ERROR_TRACKING_CONFIG.sampleRate).toBe(1.0);
  });

  it('should have report config with valid values', () => {
    expect(ERROR_REPORT_CONFIG.maxBatchSize).toBe(50);
    expect(ERROR_REPORT_CONFIG.maxRetries).toBe(3);
    expect(ERROR_REPORT_CONFIG.retryDelay).toBe(1000);
    expect(ERROR_REPORT_CONFIG.timeout).toBe(30000);
  });

  it('should have aggregation config with valid values', () => {
    expect(ERROR_AGGREGATION_CONFIG.timeWindow).toBe(30 * 60 * 1000);
    expect(ERROR_AGGREGATION_CONFIG.maxStackDepth).toBe(20);
    expect(ERROR_AGGREGATION_CONFIG.maxMessageLength).toBe(500);
  });

  it('should define API endpoints', () => {
    expect(ERROR_API_ENDPOINTS.report).toBe('/api/errors/report');
    expect(ERROR_API_ENDPOINTS.batch).toBe('/api/errors/batch');
    expect(ERROR_API_ENDPOINTS.stats).toBe('/api/errors/stats');
  });

  it('should define extension version', () => {
    expect(EXTENSION_VERSION).toBe('1.0.0');
  });

  it('config values should be positive numbers', () => {
    const configs = [
      DEFAULT_ERROR_TRACKING_CONFIG.maxEntries,
      DEFAULT_ERROR_TRACKING_CONFIG.reportInterval,
      ERROR_REPORT_CONFIG.maxBatchSize,
      ERROR_REPORT_CONFIG.maxRetries,
      ERROR_REPORT_CONFIG.retryDelay,
      ERROR_REPORT_CONFIG.timeout,
      ERROR_AGGREGATION_CONFIG.timeWindow,
      ERROR_AGGREGATION_CONFIG.maxStackDepth,
      ERROR_AGGREGATION_CONFIG.maxMessageLength,
    ];

    configs.forEach(value => {
      expect(value).toBeGreaterThan(0);
    });
  });
});
