import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureReadingInvalidation,
  invalidateReadingContext,
  readingContextChanged,
  resetReadingInvalidationForTests,
  settleReadingInvalidation,
} from '@/background/readingInvalidation';

afterEach(() => resetReadingInvalidationForTests());

describe('阅读上下文失效', () => {
  it('模式、词表、配置和密钥变化需要失效，外观设置不需要', () => {
    expect(readingContextChanged({
      settings: { oldValue: { translationMode: 'inline-only', highlightColor: '#fff' }, newValue: { translationMode: 'bilingual', highlightColor: '#fff' } },
    }, 'sync')).toBe(true);
    expect(readingContextChanged({
      settings: { oldValue: { translationMode: 'inline-only', apiConfigs: [{ apiKey: 'a' }] }, newValue: { translationMode: 'inline-only', apiConfigs: [{ apiKey: 'b' }] } },
    }, 'sync')).toBe(true);
    expect(readingContextChanged({
      settings: { oldValue: { highlightColor: '#fff', fontSize: 14 }, newValue: { highlightColor: '#000', fontSize: 16 } },
    }, 'sync')).toBe(false);
    expect(readingContextChanged({ knownWords: { oldValue: ['a'], newValue: ['a', 'b'] } }, 'local')).toBe(true);
    expect(readingContextChanged({ unknownWords: { oldValue: [], newValue: [{ word: 'plant' }] } }, 'local')).toBe(true);
    expect(readingContextChanged({ apiKey: { oldValue: 'old-key', newValue: 'new-key' } }, 'sync')).toBe(true);
    expect(readingContextChanged({
      userProfile: { oldValue: { estimatedVocabulary: 3000, updatedAt: 1 }, newValue: { estimatedVocabulary: 3000, updatedAt: 2 } },
    }, 'sync')).toBe(false);
    expect(readingContextChanged({
      userProfile: { oldValue: { estimatedVocabulary: 3000 }, newValue: { estimatedVocabulary: 5000 } },
    }, 'sync')).toBe(true);
  });

  it('先同步清理缓存代际，再中止在途请求，重复失效可以串行结束', async () => {
    const order: string[] = [];
    let resolveClear: (() => void) | undefined;
    configureReadingInvalidation({
      abortTranslations: () => { order.push('abort'); },
      clearCaches: () => {
        order.push('clear-start');
        return new Promise(resolve => { resolveClear = () => { order.push('clear-end'); resolve(); }; });
      },
    });
    invalidateReadingContext();
    expect(order).toEqual(['clear-start', 'abort']);
    resolveClear?.();
    await settleReadingInvalidation();
    expect(order).toEqual(['clear-start', 'abort', 'clear-end']);
  });

  it('清理失败不会挡住下一次失效', async () => {
    const abort = vi.fn();
    configureReadingInvalidation({
      abortTranslations: abort,
      clearCaches: async () => { throw new Error('synthetic-secret'); },
    });
    invalidateReadingContext();
    await expect(settleReadingInvalidation()).resolves.toBeUndefined();
    invalidateReadingContext();
    expect(abort).toHaveBeenCalledTimes(2);
  });
});
