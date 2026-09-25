/**
 * VocabularyStateSync 与词汇快照工具测试
 *
 * 覆盖：快照解析、background 取数、storage 监听去抖、销毁解绑、过期响应丢弃
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CEFRLevel } from '@/shared/types/mastery';

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils')>();
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

import {
  VocabularyStateSync,
  fetchVocabularySnapshot,
  snapshotFromProfile,
  vocabularySizeToCEFR,
  normalizeWordSet,
  type VocabularySnapshot,
} from '@/content/core/vocabularyState';

function makeSnapshot(overrides?: Partial<VocabularySnapshot>): VocabularySnapshot {
  return {
    userLevel: 'B1',
    knownWords: new Set(['hills']),
    unknownWords: new Set(['grisly']),
    ...overrides,
  };
}

type StorageListener = (changes: Record<string, unknown>, areaName: string) => void;

describe('词汇快照解析', () => {
  it('snapshotFromProfile 规范化大小写与空白，未知词条取 word 字段', () => {
    const snapshot = snapshotFromProfile(
      {
        knownWords: [' Hills ', 'SUN'],
        unknownWords: [
          { word: 'Grisly', context: '', translation: '', markedAt: 0, reviewCount: 0 },
        ],
        estimatedVocabulary: 3000,
      },
      { level: 'B1' }
    );

    expect([...snapshot.knownWords]).toEqual(['hills', 'sun']);
    expect([...snapshot.unknownWords]).toEqual(['grisly']);
    expect(snapshot.userLevel).toBe('B1');
  });

  it('CEFR 响应缺失时按 estimatedVocabulary 推断等级', () => {
    expect(snapshotFromProfile({ knownWords: [], unknownWords: [], estimatedVocabulary: 1400 }, undefined).userLevel).toBe('A1');
    expect(snapshotFromProfile({ knownWords: [], unknownWords: [], estimatedVocabulary: 1600 }, undefined).userLevel).toBe('A2');
    expect(snapshotFromProfile({ knownWords: [], unknownWords: [], estimatedVocabulary: 3000 }, undefined).userLevel).toBe('B1');
    expect(snapshotFromProfile({ knownWords: [], unknownWords: [], estimatedVocabulary: 5000 }, undefined).userLevel).toBe('B2');
    expect(snapshotFromProfile({ knownWords: [], unknownWords: [], estimatedVocabulary: 8000 }, undefined).userLevel).toBe('C1');
    expect(snapshotFromProfile({ knownWords: [], unknownWords: [], estimatedVocabulary: 9500 }, undefined).userLevel).toBe('C2');
  });

  it('profile 缺失时返回默认 B1 与空词表', () => {
    const snapshot = snapshotFromProfile(undefined, undefined);
    expect(snapshot.userLevel).toBe('B1');
    expect(snapshot.knownWords.size).toBe(0);
    expect(snapshot.unknownWords.size).toBe(0);
  });

  it('vocabularySizeToCEFR 边界映射', () => {
    expect(vocabularySizeToCEFR(0)).toBe('A1');
    expect(vocabularySizeToCEFR(1499)).toBe('A1');
    expect(vocabularySizeToCEFR(1500)).toBe('A2');
    expect(vocabularySizeToCEFR(2500)).toBe('B1');
    expect(vocabularySizeToCEFR(4000)).toBe('B2');
    expect(vocabularySizeToCEFR(6000)).toBe('C1');
    expect(vocabularySizeToCEFR(9000)).toBe('C2');
  });

  it('normalizeWordSet 过滤空字符串', () => {
    const result = normalizeWordSet([' A ', '', 'b']);
    expect([...result]).toEqual(['a', 'b']);
  });
});

describe('fetchVocabularySnapshot', () => {
  type SendHandler = (message: { type: string }) => unknown;
  let handlers: Map<string, SendHandler>;

  beforeEach(() => {
    handlers = new Map();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: (message: { type: string }) => {
          const handler = handlers.get(message.type);
          return Promise.resolve(handler ? handler(message) : { success: false, error: 'no handler' });
        },
      },
    };
  });

  it('合并 GET_USER_PROFILE 与 GET_CEFR_LEVEL 为快照', async () => {
    handlers.set('GET_USER_PROFILE', () => ({
      success: true,
      data: { knownWords: ['a'], unknownWords: [{ word: 'b' }], estimatedVocabulary: 3000 },
    }));
    handlers.set('GET_CEFR_LEVEL', () => ({ success: true, data: { level: 'C1', confidence: 0.9 } }));

    const snapshot = await fetchVocabularySnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.userLevel).toBe('C1');
    expect(snapshot!.knownWords.has('a')).toBe(true);
    expect(snapshot!.unknownWords.has('b')).toBe(true);
  });

  it('profile 请求失败时返回 null 而不是抛错', async () => {
    handlers.set('GET_USER_PROFILE', () => ({ success: false, error: 'boom' }));
    const snapshot = await fetchVocabularySnapshot();
    expect(snapshot).toBeNull();
  });
});

describe('VocabularyStateSync', () => {
  let storageListeners: StorageListener[];

  beforeEach(() => {
    storageListeners = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: vi.fn() },
      storage: {
        onChanged: {
          addListener: (fn: StorageListener) => storageListeners.push(fn),
          removeListener: (fn: StorageListener) => {
            storageListeners = storageListeners.filter((l) => l !== fn);
          },
        },
      },
    };
  });

  it('syncNow 拉取快照并交给 applier', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue(makeSnapshot());
    const applier = { applyVocabularySnapshot: vi.fn() };
    const sync = new VocabularyStateSync(applier, fetchSnapshot, 50);

    await sync.syncNow();

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(applier.applyVocabularySnapshot).toHaveBeenCalledTimes(1);
    expect(applier.applyVocabularySnapshot.mock.calls[0][0].userLevel).toBe('B1');
  });

  it('过期的异步响应不会覆盖新状态', async () => {
    const resolvers: Array<(s: VocabularySnapshot | null) => void> = [];
    const fetchSnapshot = vi.fn(
      () => new Promise<VocabularySnapshot | null>((resolve) => resolvers.push(resolve))
    );
    const applier = { applyVocabularySnapshot: vi.fn() };
    const sync = new VocabularyStateSync(applier, fetchSnapshot, 50);

    const p1 = sync.syncNow(); // 旧请求
    const p2 = sync.syncNow(); // 新请求，使旧请求过期

    resolvers[1](makeSnapshot({ knownWords: new Set(['fresh']) }));
    await p2;
    resolvers[0](makeSnapshot({ knownWords: new Set(['stale']) }));
    await p1;

    expect(applier.applyVocabularySnapshot).toHaveBeenCalledTimes(1);
    const applied = applier.applyVocabularySnapshot.mock.calls[0][0];
    expect(applied.knownWords.has('fresh')).toBe(true);
    expect(applied.knownWords.has('stale')).toBe(false);
  });

  it('相关 storage 键变化触发去抖同步，无关键不触发', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue(makeSnapshot());
    const applier = vi.fn();
    const sync = new VocabularyStateSync(applier, fetchSnapshot, 50);
    sync.start();
    expect(storageListeners.length).toBe(1);

    const listener = storageListeners[0];
    listener({ knownWords: { newValue: [] } }, 'local');
    listener({ settings: { newValue: {} } }, 'sync');
    await new Promise((r) => setTimeout(r, 120));
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    listener({ translationCache: { newValue: {} } }, 'local');
    await new Promise((r) => setTimeout(r, 120));
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('同一去抖窗口内的多次变化只同步一次', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue(makeSnapshot());
    const applier = vi.fn();
    const sync = new VocabularyStateSync(applier, fetchSnapshot, 80);
    sync.start();

    const listener = storageListeners[0];
    listener({ knownWords: { newValue: [] } }, 'local');
    await new Promise((r) => setTimeout(r, 20));
    listener({ unknownWords: { newValue: [] } }, 'local');
    await new Promise((r) => setTimeout(r, 20));
    listener({ userProfile: { newValue: {} } }, 'sync');

    await new Promise((r) => setTimeout(r, 200));
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('stop 后解绑监听，迟到的变化与 syncNow 均不再生效', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue(makeSnapshot());
    const applier = vi.fn();
    const sync = new VocabularyStateSync(applier, fetchSnapshot, 50);
    sync.start();

    const listener = storageListeners[0];
    sync.stop();
    expect(storageListeners.length).toBe(0);

    // 即使监听器被外部手动触发，销毁后的同步也应被忽略
    listener({ knownWords: { newValue: [] } }, 'local');
    await new Promise((r) => setTimeout(r, 120));
    await sync.syncNow();

    expect(fetchSnapshot).not.toHaveBeenCalled();
    expect(applier).not.toHaveBeenCalled();
  });

  it('快照拉取抛错时 syncNow 不向外传播异常', async () => {
    const fetchSnapshot = vi.fn().mockRejectedValue(new Error('network down'));
    const applier = vi.fn();
    const sync = new VocabularyStateSync(applier, fetchSnapshot, 50);

    await expect(sync.syncNow()).resolves.toBeUndefined();
    expect(applier).not.toHaveBeenCalled();
  });

  it('CEFRLevel 类型兼容性冒烟', () => {
    const level: CEFRLevel = 'B1';
    expect(level).toBe('B1');
  });
});
