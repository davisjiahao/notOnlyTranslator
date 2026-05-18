import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateId,
  getOrCreateSessionId,
  getOrCreateDeviceId,
  deepClone,
  getNestedValue,
  debounce,
  throttle,
} from '@/shared/analytics/utils';

describe('analytics/utils', () => {
  describe('generateId', () => {
    it('returns a string', () => {
      expect(typeof generateId()).toBe('string');
    });

    it('generates unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(100);
    });

    it('includes a timestamp component (base36)', () => {
      const id = generateId();
      expect(id).toContain('-');
    });
  });

  describe('getOrCreateSessionId', () => {
    beforeEach(() => {
      sessionStorage.removeItem('analytics_session_id');
    });

    it('creates a new session ID when none exists', () => {
      const id = getOrCreateSessionId();
      expect(id).toBeTruthy();
      expect(sessionStorage.getItem('analytics_session_id')).toBe(id);
    });

    it('reuses existing session ID', () => {
      sessionStorage.setItem('analytics_session_id', 'existing-session-id');
      const id = getOrCreateSessionId();
      expect(id).toBe('existing-session-id');
    });
  });

  describe('getOrCreateDeviceId', () => {
    it('creates a device ID with device- prefix', () => {
      // Note: localStorage is not available in jsdom, so getOrCreateDeviceId
      // falls back to returning a temporary device-{id} string
      const id = getOrCreateDeviceId();
      expect(id).toBeTruthy();
      expect(id.startsWith('device-')).toBe(true);
    });
  });

  describe('deepClone', () => {
    it('clones primitives', () => {
      expect(deepClone(null)).toBeNull();
      expect(deepClone(undefined)).toBeUndefined();
      expect(deepClone(42)).toBe(42);
      expect(deepClone('hello')).toBe('hello');
    });

    it('clones arrays', () => {
      const arr = [1, 2, { a: 3 }];
      const cloned = deepClone(arr);
      expect(cloned).toEqual(arr);
      expect(cloned).not.toBe(arr);
      expect(cloned[2]).not.toBe(arr[2]);
    });

    it('clones nested objects', () => {
      const obj = { a: { b: { c: 42 } } };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
      expect(cloned.a).not.toBe(obj.a);
      expect(cloned.a.b).not.toBe(obj.a.b);
    });

    it('clones Date objects', () => {
      const date = new Date('2026-05-28');
      const cloned = deepClone(date);
      expect(cloned).toEqual(date);
      expect(cloned).not.toBe(date);
      expect(cloned instanceof Date).toBe(true);
    });

    it('clones RegExp objects', () => {
      const regex = /test/gi;
      const cloned = deepClone(regex);
      expect(cloned).toEqual(regex);
      expect(cloned).not.toBe(regex);
      expect(cloned instanceof RegExp).toBe(true);
    });

    it('clones arrays with mixed types', () => {
      const arr = [1, 'hello', null, new Date(), { key: 'value' }];
      const cloned = deepClone(arr);
      expect(cloned).toEqual(arr);
      expect(cloned[3] instanceof Date).toBe(true);
    });
  });

  describe('getNestedValue', () => {
    it('returns nested value for valid path', () => {
      const obj = { user: { profile: { name: 'test' } } };
      expect(getNestedValue(obj, 'user.profile.name')).toBe('test');
    });

    it('returns default value for missing path', () => {
      const obj = { user: { name: 'test' } };
      expect(getNestedValue(obj, 'user.profile.name', 'default')).toBe('default');
    });

    it('returns default value for null/undefined input', () => {
      expect(getNestedValue(null, 'a.b.c', 'default')).toBe('default');
      expect(getNestedValue(undefined, 'a.b.c', 'default')).toBe('default');
    });

    it('returns default value when intermediate value is not an object', () => {
      const obj = { a: 42 };
      expect(getNestedValue(obj, 'a.b.c', 'default')).toBe('default');
    });

    it('returns undefined without default for missing path', () => {
      const obj = {};
      expect(getNestedValue(obj, 'missing.key')).toBeUndefined();
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('calls the function after the wait period', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('resets timer on subsequent calls within wait period', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      vi.advanceTimersByTime(50);
      debounced();
      vi.advanceTimersByTime(50);

      // Should not have called yet because second call reset the timer
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('passes arguments to the wrapped function', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 50);

      debounced('arg1', 'arg2');
      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });

  describe('throttle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('calls the function immediately on first invocation', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('ignores calls within the throttle period', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      throttled();
      throttled();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('allows calls after the throttle period', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      vi.advanceTimersByTime(100);
      throttled();

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('passes arguments to the wrapped function', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 50);

      throttled('arg1', 'arg2');
      vi.advanceTimersByTime(50);
      throttled('arg3', 'arg4');

      expect(fn).toHaveBeenNthCalledWith(1, 'arg1', 'arg2');
      expect(fn).toHaveBeenNthCalledWith(2, 'arg3', 'arg4');
    });
  });
});
