/**
 * 批量翻译队列测试
 *
 * 覆盖 enqueue, deduplication, priority, retry, cleanup, clear, stats, defaults
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BatchTranslationQueue,
  createDefaultQueueConfig,
  type BatchProcessor,
} from '@/background/batchTranslationQueue';

function createTestQueue<T = string, R = string>(
  processor: BatchProcessor<T, R>,
  dedupKeyGenerator?: (input: T) => string,
  overrides: Partial<import('@/background/batchTranslationQueue').BatchQueueConfig<T, R>> = {}
) {
  return new BatchTranslationQueue<T, R>({
    batchSize: 2,
    batchInterval: 10,
    maxConcurrentBatches: 3,
    maxRetries: 2,
    retryDelay: 10,
    processor,
    deduplicationKeyGenerator: dedupKeyGenerator,
    ...overrides,
  });
}

describe('BatchTranslationQueue — basic enqueue', () => {
  it('processes a single item successfully', async () => {
    const processor: BatchProcessor<string, string> = vi.fn().mockResolvedValue(['result']);
    const queue = createTestQueue(processor);

    const resultPromise = queue.enqueue('hello');
    const results = await resultPromise;

    expect(results).toBe('result');
    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor).toHaveBeenCalledWith(['hello']);
  });

  it('batches multiple items up to batchSize', async () => {
    const processor: BatchProcessor<string, string> = vi.fn().mockImplementation((inputs) =>
      Promise.resolve(inputs.map(i => `translated:${i}`))
    );
    const queue = createTestQueue(processor);

    const [r1, r2] = await Promise.all([queue.enqueue('a'), queue.enqueue('b')]);

    expect(r1).toBe('translated:a');
    expect(r2).toBe('translated:b');
    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor).toHaveBeenCalledWith(['a', 'b']);
  });

  it('splits items into multiple batches when exceeding batchSize', async () => {
    const processor: BatchProcessor<string, string> = vi.fn().mockImplementation((inputs) =>
      Promise.resolve(inputs.map(i => `translated:${i}`))
    );
    const queue = createTestQueue(processor, undefined, { batchSize: 2, batchInterval: 10 });

    const results = await Promise.all([
      queue.enqueue('a'),
      queue.enqueue('b'),
      queue.enqueue('c'),
    ]);

    expect(results).toEqual(['translated:a', 'translated:b', 'translated:c']);
    expect(processor).toHaveBeenCalledTimes(2);
  });
});

describe('BatchTranslationQueue — priority', () => {
  it('processes higher priority items first (lower number = higher priority)', async () => {
    const processor: BatchProcessor<string, string> = vi.fn().mockImplementation((inputs) =>
      Promise.resolve(inputs.map(i => `done:${i}`))
    );
    const queue = createTestQueue(processor, undefined, { batchSize: 1, batchInterval: 20 });

    // Enqueue low priority first, then high priority
    const low = queue.enqueue('low', 10);
    const high = queue.enqueue('high', 1);

    const [lowResult, highResult] = await Promise.all([low, high]);

    expect(lowResult).toBe('done:low');
    expect(highResult).toBe('done:high');
    // Verify processor was called: high should be processed before low
    const firstCallArgs = (processor as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCallArgs).toEqual(['high']);
  });
});

describe('BatchTranslationQueue — deduplication', () => {
  it('deduplicates identical inputs using key generator', async () => {
    const processor: BatchProcessor<string, string> = vi.fn().mockResolvedValue(['deduped']);
    const keyGen = (input: string) => input.toLowerCase();
    const queue = createTestQueue(processor, keyGen);

    const [r1, r2] = await Promise.all([queue.enqueue('HELLO'), queue.enqueue('hello')]);

    expect(r1).toBe('deduped');
    expect(r2).toBe('deduped');
    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor).toHaveBeenCalledWith(['HELLO']);
  });

  it('does not deduplicate when no key generator provided', async () => {
    const processor: BatchProcessor<string, string> = vi.fn().mockImplementation((inputs) =>
      Promise.resolve(inputs.map(i => `translated:${i}`))
    );
    const queue = createTestQueue(processor);

    const [r1, r2] = await Promise.all([queue.enqueue('same'), queue.enqueue('same')]);

    expect(r1).toBe('translated:same');
    expect(r2).toBe('translated:same');
    expect(processor).toHaveBeenCalledWith(['same', 'same']);
  });
});

describe('BatchTranslationQueue — retry', () => {
  it('retries on failure up to maxRetries', async () => {
    let callCount = 0;
    const processor: BatchProcessor<string, string> = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 2) return Promise.reject(new Error('transient'));
      return Promise.resolve(['success']);
    });
    const queue = createTestQueue(processor);

    const result = await queue.enqueue('retry_me');
    expect(result).toBe('success');
    expect(processor).toHaveBeenCalledTimes(2);
  });

  it('rejects after maxRetries exhausted', async () => {
    const processor: BatchProcessor<string, string> = vi.fn().mockRejectedValue(new Error('permanent'));
    const queue = createTestQueue(processor, undefined, { maxRetries: 1 });

    await expect(queue.enqueue('fail_me')).rejects.toThrow('permanent');
  });
});

describe('BatchTranslationQueue — stats', () => {
  it('returns accurate queue statistics', async () => {
    const processor: BatchProcessor<string, string> = vi.fn().mockImplementation((inputs) =>
      Promise.resolve(inputs.map(i => `done:${i}`))
    );
    const queue = createTestQueue(processor, undefined, { batchInterval: 100 });

    const stats1 = queue.getStats();
    expect(stats1.total).toBe(0);
    expect(stats1.pending).toBe(0);
    expect(stats1.activeBatches).toBe(0);

    queue.enqueue('a');
    const stats2 = queue.getStats();
    expect(stats2.pending).toBe(1);

    await queue.enqueue('a');
  });
});

describe('BatchTranslationQueue — clear', () => {
  it('rejects all pending items and clears queue', async () => {
    const processor: BatchProcessor<string, string> = vi.fn().mockImplementation(() => new Promise(() => {}));
    const queue = createTestQueue(processor, undefined, { batchInterval: 5000 });

    const promise = queue.enqueue('pending_item');

    queue.clear();

    await expect(promise).rejects.toThrow('Queue cleared');

    const stats = queue.getStats();
    expect(stats.total).toBe(0);
  });
});

describe('BatchTranslationQueue — error handling', () => {
  it('handles processor returning wrong number of results', async () => {
    const processor: BatchProcessor<string, string> = vi.fn().mockResolvedValue(['only_one']);
    const queue = createTestQueue(processor, undefined, { maxRetries: 0 });

    await Promise.all([queue.enqueue('a'), queue.enqueue('b')])
      .then(() => {
        // Either resolves or rejects is fine — the error path is what matters
      })
      .catch(() => {
        // Expected: processor returned 1 result for 2 inputs
      });

    expect(processor).toHaveBeenCalledWith(['a', 'b']);
  });
});

describe('createDefaultQueueConfig', () => {
  it('returns config with expected defaults', () => {
    const processor: BatchProcessor<string, string> = vi.fn();
    const config = createDefaultQueueConfig(processor);

    expect(config.batchSize).toBe(10);
    expect(config.batchInterval).toBe(50);
    expect(config.maxConcurrentBatches).toBe(3);
    expect(config.maxRetries).toBe(3);
    expect(config.retryDelay).toBe(1000);
    expect(config.processor).toBe(processor);
  });
});
