/**
 * 翻译错误分类与处理模块测试
 *
 * 覆盖 classifyTranslationError, TranslationError, isOffline,
 * withErrorHandling, ERROR_ACTIONS 等 API
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import {
  classifyTranslationError,
  TranslationError,
  TranslationErrorType,
  isOffline,
  withErrorHandling,
  ERROR_ACTIONS,
} from '@/shared/utils/translationErrors';

describe('classifyTranslationError', () => {
  it('classifies API key errors (401, 403, authentication)', () => {
    expect(classifyTranslationError(new Error('401 Unauthorized'))).toMatchObject({
      type: TranslationErrorType.INVALID_API_KEY,
      retryable: false,
      action: 'open_settings',
    });
    expect(classifyTranslationError(new Error('invalid API key'))).toMatchObject({
      type: TranslationErrorType.INVALID_API_KEY,
      retryable: false,
    });
    expect(classifyTranslationError(new Error('Authentication failed'))).toMatchObject({
      type: TranslationErrorType.INVALID_API_KEY,
      retryable: false,
    });
  });

  it('classifies network errors', () => {
    expect(classifyTranslationError(new Error('Failed to fetch'))).toMatchObject({
      type: TranslationErrorType.NETWORK_ERROR,
      retryable: true,
      action: 'retry',
    });
    expect(classifyTranslationError(new Error('ECONNREFUSED'))).toMatchObject({
      type: TranslationErrorType.NETWORK_ERROR,
      retryable: true,
    });
    expect(classifyTranslationError(new Error('ENOTFOUND'))).toMatchObject({
      type: TranslationErrorType.NETWORK_ERROR,
      retryable: true,
    });
  });

  it('classifies rate limit errors (429)', () => {
    expect(classifyTranslationError(new Error('429 Too Many Requests'))).toMatchObject({
      type: TranslationErrorType.RATE_LIMIT,
      retryable: true,
      retryDelay: 60000,
      action: 'wait',
    });
    expect(classifyTranslationError(new Error('rate_limit exceeded'))).toMatchObject({
      type: TranslationErrorType.RATE_LIMIT,
      retryable: true,
    });
  });

  it('classifies quota exhausted errors', () => {
    expect(classifyTranslationError(new Error('Quota exceeded'))).toMatchObject({
      type: TranslationErrorType.QUOTA_EXHAUSTED,
      retryable: false,
      action: 'check_billing',
    });
    expect(classifyTranslationError(new Error('402 Payment Required'))).toMatchObject({
      type: TranslationErrorType.QUOTA_EXHAUSTED,
      retryable: false,
    });
  });

  it('classifies timeout errors', () => {
    expect(classifyTranslationError(new Error('Request timeout'))).toMatchObject({
      type: TranslationErrorType.TIMEOUT,
      retryable: true,
      retryDelay: 5000,
    });
    expect(classifyTranslationError(new Error('ETIMEDOUT'))).toMatchObject({
      type: TranslationErrorType.TIMEOUT,
      retryable: true,
    });
    expect(classifyTranslationError(new Error('timed out'))).toMatchObject({
      type: TranslationErrorType.TIMEOUT,
      retryable: true,
    });
  });

  it('classifies invalid response errors', () => {
    expect(classifyTranslationError(new Error('Unexpected token in JSON'))).toMatchObject({
      type: TranslationErrorType.INVALID_RESPONSE,
      retryable: true,
      action: 'retry',
    });
    expect(classifyTranslationError(new Error('Parse error'))).toMatchObject({
      type: TranslationErrorType.INVALID_RESPONSE,
      retryable: true,
    });
  });

  it('classifies content filtered errors', () => {
    expect(classifyTranslationError(new Error('content_filter triggered'))).toMatchObject({
      type: TranslationErrorType.CONTENT_FILTERED,
      retryable: false,
      action: 'change_content',
    });
    expect(classifyTranslationError(new Error('safety policy violation'))).toMatchObject({
      type: TranslationErrorType.CONTENT_FILTERED,
      retryable: false,
    });
  });

  it('classifies model unavailable errors (404)', () => {
    expect(classifyTranslationError(new Error('Model not found'))).toMatchObject({
      type: TranslationErrorType.MODEL_UNAVAILABLE,
      retryable: false,
      action: 'switch_model',
    });
    expect(classifyTranslationError(new Error('404 Not Found'))).toMatchObject({
      type: TranslationErrorType.MODEL_UNAVAILABLE,
      retryable: false,
    });
  });

  it('classifies unknown errors as retryable fallback', () => {
    const result = classifyTranslationError(new Error('some random weird error xyz'));
    expect(result.type).toBe(TranslationErrorType.UNKNOWN);
    expect(result.retryable).toBe(true);
    expect(result.retryDelay).toBe(3000);
    expect(result.action).toBe('retry');
  });

  it('handles string errors', () => {
    const result = classifyTranslationError('Failed to fetch');
    expect(result.type).toBe(TranslationErrorType.NETWORK_ERROR);
    expect(result.retryable).toBe(true);
  });

  it('handles non-Error objects', () => {
    const result = classifyTranslationError(null);
    expect(result.type).toBe(TranslationErrorType.UNKNOWN);
    expect(result.retryable).toBe(true);
  });

  it('includes technicalDetails in error info', () => {
    const result = classifyTranslationError(new Error('specific error detail'));
    expect(result.technicalDetails).toBe('specific error detail');
  });
});

describe('TranslationError', () => {
  it('wraps TranslationErrorInfo', () => {
    const info = {
      type: TranslationErrorType.NETWORK_ERROR,
      title: '网络连接失败',
      message: '无法连接到翻译服务',
      retryable: true,
    };
    const err = new TranslationError(info);
    expect(err.name).toBe('TranslationError');
    expect(err.message).toBe('无法连接到翻译服务');
    expect(err.info).toBe(info);
  });
});

describe('isOffline', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it('returns true when navigator.onLine is false', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      writable: true,
      configurable: true,
    });
    expect(isOffline()).toBe(true);
  });

  it('returns false when navigator.onLine is true', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      writable: true,
      configurable: true,
    });
    expect(isOffline()).toBe(false);
  });

  it('returns false when navigator is undefined (Node.js)', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(isOffline()).toBe(false);
  });
});

describe('withErrorHandling', () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('returns result on success', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const wrapped = withErrorHandling(fn);
    const promise = wrapped();
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    const wrapped = withErrorHandling(fn, undefined, 2);

    // Capture rejection to prevent unhandled rejection warning
    let caught: unknown;
    const promise = wrapped().catch((e) => { caught = e; });
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    expect(caught).toBeInstanceOf(TranslationError);
    expect((caught as TranslationError).message).toContain('无法连接到翻译服务');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
    const wrapped = withErrorHandling(fn);
    await expect(wrapped()).rejects.toThrow(TranslationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onError callback', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
    const onError = vi.fn();
    const wrapped = withErrorHandling(fn, onError);
    try {
      await wrapped();
    } catch {
      // expected
    }
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TranslationErrorType.INVALID_API_KEY,
      })
    );
  });
});

describe('ERROR_ACTIONS', () => {
  it('has all expected action keys', () => {
    const expectedActions = [
      'open_settings',
      'retry',
      'check_connection',
      'check_billing',
      'switch_model',
      'change_content',
      'wait',
    ];
    for (const action of expectedActions) {
      expect(ERROR_ACTIONS[action]).toBeDefined();
      expect(ERROR_ACTIONS[action].label).toBeTruthy();
      expect(typeof ERROR_ACTIONS[action].handler).toBe('function');
    }
  });

  it('retry handler is a no-op (caller handles retry)', () => {
    expect(() => ERROR_ACTIONS.retry.handler()).not.toThrow();
  });

  it('wait handler is a no-op (caller handles delay)', () => {
    expect(() => ERROR_ACTIONS.wait.handler()).not.toThrow();
  });
});
