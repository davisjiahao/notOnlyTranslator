import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupOldEntries, clearAllHistory, closeDB, deleteHistoryEntries, deleteHistoryEntry, getHistoryById,
  importHistoryData, queryTranslationHistory, saveTranslationHistory,
  type TranslationHistoryEntry,
} from '@/background/translationHistory';

vi.mock('@/shared/utils', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

type TestRequest<T> = {
  result: T;
  error: Error | null;
  onsuccess: ((event: { target: TestRequest<T> }) => void) | null;
  onerror: (() => void) | null;
};

function request<T>(result: T, onSuccess?: () => void): TestRequest<T> {
  const operation: TestRequest<T> = { result, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    onSuccess?.();
    operation.onsuccess?.({ target: operation });
  });
  return operation;
}

let abortAfterWrite = false;
let completeSaveAfterWrite = false;
let abortAfterDelete = false;
let deletionCount = 0;

const entry: TranslationHistoryEntry = {
  id: 'record-1', originalText: 'bank',
  translation: { words: [], sentences: [], fullText: '银行' },
  pageUrl: 'https://example.test/', mode: 'bilingual', timestamp: 1,
  charCount: 4,
};

beforeEach(() => {
  abortAfterWrite = false;
  completeSaveAfterWrite = false;
  abortAfterDelete = false;
  deletionCount = 0;
  const records = new Map<string, TranslationHistoryEntry>();
  const createStore = (transaction: {
    oncomplete: (() => void) | null;
    onabort: (() => void) | null;
    aborted: boolean;
    abort: () => void;
  }) => {
    let isCleanup = false;
    let cleanupCompletionScheduled = false;
    return ({
    getAllKeys: () => request([...records.keys()], () => {
      const current = transaction;
      setTimeout(() => { if (!current?.aborted) current?.oncomplete?.(); }, 0);
    }),
    put: (value: TranslationHistoryEntry) => request(undefined, () => {
      records.set(value.id, value);
      const current = transaction;
      if (abortAfterWrite) {
        queueMicrotask(() => {
          records.delete(value.id);
          current?.abort();
        });
      } else if (completeSaveAfterWrite) {
        queueMicrotask(() => current?.oncomplete?.());
      }
    }),
    delete: (id: string) => {
      if (typeof id !== 'string' || id === 'sync-throw') throw new DOMException('无效键', 'DataError');
      const current = transaction;
      return request(undefined, () => {
        if (current?.aborted) return;
        const previous = records.get(id);
        records.delete(id);
        deletionCount++;
        queueMicrotask(() => {
          if (abortAfterDelete) {
            if (previous) records.set(id, previous);
            current?.abort();
          } else if (!isCleanup) {
            current?.oncomplete?.();
          }
        });
      });
    },
    clear: () => request(undefined, () => {
      const previous = [...records.entries()];
      const current = transaction;
      records.clear();
      queueMicrotask(() => {
        if (abortAfterDelete) {
          previous.forEach(([id, value]) => records.set(id, value));
          current?.abort();
        } else {
          current?.oncomplete?.();
        }
      });
    }),
    get: (id: string) => request(records.get(id) ?? null),
    count: () => {
      isCleanup = true;
      return request(records.size);
    },
    index: () => ({
      openCursor: (range: { upper?: number; lower?: number } | null, direction: string) => {
        const sorted = [...records.values()]
          .filter(value => (range?.upper === undefined || value.timestamp <= range.upper)
            && (range?.lower === undefined || value.timestamp >= range.lower))
          // IndexedDB 非唯一索引先按索引键排序，同值再按主键排序。
          .sort((a, b) => {
            const primary = a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
            return direction === 'prev'
              ? b.timestamp - a.timestamp || -primary
              : a.timestamp - b.timestamp || primary;
          });
        let position = 0;
        const cursorRequest: TestRequest<{
          value: TranslationHistoryEntry; primaryKey: string; continue: () => void
        } | null> = { result: null, onsuccess: null, onerror: null, error: null };
        const advance = () => {
          if (transaction.aborted) return;
          const value = sorted[position++];
          cursorRequest.result = value ? { value, primaryKey: value.id, continue: () => queueMicrotask(advance) } : null;
          cursorRequest.onsuccess?.({ target: cursorRequest });
          if (isCleanup && !cleanupCompletionScheduled) {
            cleanupCompletionScheduled = true;
            setTimeout(() => { if (!transaction.aborted) transaction.oncomplete?.(); }, 0);
          }
        };
        queueMicrotask(advance);
        return cursorRequest;
      },
    }),
  });
  };
  const db = {
    transaction: () => {
      const transaction = {
        objectStore: () => createStore(transaction),
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        onerror: null as (() => void) | null,
        aborted: false,
        abort: () => {
          transaction.aborted = true;
          transaction.onabort?.();
        },
      };
      return transaction;
    },
    close: vi.fn(),
  };
  vi.stubGlobal('indexedDB', { open: () => request(db) });
  vi.stubGlobal('IDBKeyRange', {
    upperBound: (upper: number) => ({ upper }),
    lowerBound: (lower: number) => ({ lower }),
  });
});

