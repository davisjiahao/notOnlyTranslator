/**
 * 错误追踪存储模块测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getErrorConfig,
  updateErrorConfig,
  getAllErrors,
  getErrorById,
  queryErrors,
  saveError,
  saveErrors,
  deleteError,
  deleteErrors,
  getUnreportedErrors,
  markErrorsAsReported,
  clearAllErrors,
  getErrorStats
} from '@/shared/error-tracking/storage';
import { ERROR_STORAGE_KEY, ERROR_CONFIG_KEY, DEFAULT_ERROR_TRACKING_CONFIG } from '@/shared/error-tracking/constants';
import type { ErrorEntry } from '@/shared/error-tracking/types';

// Mock chrome.storage.local at module level
const mockStorage: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string[]) => {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in mockStorage) {
            result[key] = mockStorage[key];
          }
        }
        return result;
      }),
      set: vi.fn(async (data: Record<string, unknown>) => {
        Object.assign(mockStorage, data);
      }),
      remove: vi.fn(async (keys: string[]) => {
        for (const key of keys) {
          delete mockStorage[key];
        }
      })
    }
  }
});

function createErrorEntry(overrides: Partial<ErrorEntry> = {}): ErrorEntry {
  const now = Date.now();
  return {
    id: `err-${Math.random().toString(36).slice(2)}`,
    message: 'Test error message',
    category: 'runtime',
    severity: 'error',
    timestamp: now,
    reported: false,
    count: 1,
    firstOccurredAt: now,
    ...overrides
  };
}

describe('错误追踪存储模块', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
    vi.clearAllMocks();
  });

  describe('getErrorConfig', () => {
    it('should return default config when no config stored', async () => {
      const config = await getErrorConfig();
      expect(config).toEqual(DEFAULT_ERROR_TRACKING_CONFIG);
    });

    it('should merge stored config with defaults', async () => {
      mockStorage[ERROR_CONFIG_KEY] = { maxEntries: 200 };
      const config = await getErrorConfig();
      expect(config.maxEntries).toBe(200);
      expect(config.autoReport).toBe(true);
    });

    it('should return defaults on storage error', async () => {
      (globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Storage error'));
      const config = await getErrorConfig();
      expect(config).toEqual(DEFAULT_ERROR_TRACKING_CONFIG);
    });
  });

  describe('updateErrorConfig', () => {
    it('should update config and persist to storage', async () => {
      const updated = await updateErrorConfig({ maxEntries: 50, autoReport: false });
      expect(updated.maxEntries).toBe(50);
      expect(updated.autoReport).toBe(false);
      expect(updated.sampleRate).toBe(1.0);

      const stored = mockStorage[ERROR_CONFIG_KEY] as Record<string, unknown>;
      expect(stored.maxEntries).toBe(50);
    });

    it('should throw on storage error', async () => {
      (globalThis.chrome.storage.local.set as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Storage error'));
      await expect(updateErrorConfig({ maxEntries: 50 })).rejects.toThrow('更新配置失败');
    });
  });

  describe('getAllErrors', () => {
    it('should return empty array when no errors stored', async () => {
      const errors = await getAllErrors();
      expect(errors).toEqual([]);
    });

    it('should return errors sorted by timestamp descending', async () => {
      const errors: ErrorEntry[] = [
        createErrorEntry({ timestamp: 1000 }),
        createErrorEntry({ timestamp: 3000 }),
        createErrorEntry({ timestamp: 2000 })
      ];
      mockStorage[ERROR_STORAGE_KEY] = errors;

      const result = await getAllErrors();
      expect(result).toHaveLength(3);
      expect(result[0].timestamp).toBe(3000);
      expect(result[1].timestamp).toBe(2000);
      expect(result[2].timestamp).toBe(1000);
    });
  });

  describe('getErrorById', () => {
    it('should return null when error not found', async () => {
      const result = await getErrorById('nonexistent');
      expect(result).toBeNull();
    });

    it('should return error by ID', async () => {
      const error = createErrorEntry({ id: 'err-123', message: 'Specific error' });
      mockStorage[ERROR_STORAGE_KEY] = [error];

      const result = await getErrorById('err-123');
      expect(result).not.toBeNull();
      expect(result!.message).toBe('Specific error');
    });
  });

  describe('queryErrors', () => {
    const errors: ErrorEntry[] = [
      createErrorEntry({ id: '1', category: 'runtime', severity: 'error', timestamp: 1000, reported: false }),
      createErrorEntry({ id: '2', category: 'network', severity: 'fatal', timestamp: 2000, reported: true }),
      createErrorEntry({ id: '3', category: 'runtime', severity: 'warning', timestamp: 3000, reported: false }),
      createErrorEntry({ id: '4', category: 'api', severity: 'error', timestamp: 4000, reported: true }),
      createErrorEntry({ id: '5', category: 'storage', severity: 'warning', timestamp: 5000, reported: false })
    ];

    beforeEach(() => {
      mockStorage[ERROR_STORAGE_KEY] = errors;
    });

    it('should return all errors with default params', async () => {
      const result = await queryErrors();
      expect(result.total).toBe(5);
      expect(result.errors).toHaveLength(5);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by category', async () => {
      const result = await queryErrors({ category: 'runtime' });
      expect(result.total).toBe(2);
      expect(result.errors.every(e => e.category === 'runtime')).toBe(true);
    });

    it('should filter by severity', async () => {
      const result = await queryErrors({ severity: 'warning' });
      expect(result.total).toBe(2);
    });

    it('should filter by reported status', async () => {
      const result = await queryErrors({ reported: true });
      expect(result.total).toBe(2);
      expect(result.errors.every(e => e.reported === true)).toBe(true);
    });

    it('should filter by time range', async () => {
      const result = await queryErrors({ startTime: 2000, endTime: 4000 });
      expect(result.total).toBe(3);
    });

    it('should support pagination with limit and offset', async () => {
      const result = await queryErrors({ limit: 2, offset: 1 });
      expect(result.errors).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(true);
    });

    it('should set hasMore correctly when last page', async () => {
      const result = await queryErrors({ limit: 5, offset: 0 });
      expect(result.hasMore).toBe(false);
    });
  });

  describe('saveError', () => {
    it('should save a new error', async () => {
      const error = createErrorEntry();
      await saveError(error);

      const stored = mockStorage[ERROR_STORAGE_KEY] as ErrorEntry[];
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(error.id);
    });

    it('should aggregate similar errors within 30 minutes', async () => {
      const now = Date.now();
      const error1 = createErrorEntry({
        id: 'err-1',
        message: 'Same error',
        category: 'runtime',
        stack: 'stack trace',
        timestamp: now - 1000,
        count: 1
      });
      await saveError(error1);

      const error2 = createErrorEntry({
        id: 'err-2',
        message: 'Same error',
        category: 'runtime',
        stack: 'stack trace',
        timestamp: now,
        count: 1
      });
      await saveError(error2);

      const stored = mockStorage[ERROR_STORAGE_KEY] as ErrorEntry[];
      expect(stored).toHaveLength(1);
      expect(stored[0].count).toBe(2);
      expect(stored[0].timestamp).toBe(now);
    });

    it('should not aggregate errors older than 30 minutes', async () => {
      const now = Date.now();
      const error1 = createErrorEntry({
        id: 'err-1',
        message: 'Same error',
        category: 'runtime',
        stack: 'stack trace',
        timestamp: now - 31 * 60 * 1000,
        count: 1
      });
      await saveError(error1);

      const error2 = createErrorEntry({
        id: 'err-2',
        message: 'Same error',
        category: 'runtime',
        stack: 'stack trace',
        timestamp: now,
        count: 1
      });
      await saveError(error2);

      const stored = mockStorage[ERROR_STORAGE_KEY] as ErrorEntry[];
      expect(stored).toHaveLength(2);
    });

    it('should respect maxEntries limit', async () => {
      mockStorage[ERROR_CONFIG_KEY] = { maxEntries: 3 };

      for (let i = 0; i < 5; i++) {
        await saveError(createErrorEntry({ id: `err-${i}` }));
      }

      const stored = mockStorage[ERROR_STORAGE_KEY] as ErrorEntry[];
      expect(stored.length).toBeLessThanOrEqual(3);
    });
  });

  describe('saveErrors', () => {
    it('should save multiple errors at once', async () => {
      const errors = [
        createErrorEntry({ id: '1' }),
        createErrorEntry({ id: '2' }),
        createErrorEntry({ id: '3' })
      ];
      await saveErrors(errors);

      const stored = mockStorage[ERROR_STORAGE_KEY] as ErrorEntry[];
      expect(stored).toHaveLength(3);
    });

    it('should respect maxEntries limit for batch saves', async () => {
      mockStorage[ERROR_CONFIG_KEY] = { maxEntries: 2 };
      const errors = [
        createErrorEntry({ id: '1' }),
        createErrorEntry({ id: '2' }),
        createErrorEntry({ id: '3' })
      ];
      await saveErrors(errors);

      const stored = mockStorage[ERROR_STORAGE_KEY] as ErrorEntry[];
      expect(stored.length).toBeLessThanOrEqual(2);
    });
  });

  describe('deleteError', () => {
    it('should delete a single error by ID', async () => {
      mockStorage[ERROR_STORAGE_KEY] = [
        createErrorEntry({ id: '1' }),
        createErrorEntry({ id: '2' }),
        createErrorEntry({ id: '3' })
      ];

      await deleteError('2');

      const stored = mockStorage[ERROR_STORAGE_KEY] as ErrorEntry[];
      expect(stored).toHaveLength(2);
      expect(stored.find(e => e.id === '2')).toBeUndefined();
    });
  });

  describe('deleteErrors', () => {
    it('should delete multiple errors by IDs', async () => {
      mockStorage[ERROR_STORAGE_KEY] = [
        createErrorEntry({ id: '1' }),
        createErrorEntry({ id: '2' }),
        createErrorEntry({ id: '3' }),
        createErrorEntry({ id: '4' })
      ];

      await deleteErrors(['1', '3']);

      const stored = mockStorage[ERROR_STORAGE_KEY] as ErrorEntry[];
      expect(stored).toHaveLength(2);
      expect(stored.every(e => e.id === '2' || e.id === '4')).toBe(true);
    });
  });

  describe('getUnreportedErrors', () => {
    it('should return only unreported errors', async () => {
      mockStorage[ERROR_STORAGE_KEY] = [
        createErrorEntry({ id: '1', reported: false }),
        createErrorEntry({ id: '2', reported: true }),
        createErrorEntry({ id: '3', reported: false })
      ];

      const result = await getUnreportedErrors();
      expect(result).toHaveLength(2);
      expect(result.every(e => !e.reported)).toBe(true);
    });

    it('should return empty array when all reported', async () => {
      mockStorage[ERROR_STORAGE_KEY] = [
        createErrorEntry({ reported: true }),
        createErrorEntry({ reported: true })
      ];

      const result = await getUnreportedErrors();
      expect(result).toEqual([]);
    });
  });

  describe('markErrorsAsReported', () => {
    it('should mark specified errors as reported with timestamp', async () => {
      const now = Date.now();
      mockStorage[ERROR_STORAGE_KEY] = [
        createErrorEntry({ id: '1', reported: false }),
        createErrorEntry({ id: '2', reported: false }),
        createErrorEntry({ id: '3', reported: false })
      ];

      await markErrorsAsReported(['1', '2']);

      const stored = mockStorage[ERROR_STORAGE_KEY] as ErrorEntry[];
      const err1 = stored.find(e => e.id === '1')!;
      const err2 = stored.find(e => e.id === '2')!;
      const err3 = stored.find(e => e.id === '3')!;

      expect(err1.reported).toBe(true);
      expect(err1.reportedAt).toBeGreaterThanOrEqual(now);
      expect(err2.reported).toBe(true);
      expect(err3.reported).toBe(false);
    });
  });

  describe('clearAllErrors', () => {
    it('should remove all errors from storage', async () => {
      mockStorage[ERROR_STORAGE_KEY] = [
        createErrorEntry({ id: '1' }),
        createErrorEntry({ id: '2' })
      ];

      await clearAllErrors();

      expect(mockStorage[ERROR_STORAGE_KEY]).toBeUndefined();
    });
  });

  describe('getErrorStats', () => {
    it('should return zero stats when no errors', async () => {
      const stats = await getErrorStats();
      expect(stats.totalErrors).toBe(0);
      expect(stats.unreportedErrors).toBe(0);
      expect(stats.last24Hours).toBe(0);
      expect(stats.topErrors).toEqual([]);
    });

    it('should aggregate by category and severity', async () => {
      const now = Date.now();
      mockStorage[ERROR_STORAGE_KEY] = [
        createErrorEntry({ category: 'runtime', severity: 'error', count: 3, timestamp: now }),
        createErrorEntry({ category: 'runtime', severity: 'warning', count: 2, timestamp: now }),
        createErrorEntry({ category: 'network', severity: 'fatal', count: 1, timestamp: now })
      ];

      const stats = await getErrorStats();
      expect(stats.totalErrors).toBe(6);
      expect(stats.byCategory.runtime).toBe(5);
      expect(stats.byCategory.network).toBe(1);
      expect(stats.bySeverity.error).toBe(3);
      expect(stats.bySeverity.warning).toBe(2);
      expect(stats.bySeverity.fatal).toBe(1);
    });

    it('should calculate last 24 hours errors', async () => {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      mockStorage[ERROR_STORAGE_KEY] = [
        createErrorEntry({ count: 5, timestamp: now - 1000 }),
        createErrorEntry({ count: 3, timestamp: now - oneDay + 1000 }),
        createErrorEntry({ count: 2, timestamp: now - oneDay - 1000 })
      ];

      const stats = await getErrorStats();
      expect(stats.last24Hours).toBe(8);
    });

    it('should calculate last 7 days errors', async () => {
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      mockStorage[ERROR_STORAGE_KEY] = [
        createErrorEntry({ count: 5, timestamp: now - 1000 }),
        createErrorEntry({ count: 3, timestamp: now - sevenDays + 1000 }),
        createErrorEntry({ count: 2, timestamp: now - sevenDays - 1000 })
      ];

      const stats = await getErrorStats();
      expect(stats.last7Days).toBe(8);
    });

    it('should return top 5 most frequent errors', async () => {
      const now = Date.now();
      mockStorage[ERROR_STORAGE_KEY] = [
        createErrorEntry({ message: 'Error A', category: 'runtime', count: 10, timestamp: now }),
        createErrorEntry({ message: 'Error B', category: 'network', count: 8, timestamp: now }),
        createErrorEntry({ message: 'Error C', category: 'runtime', count: 6, timestamp: now }),
        createErrorEntry({ message: 'Error D', category: 'api', count: 4, timestamp: now }),
        createErrorEntry({ message: 'Error E', category: 'ui', count: 2, timestamp: now }),
        createErrorEntry({ message: 'Error F', category: 'storage', count: 1, timestamp: now })
      ];

      const stats = await getErrorStats();
      expect(stats.topErrors).toHaveLength(5);
      expect(stats.topErrors[0].message).toBe('Error A');
      expect(stats.topErrors[0].count).toBe(10);
      expect(stats.topErrors[4].message).toBe('Error E');
    });

    it('should aggregate unreported errors by count', async () => {
      const now = Date.now();
      mockStorage[ERROR_STORAGE_KEY] = [
        createErrorEntry({ reported: false, count: 5, timestamp: now }),
        createErrorEntry({ reported: true, count: 3, timestamp: now }),
        createErrorEntry({ reported: false, count: 2, timestamp: now })
      ];

      const stats = await getErrorStats();
      expect(stats.unreportedErrors).toBe(7);
    });
  });
});
