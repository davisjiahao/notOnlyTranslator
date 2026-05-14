/**
 * 批量翻译服务测试
 *
 * 重点测试纯函数部分：splitIntoBatches、BATCH_RETRY_OPTIONS
 * translateBatch 有复杂的存储/缓存/API 依赖，通过 integration 测试覆盖
 */

import { describe, it, expect } from 'vitest';
import { BatchTranslationService, BATCH_RETRY_OPTIONS } from '@/background/batchTranslation';

describe('BatchTranslationService.splitIntoBatches', () => {
  function makePara(id: string, text: string) {
    return { id, text, elementPath: `#el-${id}` };
  }

  it('returns single batch for small input', () => {
    const paragraphs = [makePara('a', 'Hello world'), makePara('b', 'Another paragraph')];
    const batches = BatchTranslationService.splitIntoBatches(paragraphs);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('splits when exceeding max paragraphs per batch (15)', () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      makePara(String(i), `Paragraph ${i}`)
    );

    const batches = BatchTranslationService.splitIntoBatches(paragraphs);

    expect(batches.length).toBeGreaterThan(1);
    expect(batches[0]).toHaveLength(15); // maxParagraphsPerBatch = 15
    expect(batches[1]).toHaveLength(5);
  });

  it('splits when exceeding max chars per batch (10000)', () => {
    // Each paragraph is 3000 chars, so 4 paragraphs = 12000 chars > 10000
    const longText = 'x'.repeat(3000);
    const paragraphs = [
      makePara('a', longText),
      makePara('b', longText),
      makePara('c', longText),
      makePara('d', longText),
    ];

    const batches = BatchTranslationService.splitIntoBatches(paragraphs);

    expect(batches.length).toBeGreaterThan(1);
    // First batch should fit 3 paragraphs (9000 chars < 10000)
    expect(batches[0].length).toBeLessThanOrEqual(3);
  });

  it('handles empty input', () => {
    const batches = BatchTranslationService.splitIntoBatches([]);
    expect(batches).toHaveLength(0);
  });

  it('preserves paragraph order within batches', () => {
    const paragraphs = [
      makePara('first', 'First paragraph'),
      makePara('second', 'Second paragraph'),
      makePara('third', 'Third paragraph'),
    ];

    const batches = BatchTranslationService.splitIntoBatches(paragraphs);

    expect(batches).toHaveLength(1);
    expect(batches[0].map(p => p.id)).toEqual(['first', 'second', 'third']);
  });

  it('handles single paragraph', () => {
    const paragraphs = [makePara('only', 'Just one')];
    const batches = BatchTranslationService.splitIntoBatches(paragraphs);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });

  it('splits correctly at boundary of char limit with long first para', () => {
    // First para is 9999 chars, second is 2 chars. Together = 10001 > 10000
    const paragraphs = [
      makePara('long', 'x'.repeat(9999)),
      makePara('short', 'ab'),
    ];

    const batches = BatchTranslationService.splitIntoBatches(paragraphs);

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(1);
    expect(batches[1]).toHaveLength(1);
  });
});

describe('BATCH_RETRY_OPTIONS', () => {
  it('has expected retry configuration', () => {
    expect(BATCH_RETRY_OPTIONS.maxRetries).toBe(3);
    expect(BATCH_RETRY_OPTIONS.initialDelay).toBe(800);
    expect(BATCH_RETRY_OPTIONS.backoffMultiplier).toBe(2);
    expect(BATCH_RETRY_OPTIONS.maxDelay).toBe(10000);
    expect(typeof BATCH_RETRY_OPTIONS.onRetry).toBe('function');
  });
});