afterEach(() => {
  closeDB();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('翻译历史导入与读取', () => {
  it('同一批重复 ID 只导入首条，不覆盖首条记录', async () => {
    const next = { ...entry, originalText: 'other', translation: { ...entry.translation, fullText: '其他' } };
    expect(await importHistoryData([entry, next])).toEqual({ imported: 1, skipped: 1 });
    expect(await getHistoryById(entry.id)).toMatchObject({ originalText: 'bank', translation: { fullText: '银行' } });
  });

  it('备份恢复保留合法的纯空白原文和空白字符串 ID', async () => {
    const blankText = { ...entry, id: ' ', originalText: '   ', charCount: 3 };
    expect(await importHistoryData([blankText])).toEqual({ imported: 1, skipped: 0 });
    expect(await getHistoryById(' ')).toMatchObject({ originalText: '   ' });
  });

  it('拒绝非字符串 IndexedDB 键，避免批次被同值键覆盖', async () => {
    const invalid = { ...entry, id: ['record-1'] as unknown as string };
    expect(await importHistoryData([entry, invalid])).toEqual({ imported: 1, skipped: 1 });
    expect(await getHistoryById(entry.id)).toMatchObject({ originalText: 'bank' });
  });

  it('写入请求成功但事务中止时不宣称导入成功', async () => {
    abortAfterWrite = true;
    await expect(importHistoryData([entry])).rejects.toThrow('导入数据失败');
    expect(await getHistoryById(entry.id)).toBeNull();
  });

  it('拒绝伪装成字符串的原文，避免保存后使历史搜索崩溃', async () => {
    await expect(saveTranslationHistory(
      { length: 4 } as unknown as string, entry.translation, entry.pageUrl, entry.mode
    )).rejects.toThrow('保存翻译历史失败');
    expect(await queryTranslationHistory({ keyword: 'bank' })).toMatchObject({ total: 0 });
  });

  it('事务提交后保存历史并返回生成的条目', async () => {
    completeSaveAfterWrite = true;

    const saved = await saveTranslationHistory('bank', entry.translation, entry.pageUrl, entry.mode);

    expect(saved).toMatchObject({ originalText: 'bank', charCount: 4, mode: 'bilingual' });
    expect(await getHistoryById(saved.id)).toMatchObject({ originalText: 'bank' });
  });

  it('旧备份含未来时间戳时，新保存的历史不会立刻被容量清理删除', async () => {
    const future = Date.now() + 60_000;
    await importHistoryData(Array.from({ length: 1000 }, (_, index) => ({
      ...entry, id: `future-${index}`, timestamp: future,
    })));
    completeSaveAfterWrite = true;

    const saved = await saveTranslationHistory('new reading', entry.translation, entry.pageUrl, entry.mode);
    await vi.waitFor(() => expect(deletionCount).toBeGreaterThan(0));

    expect(await getHistoryById(saved.id)).toMatchObject({ originalText: 'new reading' });
    expect((await queryTranslationHistory()).total).toBe(1000);
  });

  it('并发保存的两条新记录不会被彼此的容量清理删除', async () => {
    const future = Date.now() + 60_000;
    await importHistoryData(Array.from({ length: 1000 }, (_, index) => ({
      ...entry, id: `future-${index}`, timestamp: future,
    })));
    completeSaveAfterWrite = true;

    const [first, second] = await Promise.all([
      saveTranslationHistory('first reading', entry.translation, entry.pageUrl, entry.mode),
      saveTranslationHistory('second reading', entry.translation, entry.pageUrl, entry.mode),
    ]);
    await vi.waitFor(() => expect(deletionCount).toBeGreaterThanOrEqual(2));

    expect(await getHistoryById(first.id)).toMatchObject({ originalText: 'first reading' });
    expect(await getHistoryById(second.id)).toMatchObject({ originalText: 'second reading' });
    expect((await queryTranslationHistory()).total).toBe(1000);
  });

  it('同毫秒旧记录主键排在新记录之后时，并发保存仍保留两条新记录且不超限', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.3).mockReturnValueOnce(0.4);
    await importHistoryData(Array.from({ length: 1000 }, (_, index) => ({
      ...entry, id: `z-${String(index).padStart(4, '0')}`, timestamp: now,
    })));
    completeSaveAfterWrite = true;

    const [first, second] = await Promise.all([
      saveTranslationHistory('first reading', entry.translation, entry.pageUrl, entry.mode),
      saveTranslationHistory('second reading', entry.translation, entry.pageUrl, entry.mode),
    ]);
    await vi.waitFor(() => expect(deletionCount).toBeGreaterThanOrEqual(2));

    expect(first.timestamp).toBe(now);
    expect(second.timestamp).toBe(now);
    expect(await getHistoryById(first.id)).toMatchObject({ originalText: 'first reading' });
    expect(await getHistoryById(second.id)).toMatchObject({ originalText: 'second reading' });
    expect((await queryTranslationHistory()).total).toBe(1000);
  });

  it('清理删除请求成功但事务中止时不能兑现清理成功', async () => {
    await importHistoryData(Array.from({ length: 1001 }, (_, index) => ({
      ...entry, id: `old-${index}`, timestamp: index + 1,
    })));
    abortAfterDelete = true;

    await expect(cleanupOldEntries()).rejects.toThrow('清理历史记录失败');
    expect((await queryTranslationHistory()).total).toBe(1001);
  });

  it('过期清理的删除请求成功但事务中止时不能兑现清理成功', async () => {
    await importHistoryData([entry]);
    abortAfterDelete = true;

    await expect(cleanupOldEntries()).rejects.toThrow('清理历史记录失败');
    expect(await getHistoryById(entry.id)).toMatchObject({ originalText: 'bank' });
  });

  it('保存请求成功但事务回滚时不宣称已保存历史', async () => {
    abortAfterWrite = true;

    await expect(saveTranslationHistory('bank', entry.translation, entry.pageUrl, entry.mode))
      .rejects.toThrow('保存翻译历史失败');
  });

  it.each([
    { name: '后置无效键', ids: [entry.id, null as unknown as string] },
    { name: '后置同步异常', ids: [entry.id, 'sync-throw'] },
  ])('批删$name时不得提交先前入队的删除', async ({ ids }) => {
    await importHistoryData([entry]);

    await expect(deleteHistoryEntries(ids)).rejects.toThrow();
    expect(await getHistoryById(entry.id)).toMatchObject({ originalText: 'bank' });
  });

  it.each([
    { name: '单条删除', remove: () => deleteHistoryEntry(entry.id) },
    { name: '批量删除', remove: () => deleteHistoryEntries([entry.id]) },
    { name: '清空历史', remove: () => clearAllHistory() },
  ])('$name事务提交后记录不再存在', async ({ remove }) => {
    await importHistoryData([entry]);

    await remove();

    expect(await getHistoryById(entry.id)).toBeNull();
  });

  it.each([
    { name: '单条删除', remove: () => deleteHistoryEntry(entry.id) },
    { name: '批量删除', remove: () => deleteHistoryEntries([entry.id]) },
    { name: '清空历史', remove: () => clearAllHistory() },
  ])('$name请求成功但事务中止时不宣称数据已删除', async ({ remove }) => {
    await importHistoryData([entry]);
    abortAfterDelete = true;

    await expect(remove()).rejects.toThrow();
    expect(await getHistoryById(entry.id)).toMatchObject({ originalText: 'bank' });
  });

  it('按页面和译文关键词过滤后分页，返回全部匹配数', async () => {
    const newer = { ...entry, id: 'record-2', originalText: 'finance', timestamp: 3 };
    const otherPage = { ...entry, id: 'record-3', pageUrl: 'https://another.test/', timestamp: 2 };
    expect(await importHistoryData([entry, newer, otherPage])).toEqual({ imported: 3, skipped: 0 });

    const first = await queryTranslationHistory({
      pageUrl: 'example.test', keyword: '银行', limit: 1,
    });
    expect(first).toMatchObject({ total: 2, hasMore: true, entries: [{ id: 'record-2' }] });

    const second = await queryTranslationHistory({
      pageUrl: 'example.test', keyword: '银行', limit: 1, offset: 1,
    });
    expect(second).toMatchObject({ total: 2, hasMore: false, entries: [{ id: 'record-1' }] });
  });
});
