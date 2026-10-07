/**
 * EnhancedCache 测试
 *
 * 覆盖 generateHash, set/get, LRU eviction, cleanExpired, fuzzyGet, getStats.
 * Mock chrome.storage.local 用于测试。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnhancedCacheManager } from '@/background/enhancedCache';
import { logger } from '@/shared/utils';
import { CACHE_VERSION, DEFAULT_BATCH_CONFIG, PARAGRAPH_CACHE_KEY } from '@/shared/constants';
import type { UserSettings, UserProfile } from '@/shared/types';

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

  it('缓存键即使来自错误的明文调用方，也不将页面原文写入日志', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    try {
      const manager = new EnhancedCacheManager();
      const sensitive = 'PAGE-BODY-SECRET';
      await manager.set(sensitive, makeMockResult(), 'bilingual', 'background');
      await manager.get(sensitive);
      expect(JSON.stringify(info.mock.calls)).not.toContain(sensitive);
    } finally {
      info.mockRestore();
    }
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

  it('重启加载时按来源保留 8 天前的 DeepL 结果但淘汰 LLM 结果', async () => {
    const createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const entry = (textHash: string, source: 'deepl' | 'llm') => ({
      textHash, result: makeMockResult({ fullText: source }), mode: 'bilingual',
      pageUrl: 'background', createdAt, lastAccessedAt: createdAt, source,
    });
    await mock.chrome.storage.local.set({
      [PARAGRAPH_CACHE_KEY]: {
        version: CACHE_VERSION,
        paragraphCache: { deepl: entry('deepl', 'deepl'), llm: entry('llm', 'llm') },
      },
    });
    const restarted = new EnhancedCacheManager();

    expect((await restarted.get('deepl'))?.fullText).toBe('deepl');
    expect(await restarted.get('llm')).toBeNull();
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

  it('重复写入的最新译文不会因旧 LRU 节点被淘汰', async () => {
    const manager = new EnhancedCacheManager();
    const maxEntries = Math.ceil(DEFAULT_BATCH_CONFIG.maxCacheEntries * 0.95);
    for (let i = 0; i < maxEntries - 1; i++) {
      await manager.set(`hash-${i}`, makeMockResult(), 'inline', 'background');
    }
    await manager.set('hash-0', makeMockResult({ fullText: '最新译文' }), 'inline', 'background');
    await manager.set('trigger', makeMockResult(), 'inline', 'background');

    expect((await manager.get('hash-0'))?.fullText).toBe('最新译文');
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

  it('批量重复键不会添加旧节点并误淘汰最新译文', async () => {
    const manager = new EnhancedCacheManager();
    const maxEntries = Math.ceil(DEFAULT_BATCH_CONFIG.maxCacheEntries * 0.95);
    for (let i = 0; i < maxEntries - 1; i++) {
      await manager.set(`hash-${i}`, makeMockResult(), 'inline', 'background');
    }
    await manager.setBatch([
      { textHash: 'hash-0', result: makeMockResult({ fullText: '批量最新译文' }), mode: 'inline', pageUrl: 'background' },
      { textHash: 'trigger', result: makeMockResult(), mode: 'inline', pageUrl: 'background' },
    ]);

    expect((await manager.get('hash-0'))?.fullText).toBe('批量最新译文');
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

  it('生产哈希不含原文：只命中同文本精确项，不把哈希尾部当作原文比较', async () => {
    const manager = new EnhancedCacheManager();
    const text = 'This result is not correct for the reader.';
    const result = makeMockResult({ fullText: '这对读者而言不正确。' });
    await manager.set(manager.generateHash(text, 'bilingual'), result, 'bilingual', 'https://a.com');

    expect(await manager.fuzzyGet(text, 'bilingual')).toMatchObject({ similarity: 1, result: { fullText: result.fullText } });
    expect(await manager.fuzzyGet('This result is correct for the reader.', 'bilingual', 0.1)).toBeNull();
    expect(await manager.fuzzyGet('This result is not correct for the reader!', 'bilingual', 0)).toBeNull();
  });

  it('即使旧式明文键近似或结果带 position，也不能模糊复用', async () => {
    const manager = new EnhancedCacheManager();
    const result = makeMockResult({ words: [{ original: 'not', translation: '不', position: [15, 18] }] });
    await manager.set('inline_This is not the same.', result, 'inline', 'https://a.com');
    expect(await manager.fuzzyGet('This is the same.', 'inline', 0)).toBeNull();
  });

  it('returns null for dissimilar text', async () => {
    const manager = new EnhancedCacheManager();
    const result = makeMockResult({ fullText: 'Hello world' });

    await manager.set('inline_The quick brown fox', result, 'inline', 'https://a.com');

    const match = await manager.fuzzyGet('xyz abc def', 'inline', 0.85);

    expect(match).toBeNull();
  });
});

describe('EnhancedCacheManager — 译文作用域', () => {
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

  const settings = {
    apiProvider: 'openai', customModelName: 'model-a', phraseTranslationEnabled: false,
    grammarTranslationEnabled: false, promptVersion: 'v1',
    apiConfigs: [{ id: 'active', name: '配置', provider: 'openai', apiKey: 'SECRET-API-KEY',
      modelName: 'model-a', apiUrl: 'https://api.example/v1', tested: true, createdAt: 1 }],
    activeApiConfigId: 'active',
  } as UserSettings;
  const userLevel = {
    examType: 'cet4', estimatedVocabulary: 3000, knownWords: ['hello'], unknownWords: [],
    levelConfidence: 0.5, createdAt: 1, updatedAt: 1,
  } as UserProfile;
  const text = 'The unprecedented result surprised everyone.';

  it('同一文本与模式精确复用；provider/model/增强/等级桶/语境/引擎变化均未命中', async () => {
    const manager = new EnhancedCacheManager();
    const scope = { settings, userLevel, context: 'first context', engine: 'llm' };
    const key = manager.generateHash(text, 'bilingual', scope);
    await manager.set(key, makeMockResult(), 'bilingual', 'https://example.com');
    expect(await manager.get(manager.generateHash(text, 'bilingual', { ...scope }))).not.toBeNull();
    const variants = [
      { ...scope, settings: { ...settings, apiProvider: 'anthropic' } },
      { ...scope, settings: { ...settings, customModelName: 'model-b' } },
      { ...scope, settings: { ...settings, apiConfigs: [{ ...settings.apiConfigs[0], modelName: 'model-b' }] } },
      { ...scope, settings: { ...settings, apiConfigs: [{ ...settings.apiConfigs[0], apiKey: 'ROTATED-SECRET-KEY' }] } },
      { ...scope, settings: { ...settings, phraseTranslationEnabled: true } },
      { ...scope, settings: { ...settings, grammarTranslationEnabled: true } },
      { ...scope, userLevel: { ...userLevel, estimatedVocabulary: 9000 } },
      { ...scope, context: 'second context' },
      { ...scope, engine: 'batch' },
      { ...scope, engine: 'deepl' },
    ];
    for (const variant of variants) {
      expect(await manager.get(manager.generateHash(text, 'bilingual', variant))).toBeNull();
    }
    const unknownWords = [
      { word: 'first', translation: '第一个', context: '例句', markedAt: 1, reviewCount: 0 },
      { word: 'second', translation: '第二个', context: '语境', markedAt: 2, reviewCount: 0 },
    ];
    const withWords = { ...scope, userLevel: { ...userLevel, unknownWords } };
    expect(manager.generateHash(text, 'bilingual', withWords)).toBe(manager.generateHash(text, 'bilingual', {
      ...withWords, userLevel: { ...withWords.userLevel, unknownWords: [...unknownWords].reverse() },
    }));
    expect(unknownWords[0].word).toBe('first');
  });

  it.each(['inline-only', 'bilingual', 'full-translate'] as const)('%s 模式所有引擎均忽略词表和百词桶内波动，仅跨桶失效', mode => {
    const manager = new EnhancedCacheManager();
    for (const engine of ['llm', 'batch', 'deepl', 'hybrid', 'free_google'] as const) {
      const profile = { ...userLevel, estimatedVocabulary: 4500 };
      const scope = { settings, userLevel: profile, engine };
      const key = manager.generateHash(text, mode, scope);
      // 各模式使用相同分桶规则，但模式之间仍保留隔离。
      for (const estimatedVocabulary of [4500, 4550, 4599]) {
        const changed = { ...scope, userLevel: { ...profile, estimatedVocabulary,
          knownWords: ['other'], unknownWords: [{ word: 'result', translation: '结果', context: '', markedAt: 1, reviewCount: 0 }],
        } };
        expect(manager.generateHash(text, mode, changed)).toBe(key);
      }
      expect(manager.generateHash(text, mode, { ...scope, userLevel: { ...profile, estimatedVocabulary: 4499 } })).not.toBe(key);
      expect(manager.generateHash(text, mode, { ...scope, userLevel: { ...profile, estimatedVocabulary: 4600 } })).not.toBe(key);
    }
  });

  it('未显式选中配置时轮换首个配置密钥仍使缓存失效', () => {
    const manager = new EnhancedCacheManager();
    const first = { ...settings, activeApiConfigId: undefined };
    const rotated = { ...first, apiConfigs: [{ ...first.apiConfigs[0], apiKey: 'NEW-ACCOUNT-KEY' }] };

    expect(manager.generateHash(text, 'bilingual', { settings: first, userLevel, engine: 'llm' }))
      .not.toBe(manager.generateHash(text, 'bilingual', { settings: rotated, userLevel, engine: 'llm' }));
  });

  it('不同语境即使发生 32 位哈希碰撞也不能命中彼此译文', async () => {
    const manager = new EnhancedCacheManager();
    const firstScope = { settings, userLevel, context: 'Aa', engine: 'llm' };
    const secondScope = { ...firstScope, context: 'BB' };
    const firstKey = manager.generateHash(text, 'bilingual', firstScope);
    await manager.set(firstKey, makeMockResult(), 'bilingual', 'background');

    const secondKey = manager.generateHash(text, 'bilingual', secondScope);
    expect(secondKey).not.toBe(firstKey);
    expect(await manager.get(secondKey)).toBeNull();
  });

  it('不同原文即使发生 32 位哈希碰撞也不能共享词位与译文', async () => {
    const manager = new EnhancedCacheManager();
    const scope = { settings, userLevel, context: '', engine: 'llm' };
    const firstKey = manager.generateHash('The Aa arrives.', 'bilingual', scope);
    await manager.set(firstKey, makeMockResult(), 'bilingual', 'background');

    const secondKey = manager.generateHash('The BB arrives.', 'bilingual', scope);
    expect(secondKey).not.toBe(firstKey);
    expect(await manager.get(secondKey)).toBeNull();
  });

  it('并发初始化迁移旧数据时，不清除迁移后刚写的新精确项', async () => {
    const manager = new EnhancedCacheManager();
    const oldStorage = { version: 2, paragraphCache: {} };
    const get = vi.spyOn(mock.chrome.storage.local, 'get');
    let releaseSecond: (() => void) | undefined;
    get.mockImplementationOnce(async () => ({ [PARAGRAPH_CACHE_KEY]: oldStorage }));
    get.mockImplementationOnce(() => new Promise(resolve => {
      releaseSecond = () => resolve({ [PARAGRAPH_CACHE_KEY]: oldStorage });
    }));
    const first = manager.get('old');
    const second = manager.get('old');
    await first;
    await manager.set('new', makeMockResult(), 'bilingual', 'background');
    releaseSecond?.();
    await second;
    expect(await manager.get('new')).not.toBeNull();
  });

  it('持久化结果时不保存页面地址的凭据与查询参数', async () => {
    vi.useFakeTimers();
    try {
      const manager = new EnhancedCacheManager();
      await manager.set('safe', makeMockResult(), 'bilingual',
        'https://user:password@example.com/article?token=SECRET-URL-TOKEN#private');
      await vi.advanceTimersByTimeAsync(1100);
      const persisted = JSON.stringify(mock.store[PARAGRAPH_CACHE_KEY]);
      expect(persisted).not.toContain('SECRET-URL-TOKEN');
      expect(persisted).not.toContain('password');
    } finally {
      vi.useRealTimers();
    }
  });

  it('旧版本数据失效，新缓存键与持久化内容均不含 Key、语境或页面正文', async () => {
    const manager = new EnhancedCacheManager();
    const oldKey = manager.generateHash(text, 'bilingual');
    mock.store[PARAGRAPH_CACHE_KEY] = {
      version: 2, paragraphCache: {
        [oldKey]: { textHash: oldKey, result: makeMockResult(), mode: 'bilingual',
          pageUrl: 'background', createdAt: Date.now(), lastAccessedAt: Date.now() },
      },
    };
    const newKey = manager.generateHash(text, 'bilingual', {
      settings, userLevel, context: 'SENSITIVE-CONTEXT', engine: 'llm',
    });
    expect(newKey).not.toBe(oldKey);
    expect(await manager.get(newKey)).toBeNull();
    expect(await manager.get(oldKey)).toBeNull();
    vi.useFakeTimers();
    try {
      await manager.set(newKey, makeMockResult(), 'bilingual', 'background');
      await vi.advanceTimersByTimeAsync(1100);
      const persisted = JSON.stringify(mock.store);
      expect(persisted).not.toContain('SECRET-API-KEY');
      expect(persisted).not.toContain('SENSITIVE-CONTEXT');
      expect(persisted).not.toContain(text);
      expect(persisted).toContain(newKey);
    } finally {
      vi.useRealTimers();
    }
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

  it('初始化读取迟到时不能把已清空的旧条目装回内存', async () => {
    const manager = new EnhancedCacheManager();
    const oldEntry = {
      textHash: 'old', result: makeMockResult(), mode: 'bilingual' as const,
      pageUrl: 'background', createdAt: Date.now(), lastAccessedAt: Date.now(),
    };
    let releaseGet: (() => void) | undefined;
    vi.spyOn(mock.chrome.storage.local, 'get').mockImplementationOnce(() => new Promise(resolve => {
      releaseGet = () => resolve({
        [PARAGRAPH_CACHE_KEY]: { version: CACHE_VERSION, paragraphCache: { old: oldEntry } },
      });
    }));
    const pending = manager.get('old');
    await manager.clearAll();
    releaseGet?.();

    expect(await pending).toBeNull();
    expect(await manager.get('old')).toBeNull();
  });

  it('正在写入的旧快照必须先于清空操作结束', async () => {
    vi.useFakeTimers();
    try {
      const manager = new EnhancedCacheManager();
      await manager.set('old', makeMockResult(), 'bilingual', 'background');
      let releaseSet: (() => void) | undefined;
      const realSet = mock.chrome.storage.local.set;
      vi.spyOn(mock.chrome.storage.local, 'set').mockImplementationOnce(data => new Promise(resolve => {
        releaseSet = () => { void realSet(data).then(resolve); };
      }));
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(releaseSet).toBeDefined();

      const pendingClear = manager.clearAll();
      releaseSet?.();
      await pendingClear;
      expect(mock.store[PARAGRAPH_CACHE_KEY]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('清空前请求迟到的单条与批量结果不得重新写入缓存', async () => {
    const manager = new EnhancedCacheManager();
    const previousGeneration = manager.getGeneration();
    await manager.clearAll();

    await manager.set('stale-single', makeMockResult(), 'bilingual', 'background', 'llm', previousGeneration);
    await manager.setBatch([
      { textHash: 'stale-batch', result: makeMockResult(), mode: 'bilingual', pageUrl: 'background' },
    ], 'llm', previousGeneration);
    expect(await manager.get('stale-single')).toBeNull();
    expect(await manager.get('stale-batch')).toBeNull();

    await manager.set('fresh', makeMockResult(), 'bilingual', 'background', 'llm', manager.getGeneration());
    expect(await manager.get('fresh')).not.toBeNull();
  });

  it('清空时取消待写入任务，旧条目不会在清空后复活', async () => {
    vi.useFakeTimers();
    try {
      const manager = new EnhancedCacheManager();
      await manager.set('obsolete', makeMockResult(), 'inline', 'background');
      await manager.clearAll();
      await vi.advanceTimersByTimeAsync(1100);
      expect(mock.store[PARAGRAPH_CACHE_KEY]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
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
