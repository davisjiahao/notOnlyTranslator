/**
 * 错误追踪器测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ErrorTracker,
  captureError,
  initErrorTracking,
  withErrorTracking
} from '@/shared/error-tracking/tracker';
import { ERROR_AGGREGATION_CONFIG, EXTENSION_VERSION } from '@/shared/error-tracking/constants';

// Mock storage module
vi.mock('@/shared/error-tracking/storage', () => ({
  saveError: vi.fn(async () => {}),
  getErrorStats: vi.fn(async () => ({
    totalErrors: 0,
    unreportedErrors: 0,
    byCategory: { runtime: 0, network: 0, storage: 0, translation: 0, api: 0, ui: 0, unknown: 0 },
    bySeverity: { fatal: 0, error: 0, warning: 0 },
    last24Hours: 0,
    last7Days: 0,
    topErrors: []
  })),
  getUnreportedErrors: vi.fn(async () => []),
  markErrorsAsReported: vi.fn(async () => {}),
  clearAllErrors: vi.fn(async () => {})
}));

import { saveError, getUnreportedErrors, clearAllErrors } from '@/shared/error-tracking/storage';

// Mock window/navigator globals
const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

function mockWindowAndNavigator() {
  const mockLocation = {
    href: 'https://example.com/test',
    pathname: '/test',
    origin: 'https://example.com'
  };
  const mockNavigator = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    language: 'en-US',
    platform: 'MacIntel'
  };

  Object.defineProperty(globalThis, 'window', {
    value: {
      location: mockLocation,
      onerror: null,
      onunhandledrejection: null
    },
    configurable: true,
    writable: true
  });

  Object.defineProperty(globalThis, 'navigator', {
    value: mockNavigator,
    configurable: true,
    writable: true
  });
}

function restoreWindowAndNavigator() {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true, writable: true });
  }
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true, writable: true });
  }
}

describe('错误追踪器', () => {
  beforeEach(() => {
    mockWindowAndNavigator();
    // Reset static state
    (ErrorTracker as any).isInitialized = false;
    (ErrorTracker as any).originalErrorHandler = undefined;
    (ErrorTracker as any).originalRejectionHandler = null;
    vi.clearAllMocks();
  });

  afterAll(() => {
    restoreWindowAndNavigator();
  });

  describe('ErrorTracker.capture', () => {
    it('should create error entry with auto-categorized runtime error', () => {
      const error = new Error('Something went wrong');
      const entry = ErrorTracker.capture(error);

      expect(entry.message).toBe('Something went wrong');
      expect(entry.category).toBe('runtime');
      expect(entry.severity).toBe('error');
      expect(entry.count).toBe(1);
      expect(entry.reported).toBe(false);
    });

    it('should auto-categorize network errors', () => {
      const error = new Error('Network request failed: fetch timeout');
      const entry = ErrorTracker.capture(error);
      expect(entry.category).toBe('network');
    });

    it('should auto-categorize storage errors', () => {
      const error = new Error('Storage quota exceeded');
      const entry = ErrorTracker.capture(error);
      expect(entry.category).toBe('storage');
    });

    it('should auto-categorize translation errors', () => {
      const error = new Error('翻译服务不可用');
      const entry = ErrorTracker.capture(error);
      expect(entry.category).toBe('translation');
    });

    it('should auto-categorize API errors', () => {
      const error = new Error('API returned 500');
      const entry = ErrorTracker.capture(error);
      expect(entry.category).toBe('api');
    });

    it('should determine fatal severity', () => {
      const outOfMemory = new Error('out of memory');
      expect(ErrorTracker.capture(outOfMemory).severity).toBe('fatal');

      const stackOverflow = new Error('stack overflow');
      expect(ErrorTracker.capture(stackOverflow).severity).toBe('fatal');

      const fatal = new Error('fatal system error');
      expect(ErrorTracker.capture(fatal).severity).toBe('fatal');
    });

    it('should determine warning severity', () => {
      const warning = new Error('This is a warning');
      expect(ErrorTracker.capture(warning).severity).toBe('warning');

      const deprecated = new Error('deprecated method used');
      expect(ErrorTracker.capture(deprecated).severity).toBe('warning');

      const timeout = new Error('Request timeout');
      expect(ErrorTracker.capture(timeout).severity).toBe('warning');
    });

    it('should include browser info', () => {
      const error = new Error('Test');
      const entry = ErrorTracker.capture(error);

      expect(entry.browserInfo).toBeDefined();
      expect(entry.browserInfo!.userAgent).toContain('Macintosh');
      expect(entry.browserInfo!.language).toBe('en-US');
      expect(entry.browserInfo!.extensionVersion).toBe(EXTENSION_VERSION);
    });

    it('should include context info', () => {
      const error = new Error('Test error');
      const entry = ErrorTracker.capture(error, {
        component: 'MyComponent',
        action: 'onClick',
        userActions: ['login', 'navigate', 'click'],
        metadata: { userId: '123' }
      });

      expect(entry.context!.component).toBe('MyComponent');
      expect(entry.context!.action).toBe('onClick');
      expect(entry.context!.userActions).toEqual(['login', 'navigate', 'click']);
      expect(entry.context!.metadata).toEqual({ userId: '123' });
    });

    it('should truncate long messages', () => {
      const longMessage = 'x'.repeat(1000);
      const error = new Error(longMessage);
      const entry = ErrorTracker.capture(error);

      expect(entry.message.length).toBeLessThanOrEqual(ERROR_AGGREGATION_CONFIG.maxMessageLength + 3);
      expect(entry.message.endsWith('...')).toBe(true);
    });

    it('should truncate long stacks', () => {
      const longStack = Array(100).fill('    at someFunction (file.js:1:1)').join('\n');
      const error = new Error('Test');
      error.stack = longStack;

      const entry = ErrorTracker.capture(error);
      expect(entry.stack).toBeDefined();
      const lines = entry.stack!.split('\n');
      expect(lines.length).toBeLessThanOrEqual(ERROR_AGGREGATION_CONFIG.maxStackDepth);
    });

    it('should handle undefined stack', () => {
      const error = new Error('No stack');
      delete (error as any).stack;
      const entry = ErrorTracker.capture(error);
      expect(entry.stack).toBeUndefined();
    });

    it('should call saveError asynchronously', () => {
      const error = new Error('Test');
      ErrorTracker.capture(error);

      expect(saveError).toHaveBeenCalled();
    });

    it('should generate unique ID', () => {
      const error1 = new Error('Test 1');
      const error2 = new Error('Test 2');
      const entry1 = ErrorTracker.capture(error1);
      const entry2 = ErrorTracker.capture(error2);

      expect(entry1.id).not.toBe(entry2.id);
    });
  });

  describe('ErrorTracker.captureApiError', () => {
    it('should capture with api category and error severity', () => {
      const error = new Error('API 500');
      const entry = ErrorTracker.captureApiError(error, 'getUser', { page: 1 });

      expect(entry.category).toBe('api');
      expect(entry.severity).toBe('error');
      expect(entry.context!.component).toBe('getUser');
      expect(entry.context!.action).toBe('API_CALL');
      expect(entry.context!.metadata).toEqual({ requestData: { page: 1 } });
    });
  });

  describe('ErrorTracker.captureNetworkError', () => {
    it('should capture with network category and warning severity', () => {
      const error = new Error('Connection refused');
      const entry = ErrorTracker.captureNetworkError(error, 'https://api.example.com/data', 'GET');

      expect(entry.category).toBe('network');
      expect(entry.severity).toBe('warning');
      expect(entry.context!.component).toBe('Network');
      expect(entry.context!.metadata).toEqual({
        url: 'https://api.example.com/data',
        method: 'GET'
      });
    });
  });

  describe('ErrorTracker.captureStorageError', () => {
    it('should capture with storage category and error severity', () => {
      const error = new Error('QuotaExceededError');
      const entry = ErrorTracker.captureStorageError(error, 'setItem');

      expect(entry.category).toBe('storage');
      expect(entry.severity).toBe('error');
      expect(entry.context!.component).toBe('Storage');
      expect(entry.context!.action).toBe('setItem');
    });
  });

  describe('ErrorTracker.captureTranslationError', () => {
    it('should capture with translation category', () => {
      const error = new Error('Translation failed');
      const entry = ErrorTracker.captureTranslationError(error, 'openai', 'Hello world');

      expect(entry.category).toBe('translation');
      expect(entry.severity).toBe('error');
      expect(entry.context!.component).toBe('Translation:openai');
      expect(entry.context!.metadata).toEqual({ provider: 'openai', textLength: 11 });
    });
  });

  describe('ErrorTracker.captureUiError', () => {
    it('should capture with ui category and warning severity', () => {
      const error = new Error('Render failed');
      const entry = ErrorTracker.captureUiError(error, 'Tooltip', 'hover');

      expect(entry.category).toBe('ui');
      expect(entry.severity).toBe('warning');
      expect(entry.context!.component).toBe('Tooltip');
      expect(entry.context!.action).toBe('hover');
    });
  });

  describe('ErrorTracker.report', () => {
    it('should return empty result when no unreported errors', async () => {
      const result = await ErrorTracker.report();
      expect(result.success).toBe(true);
      expect(result.reportedCount).toBe(0);
    });

    it('should report unreported errors', async () => {
      vi.mocked(getUnreportedErrors).mockResolvedValueOnce([
        { id: 'err-1', message: 'Error 1', category: 'runtime', severity: 'error', timestamp: Date.now(), reported: false, count: 1, firstOccurredAt: Date.now() },
        { id: 'err-2', message: 'Error 2', category: 'runtime', severity: 'error', timestamp: Date.now(), reported: false, count: 1, firstOccurredAt: Date.now() }
      ]);

      const result = await ErrorTracker.report();
      expect(result.success).toBe(true);
      expect(result.reportedCount).toBe(2);
      expect(result.failedCount).toBe(0);
    });
  });

  describe('ErrorTracker.getStats', () => {
    it('should return stats from storage', async () => {
      const stats = await ErrorTracker.getStats();
      expect(stats).toHaveProperty('totalErrors');
      expect(stats).toHaveProperty('byCategory');
      expect(stats).toHaveProperty('bySeverity');
    });
  });

  describe('ErrorTracker.clear', () => {
    it('should call clearAllErrors', async () => {
      await ErrorTracker.clear();
      expect(clearAllErrors).toHaveBeenCalled();
    });
  });

  describe('ErrorTracker.init', () => {
    it('should set global handlers', () => {
      ErrorTracker.init();
      expect(window.onerror).not.toBeNull();
      expect(window.onunhandledrejection).not.toBeNull();
      expect((ErrorTracker as any).isInitialized).toBe(true);
    });

    it('should be idempotent', () => {
      const originalHandler = vi.fn();
      window.onerror = originalHandler;

      ErrorTracker.init();
      const firstHandler = window.onerror;

      ErrorTracker.init();
      expect(window.onerror).toBe(firstHandler);
    });
  });

  describe('ErrorTracker.destroy', () => {
    it('should restore original handlers', () => {
      const originalOnError = vi.fn();
      const originalOnRejection = vi.fn();
      window.onerror = originalOnError;
      window.onunhandledrejection = originalOnRejection;

      ErrorTracker.init();
      expect(window.onerror).not.toBe(originalOnError);

      ErrorTracker.destroy();
      expect(window.onerror).toBe(originalOnError);
      expect(window.onunhandledrejection).toBe(originalOnRejection);
    });

    it('should reset initialized flag', () => {
      ErrorTracker.init();
      expect((ErrorTracker as any).isInitialized).toBe(true);

      ErrorTracker.destroy();
      expect((ErrorTracker as any).isInitialized).toBe(false);
    });
  });

  describe('captureError', () => {
    it('should delegate to ErrorTracker.capture', () => {
      const error = new Error('Test');
      const entry = captureError(error, { component: 'Test' });

      expect(entry.message).toBe('Test');
      expect(entry.context!.component).toBe('Test');
    });
  });

  describe('withErrorTracking', () => {
    it('should return result for successful sync function', () => {
      const fn = () => 42;
      const wrapped = withErrorTracking(fn);
      expect(wrapped()).toBe(42);
    });

    it('should capture error for failing sync function', () => {
      const fn = () => { throw new Error('Sync error'); };
      const wrapped = withErrorTracking(fn);

      expect(() => wrapped()).toThrow('Sync error');
      expect(saveError).toHaveBeenCalled();
    });

    it('should return result for successful async function', async () => {
      const fn = async () => 'ok';
      const wrapped = withErrorTracking(fn);
      const result = await wrapped();
      expect(result).toBe('ok');
    });

    it('should capture error for rejecting Promise', async () => {
      const fn = async () => { throw new Error('Async error'); };
      const wrapped = withErrorTracking(fn);

      await expect(wrapped()).rejects.toThrow('Async error');
      expect(saveError).toHaveBeenCalled();
    });

    it('should pass arguments through', () => {
      const fn = (a: number, b: number) => a + b;
      const wrapped = withErrorTracking(fn);
      expect(wrapped(3, 4)).toBe(7);
    });

    it('should include context in captured errors', () => {
      const fn = () => { throw new Error('Context error'); };
      const wrapped = withErrorTracking(fn, { component: 'MyModule' });

      expect(() => wrapped()).toThrow('Context error');
      expect(saveError).toHaveBeenCalled();
    });

    it('should handle non-Error throws', () => {
      const fn = () => { throw 'string error'; };
      const wrapped = withErrorTracking(fn);

      expect(() => wrapped()).toThrow();
      expect(saveError).toHaveBeenCalled();
    });

    it('should handle non-Error Promise rejections', async () => {
      const fn = async () => { throw 'promise string error'; };
      const wrapped = withErrorTracking(fn);

      await expect(wrapped()).rejects.toBe('promise string error');
      expect(saveError).toHaveBeenCalled();
    });
  });
});
