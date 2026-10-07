import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnhancedCacheManager } from '@/background/enhancedCache';
import { PARAGRAPH_CACHE_KEY } from '@/shared/constants';
import type { EnhancedCacheStorage, TranslationResult } from '@/shared/types';

vi.mock('@/shared/utils', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const BUDGET = 8 * 1024 * 1024;
const result = (fullText = '译文'): TranslationResult => ({ fullText, words: [], sentences: [], cached: false });
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const quotaError = () => new Error('QUOTA_BYTES quota exceeded');
let persisted: Record<string, EnhancedCacheStorage>;
let manager: EnhancedCacheManager;
const write = vi.fn<(data: Record<string, EnhancedCacheStorage>) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  persisted = {};
  write.mockReset().mockImplementation(async data => {
    // 模拟 Chrome 的结构化拷贝，失败写入不得污染已落盘快照。
    persisted = { ...persisted, ...structuredClone(data) };
  });
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async () => structuredClone(persisted)),
    set: write,
    remove: vi.fn(async () => { persisted = {}; }),
  } } });
  manager = new EnhancedCacheManager();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = () => vi.advanceTimersByTimeAsync(1000);
const put = (key: string, fullText?: string) => manager.set(key, result(fullText), 'bilingual', 'background');

describe('缓存持久化字节预算与配额恢复', () => {
  it('UTF-8 序列化超过 8MiB 时按访问顺序裁剪，保留最近访问与最新写入的条目', async () => {
    const large = '中'.repeat(1024 * 1024);
    await put('recent', large);
    await put('oldest', large);
    await manager.get('recent');
    await put('newest', large);
    await flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(bytes(write.mock.calls[0][0])).toBeLessThanOrEqual(BUDGET);
    expect(Object.keys(persisted[PARAGRAPH_CACHE_KEY].paragraphCache).sort()).toEqual(['newest', 'recent']);
    expect(await manager.get('oldest')).toBeNull();
    expect(await manager.getStats()).toMatchObject({ totalEntries: 2, evictedEntries: 1, persistenceFailures: 0 });
    const restarted = new EnhancedCacheManager();
    expect((await restarted.get('recent'))?.fullText).toBe(large);
    expect(await restarted.get('oldest')).toBeNull();
  });

  it('单条超大结果会被淘汰，空快照仍可持久化且链表可再次使用', async () => {
    await put('oversized', 'x'.repeat(BUDGET));
    await flush();
    expect(bytes(write.mock.calls[0][0])).toBeLessThanOrEqual(BUDGET);
    expect(persisted[PARAGRAPH_CACHE_KEY].paragraphCache).toEqual({});
    expect(await manager.getStats()).toMatchObject({ evictedEntries: 1, totalEntries: 0 });
    await put('fresh');
    await flush();
    expect((await new EnhancedCacheManager().get('fresh'))?.fullText).toBe('译文');
  });

  it('预算内正常落盘不淘汰，更新同键不会重复计费', async () => {
    await put('same', 'x'.repeat(BUDGET));
    await put('same', '短译文');
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(await manager.getStats()).toMatchObject({ totalEntries: 1, evictedEntries: 0, persistenceFailures: 0 });
    expect((await new EnhancedCacheManager().get('same'))?.fullText).toBe('短译文');
  });

  it('第一次配额拒绝后缩小快照并仅重试一次，冷启动恢复成功重试的内容', async () => {
    await put('oldest', 'x'.repeat(1024));
    await put('middle', 'x'.repeat(1024));
    await put('newest', 'x'.repeat(1024));
    write.mockRejectedValueOnce(quotaError());
    await flush();

    expect(write).toHaveBeenCalledTimes(2);
    expect(bytes(write.mock.calls[1][0])).toBeLessThan(bytes(write.mock.calls[0][0]));
    expect(await manager.getStats()).toMatchObject({ persistenceFailures: 1 });
    expect((await manager.getStats()).evictedEntries).toBeGreaterThan(0);
    expect(await manager.get('oldest')).toBeNull();
    expect(await new EnhancedCacheManager().get('newest')).not.toBeNull();
  });

  it('持续配额拒绝可观测且重试有界，不污染上次成功快照，后续写入仍可恢复', async () => {
    await put('saved');
    await flush();
    const lastGood = structuredClone(persisted);
    write.mockClear().mockRejectedValue(quotaError());
    await put('pending-a', 'x'.repeat(1024));
    await put('pending-b', 'x'.repeat(1024));
    await flush();
    await vi.advanceTimersByTimeAsync(5000);

    expect(write).toHaveBeenCalledTimes(2);
    expect(await manager.getStats()).toMatchObject({ persistenceFailures: 2 });
    expect((await manager.getStats()).evictedEntries).toBeGreaterThan(0);
    expect(persisted).toEqual(lastGood);
    const restarted = new EnhancedCacheManager();
    expect(await restarted.get('saved')).not.toBeNull();
    expect(await restarted.get('pending-a')).toBeNull();
    expect(await restarted.getStats()).toMatchObject({ persistenceFailures: 0 });

    write.mockImplementation(async data => { persisted = structuredClone(data); });
    await put('recovered');
    await flush();
    expect(await new EnhancedCacheManager().get('recovered')).not.toBeNull();
    expect(await manager.getStats()).toMatchObject({ persistenceFailures: 2 });
  });

  it('非配额错误计数但不无谓淘汰或重试，下次持久化不被拒绝的队列阻塞', async () => {
    write.mockRejectedValueOnce(new Error('Storage unavailable'));
    await put('first');
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(await manager.getStats()).toMatchObject({ persistenceFailures: 1, evictedEntries: 0 });
    await put('second');
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(await new EnhancedCacheManager().get('first')).not.toBeNull();
  });

  it('等待写入期间清空缓存，迟到的配额拒绝不得重试或淘汰新一代条目', async () => {
    let rejectWrite!: (error: Error) => void;
    write.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
    await put('old');
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    const clearing = manager.clearAll();
    await put('new');
    rejectWrite(quotaError());
    await clearing;
    expect(write).toHaveBeenCalledTimes(1);
    expect(await manager.get('new')).not.toBeNull();
    await flush();
    expect(await new EnhancedCacheManager().get('old')).toBeNull();
    expect(await new EnhancedCacheManager().get('new')).not.toBeNull();
    expect(await manager.getStats()).toMatchObject({ persistenceFailures: 1, evictedEntries: 0 });
  });
});
