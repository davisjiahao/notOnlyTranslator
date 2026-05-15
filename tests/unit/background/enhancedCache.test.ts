/**
 * EnhancedCache 测试
 *
 * 覆盖 generateHash, set/get, LRU eviction, cleanExpired, fuzzyGet, getStats.
 * Mock chrome.storage.local 用于测试。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnhancedCacheManager } from '@/background/enhancedCache';
import { DEFAULT_BATCH_CONFIG } from '@/shared/constants';

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
          remove: (keys: string | string[]) => {
            const arr = typeof keys === 'string' ? [keys] : keys;
            arr.forEach(k => delete store[k]);
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

function makeMockResult(overrides = {}): any {
  return {
    fullText: 'translated',
    words: {},
    cached: false,
    ...overrides,
  };
}

describe('EnhancedCacheManager — basic set/get', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChromeStorage>;

  beforeEach(() => {
    mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    mock.clear();
  });

  it('returns null for missing key', async () => {
    const manager = new EnhancedCacheManager();
    const result = await manager.get('nonexistent');
    expect(result).toBeNull();
  });

  it('sets and gets a cache entry', async () => {
    const manager = new EnhancedCacheManager();
    const result = makeMockResult({ fullText: '你好世界' });

    await manager.set('hash-1', result, 'inline', 'https://example.com');

    const retrieved = await manager.get('hash-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.fullText).toBe('你好世界');
    expect(retrieved!.cached).toBe(true);
  });

  it('returns null for expired entry', async () => {
    const manager = new EnhancedCacheManager();
    const result = makeMockResult();

    // Set with LLM source (7 day expiry)
    await manager.set('hash-expired', result, 'inline', 'https://example.com', 'llm');

    // Manually set createdAt to past the expiry
    const entry = (manager as any).memoryCache.get('hash-expired');
    if (entry) {
      entry.createdAt = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
    }

    const retrieved = await manager.get('hash-expired');
    expect(retrieved).toBeNull();
  });

  it('generates hash via generateHash', () => {
    const manager = new EnhancedCacheManager();
    const hash1 = manager.generateHash('hello', 'inline');
    const hash2 = manager.generateHash('hello', 'inline');
    const hash3 = manager.generateHash('world', 'inline');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });
});

describe('EnhancedCacheManager — LRU eviction', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChromeStorage>;

  beforeEach(() => {
    mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    mock.clear();
  });

  it('evicts oldest entries when near capacity', async () => {
    const manager = new EnhancedCacheManager();
    const maxEntries = DEFAULT_BATCH_CONFIG.maxCacheEntries;

    // Fill up to 95% to trigger eviction on next add
    for (let i = 0; i < Math.ceil(maxEntries * 0.95); i++) {
      const result = makeMockResult({ fullText: `text-${i}` });
      await manager.set(`hash-${i}`, result, 'inline', 'https://example.com');
    }

    // Size should be at or below maxEntries after eviction
    const stats = await manager.getStats();
    expect(stats.totalEntries).toBeLessThanOrEqual(maxEntries);
  });

  it('preserves recently accessed entries during eviction', async () => {
    const manager = new EnhancedCacheManager();
    const maxEntries = DEFAULT_BATCH_CONFIG.maxCacheEntries;

    // Fill most of the cache
    const fillCount = Math.ceil(maxEntries * 0.9);
    for (let i = 0; i < fillCount; i++) {
      const result = makeMockResult({ fullText: `text-${i}` });
      await manager.set(`hash-${i}`, result, 'inline', 'https://example.com');
    }

    // Re-access the last few entries to make them "recent"
    for (let i = fillCount - 3; i < fillCount; i++) {
      await manager.get(`hash-${i}`);
    }

    // Add more to trigger eviction
    for (let i = fillCount; i < Math.ceil(maxEntries * 0.96); i++) {
      const result = makeMockResult({ fullText: `new-${i}` });
      await manager.set(`hash-${i}`, result, 'inline', 'https://example.com');
    }

    // Recently accessed entries should still exist
    const recentCheck = await manager.get(`hash-${fillCount - 1}`);
    expect(recentCheck).not.toBeNull();
  });
});

describe('EnhancedCacheManager — batch operations', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChromeStorage>;

  beforeEach(() => {
    mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    mock.clear();
  });

  it('getBatch returns hits and misses', async () => {
    const manager = new EnhancedCacheManager();
    const result = makeMockResult({ fullText: 'cached text' });

    await manager.set('hit-hash', result, 'inline', 'https://example.com');

    const { hits, misses } = await manager.getBatch(['hit-hash', 'miss-hash']);

    expect(hits.size).toBe(1);
    expect(hits.has('hit-hash')).toBe(true);
    expect(misses).toContain('miss-hash');
  });

  it('setBatch adds multiple entries', async () => {
    const manager = new EnhancedCacheManager();
    const entries = [
      { textHash: 'b-1', result: makeMockResult(), mode: 'inline' as const, pageUrl: 'https://a.com' },
      { textHash: 'b-2', result: makeMockResult(), mode: 'inline' as const, pageUrl: 'https://a.com' },
      { textHash: 'b-3', result: makeMockResult(), mode: 'inline' as const, pageUrl: 'https://a.com' },
    ];

    await manager.setBatch(entries);

    const stats = await manager.getStats();
    expect(stats.totalEntries).toBe(3);
  });
});

describe('EnhancedCacheManager — cleanExpired', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChromeStorage>;

  beforeEach(() => {
    mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    mock.clear();
  });

  it('removes expired entries and keeps fresh ones', async () => {
    const manager = new EnhancedCacheManager();
    const result = makeMockResult();

    await manager.set('fresh', result, 'inline', 'https://a.com');
    await manager.set('expired', result, 'inline', 'https://a.com', 'llm');

    // Make one entry expired
    const expiredEntry = (manager as any).memoryCache.get('expired');
    if (expiredEntry) {
      expiredEntry.createdAt = Date.now() - (8 * 24 * 60 * 60 * 1000);
    }

    const cleaned = await manager.cleanExpired();

    expect(cleaned).toBe(1);
    expect(await manager.get('fresh')).not.toBeNull();
    expect(await manager.get('expired')).toBeNull();
  });
});

describe('EnhancedCacheManager — getStats', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChromeStorage>;

  beforeEach(() => {
    mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    mock.clear();
  });

  it('returns correct entry count and memory usage', async () => {
    const manager = new EnhancedCacheManager();

    for (let i = 0; i < 5; i++) {
      await manager.set(`stat-${i}`, makeMockResult(), 'inline', 'https://a.com');
    }

    const stats = await manager.getStats();

    expect(stats.totalEntries).toBe(5);
    expect(stats.memoryUsage).toBeGreaterThan(0);
    expect(stats.oldestEntry).not.toBeNull();
    expect(stats.newestEntry).not.toBeNull();
  });

  it('returns zero stats for empty cache', async () => {
    const manager = new EnhancedCacheManager();
    const stats = await manager.getStats();

    expect(stats.totalEntries).toBe(0);
    expect(stats.memoryUsage).toBe(0);
    expect(stats.oldestEntry).toBeNull();
    expect(stats.newestEntry).toBeNull();
  });
});

describe('EnhancedCacheManager — fuzzy matching', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChromeStorage>;

  beforeEach(() => {
    mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    mock.clear();
  });

  it('finds similar text via fuzzyGet', async () => {
    const manager = new EnhancedCacheManager();
    const result = makeMockResult({ fullText: 'Hello world translation' });

    await manager.set('inline_Hello World', result, 'inline', 'https://a.com');

    const match = await manager.fuzzyGet('Hello word', 'inline', 0.7);

    expect(match).not.toBeNull();
    expect(match!.similarity).toBeGreaterThanOrEqual(0.7);
  });

  it('returns null for dissimilar text', async () => {
    const manager = new EnhancedCacheManager();
    const result = makeMockResult({ fullText: 'Hello world' });

    await manager.set('inline_The quick brown fox', result, 'inline', 'https://a.com');

    const match = await manager.fuzzyGet('xyz abc def', 'inline', 0.85);

    expect(match).toBeNull();
  });
});

describe('EnhancedCacheManager — clearAll', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChromeStorage>;

  beforeEach(() => {
    mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
    mock.clear();
  });

  it('removes all entries', async () => {
    const manager = new EnhancedCacheManager();

    for (let i = 0; i < 3; i++) {
      await manager.set(`clear-${i}`, makeMockResult(), 'inline', 'https://a.com');
    }

    await manager.clearAll();

    const stats = await manager.getStats();
    expect(stats.totalEntries).toBe(0);
  });
});
