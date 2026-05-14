/**
 * PendingRequestQueue 测试
 *
 * 覆盖 initialize, add, complete, fail, cleanupExpired, getAll, size, triggerResolve/Reject
 * Mock chrome.storage.local 用于测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PendingRequestQueue, type PendingRequestEntry } from '@/background/pendingRequestQueue';

/**
 * Create a mock for chrome.storage.local
 */
function createMockChromeStorage() {
  const store: Record<string, unknown> = {};

  return {
    chrome: {
      storage: {
        local: {
          get: (keys: string | string[] | null) => {
            if (typeof keys === 'string') {
              return Promise.resolve({ [keys]: store[keys] });
            }
            if (Array.isArray(keys)) {
              const result: Record<string, unknown> = {};
              for (const key of keys) {
                result[key] = store[key];
              }
              return Promise.resolve(result);
            }
            return Promise.resolve({ ...store });
          },
          set: (data: Record<string, unknown>) => {
            Object.assign(store, data);
            return Promise.resolve();
          },
        },
      },
    },
    store,
    clear() {
      Object.keys(store).forEach(k => delete store[k]);
    },
  };
}

function makeEntry(overrides: Partial<PendingRequestEntry> = {}): PendingRequestEntry {
  return {
    id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    text: 'Hello world',
    mode: 'inline',
    createdAt: Date.now(),
    retries: 0,
    ...overrides,
  };
}

describe('PendingRequestQueue — add/complete', () => {
  it('adds and completes a request', async () => {
    const mock = createMockChromeStorage();
    const savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;

    try {
      const queue = new PendingRequestQueue();
      const entry = makeEntry();

      await queue.add(entry);
      expect(await queue.size()).toBe(1);

      await queue.complete(entry.id);
      expect(await queue.size()).toBe(0);
    } finally {
      (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    }
  });

  it('getAll returns all pending requests', async () => {
    const mock = createMockChromeStorage();
    const savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;

    try {
      const queue = new PendingRequestQueue();
      const entry1 = makeEntry({ id: 'req-1' });
      const entry2 = makeEntry({ id: 'req-2' });

      await queue.add(entry1);
      await queue.add(entry2);

      const all = await queue.getAll();
      expect(all).toHaveLength(2);
      expect(all.map(e => e.id).sort()).toEqual(['req-1', 'req-2']);
    } finally {
      (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    }
  });
});

describe('PendingRequestQueue — fail/retry', () => {
  it('returns true for retry when under maxRetries', async () => {
    const mock = createMockChromeStorage();
    const savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;

    try {
      const queue = new PendingRequestQueue();
      const entry = makeEntry({ retries: 0 });

      await queue.add(entry);

      const shouldRetry = await queue.fail(entry.id, 2);
      expect(shouldRetry).toBe(true);

      // Retry count incremented
      const all = await queue.getAll();
      expect(all[0].retries).toBe(1);
    } finally {
      (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    }
  });

  it('returns false and removes entry when maxRetries exceeded', async () => {
    const mock = createMockChromeStorage();
    const savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;

    try {
      const queue = new PendingRequestQueue();
      const entry = makeEntry({ retries: 2 });

      await queue.add(entry);

      const shouldRetry = await queue.fail(entry.id, 2);
      expect(shouldRetry).toBe(false);
      expect(await queue.size()).toBe(0);
    } finally {
      (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    }
  });

  it('returns false for non-existent entry', async () => {
    const mock = createMockChromeStorage();
    const savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;

    try {
      const queue = new PendingRequestQueue();
      const shouldRetry = await queue.fail('non-existent', 2);
      expect(shouldRetry).toBe(false);
    } finally {
      (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    }
  });
});

describe('PendingRequestQueue — cleanupExpired', () => {
  it('removes entries older than 5 minutes', async () => {
    const mock = createMockChromeStorage();
    const savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;

    try {
      const queue = new PendingRequestQueue();
      const now = Date.now();
      const fiveMinutesAgo = now - 6 * 60 * 1000;
      const oneMinuteAgo = now - 60 * 1000;

      const oldEntry = makeEntry({ id: 'old', createdAt: fiveMinutesAgo });
      const newEntry = makeEntry({ id: 'new', createdAt: oneMinuteAgo });

      await queue.add(oldEntry);
      await queue.add(newEntry);

      const cleaned = await queue.cleanupExpired();
      expect(cleaned).toBe(1);
      expect(await queue.size()).toBe(1);

      const remaining = await queue.getAll();
      expect(remaining[0].id).toBe('new');
    } finally {
      (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    }
  });
});

describe('PendingRequestQueue — triggerResolve/triggerReject', () => {
  it('calls registered resolve callback', async () => {
    const mock = createMockChromeStorage();
    const savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;

    try {
      const queue = new PendingRequestQueue();
      const entry = makeEntry();

      let resolvedEntry: PendingRequestEntry | null = null;
      let resolvedResult: unknown = null;

      queue.onResolve(entry.id, (e, result) => {
        resolvedEntry = e;
        resolvedResult = result;
      });

      queue.triggerResolve(entry, 'test result');

      expect(resolvedEntry).toBe(entry);
      expect(resolvedResult).toBe('test result');
    } finally {
      (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    }
  });

  it('calls registered reject callback', async () => {
    const mock = createMockChromeStorage();
    const savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;

    try {
      const queue = new PendingRequestQueue();
      const entry = makeEntry();

      let rejectedEntry: PendingRequestEntry | null = null;
      let rejectedError: Error | null = null;

      queue.onReject(entry.id, (e, error) => {
        rejectedEntry = e;
        rejectedError = error;
      });

      const error = new Error('API failed');
      queue.triggerReject(entry, error);

      expect(rejectedEntry).toBe(entry);
      expect(rejectedError).toBe(error);
    } finally {
      (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    }
  });
});
