/**
 * 在途批次去重表（跨页面刷新复用）单元测试
 *
 * 契约：
 * - 段落缓存键（scope+原文）相同的并发请求 join 现有共享 Promise，只外发一次；
 * - 页面刷新（无取消信号）后旧请求继续完成并写缓存，新页面经 join 拿到同一结果对象；
 * - 不同键互不干扰；settle 后条目移除，防泄漏；
 * - 发起方取消（如 popup 暂停）沿既有取消路径传播，join 方收到失败而非假成功。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchTranslationRequest, BatchTranslationResponse } from '@/shared/types';

// 只 mock外发服务与存储，被测模块本身真实执行
vi.mock('@/background/batchTranslation', () => ({
  BatchTranslationService: { translateBatch: vi.fn() },
}));
vi.mock('@/background/storage', () => ({
  StorageManager: {
    getUserProfile: vi.fn(),
    getSettings: vi.fn(),
    getApiKey: vi.fn(),
  },
}));
vi.mock('@/background/enhancedCache', () => ({
  enhancedCache: { generateHash: vi.fn(), setBatch: vi.fn() },
}));

import { BatchTranslationService } from '@/background/batchTranslation';
import { StorageManager } from '@/background/storage';
import { enhancedCache } from '@/background/enhancedCache';
import {
  clearInflightBatches,
  inflightBatchCount,
  translateBatchWithJoin,
} from '@/background/inflightBatchDedup';

const translateBatch = vi.mocked(BatchTranslationService.translateBatch);
const generateHash = vi.mocked(enhancedCache.generateHash);

/** 受控延迟响应 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const SAMPLE_RESULT = { words: [], sentences: [], fullText: '共享译文' };

function batchRequest(paragraphs: Array<{ id: string; text: string }>): BatchTranslationRequest {
  return {
    paragraphs,
    mode: 'bilingual',
    pageUrl: 'https://example.org',
    userLevel: { examType: 'cet4', examScore: 500, estimatedVocabulary: 4500 },
  } as BatchTranslationRequest;
}

/** 推进所有挂起微任务（模块内部有多级 await） */
function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  clearInflightBatches();
  vi.mocked(StorageManager.getUserProfile).mockResolvedValue({ estimatedVocabulary: 4500 } as never);
  vi.mocked(StorageManager.getSettings).mockResolvedValue({ apiProvider: 'openai' } as never);
  vi.mocked(StorageManager.getApiKey).mockResolvedValue('test-key');
  // 键构成复用段落缓存键：mode + 原文，确定性映射便于断言
  generateHash.mockImplementation((text: string, mode: string) => `hash:${mode}:${text}`);
});

describe('在途批次去重表', () => {
  it('同键并发请求只外发一次，join 方拿到同一结果对象（id 重映射）', async () => {
    const first = deferred<BatchTranslationResponse>();
    translateBatch.mockReturnValueOnce(first.promise);

    const a = translateBatchWithJoin(batchRequest([{ id: 'a1', text: 'Shared text' }]));
    await vi.waitFor(() => expect(inflightBatchCount()).toBe(1));
    expect(translateBatch).toHaveBeenCalledTimes(1);

    // 页面刷新后新页面重新入队：同文不同段落 id
    const b = translateBatchWithJoin(batchRequest([{ id: 'b1', text: 'Shared text' }]));
    await flushMicrotasks();
    expect(translateBatch).toHaveBeenCalledTimes(1); // 未重发外发请求

    first.resolve({
      results: [{ id: 'a1', result: SAMPLE_RESULT, cached: false }],
      apiCallCount: 1,
      cacheHitCount: 0,
    });
    const [responseA, responseB] = await Promise.all([a, b]);

    expect(responseA.results[0]?.id).toBe('a1');
    expect(responseB.results[0]?.id).toBe('b1'); // join 方段落 id 重映射
    expect(responseB.results[0]?.result).toBe(responseA.results[0]?.result); // 同一结果对象，不可变共享
    expect(inflightBatchCount()).toBe(0); // settle 后移除
  });

  it('不同键不互串：各自外发、各自结果', async () => {
    const first = deferred<BatchTranslationResponse>();
    const second = deferred<BatchTranslationResponse>();
    translateBatch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const a = translateBatchWithJoin(batchRequest([{ id: 'a1', text: 'Text X' }]));
    await vi.waitFor(() => expect(inflightBatchCount()).toBe(1));
    const b = translateBatchWithJoin(batchRequest([{ id: 'b1', text: 'Text Y' }]));
    await flushMicrotasks();

    expect(translateBatch).toHaveBeenCalledTimes(2);
    expect(translateBatch.mock.calls[1]?.[0]?.paragraphs).toEqual([{ id: 'b1', text: 'Text Y' }]);

    first.resolve({ results: [{ id: 'a1', result: SAMPLE_RESULT, cached: false }], apiCallCount: 1, cacheHitCount: 0 });
    second.resolve({ results: [{ id: 'b1', result: { words: [], sentences: [], fullText: 'Y 译文' }, cached: false }], apiCallCount: 1, cacheHitCount: 0 });
    const [responseA, responseB] = await Promise.all([a, b]);
    expect(responseA.results[0]?.result.fullText).toBe('共享译文');
    expect(responseB.results[0]?.result.fullText).toBe('Y 译文');
  });

  it('混合批：命中段落 join，未命中段落组成子批外发', async () => {
    const first = deferred<BatchTranslationResponse>();
    const second = deferred<BatchTranslationResponse>();
    translateBatch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const a = translateBatchWithJoin(batchRequest([{ id: 'a1', text: 'Text X' }]));
    await vi.waitFor(() => expect(inflightBatchCount()).toBe(1));

    const b = translateBatchWithJoin(batchRequest([{ id: 'b1', text: 'Text X' }, { id: 'b2', text: 'Text Y' }]));
    await flushMicrotasks();

    // 子批只包含未命中的新段落
    expect(translateBatch).toHaveBeenCalledTimes(2);
    expect(translateBatch.mock.calls[1]?.[0]?.paragraphs).toEqual([{ id: 'b2', text: 'Text Y' }]);

    first.resolve({ results: [{ id: 'a1', result: SAMPLE_RESULT, cached: false }], apiCallCount: 1, cacheHitCount: 0 });
    second.resolve({ results: [{ id: 'b2', result: { words: [], sentences: [], fullText: 'Y 译文' }, cached: false }], apiCallCount: 1, cacheHitCount: 0 });

    const [, responseB] = await Promise.all([a, b]);
    expect(responseB.results).toHaveLength(2);
    expect(responseB.results[0]?.id).toBe('b1');
    expect(responseB.results[0]?.result).toBe(SAMPLE_RESULT); // join 段落共享结果
    expect(responseB.results[1]?.id).toBe('b2');
    expect(responseB.results[1]?.result.fullText).toBe('Y 译文');
  });

  it('刷新模拟：旧请求无取消信号，join 方拿到同一结果（缓存写入证据由 pagehide 集成测试以真实 enhancedCache 路径守护）', async () => {
    const first = deferred<BatchTranslationResponse>();
    translateBatch.mockReturnValueOnce(first.promise);

    const a = translateBatchWithJoin(batchRequest([{ id: 'a1', text: 'Refreshed text' }]));
    await vi.waitFor(() => expect(inflightBatchCount()).toBe(1));

    // 页面刷新：内容脚本销毁不发取消；新页面重新入队同段落
    const b = translateBatchWithJoin(batchRequest([{ id: 'new-1', text: 'Refreshed text' }]));
    await flushMicrotasks();
    expect(translateBatch).toHaveBeenCalledTimes(1); // 旧请求继续在途，未重发

    first.resolve({
      results: [{ id: 'a1', result: SAMPLE_RESULT, cached: false }],
      apiCallCount: 1,
      cacheHitCount: 0,
    });
    const responseB = await b;
    await a;

    expect(responseB.results[0]?.id).toBe('new-1');
    expect(responseB.results[0]?.result).toBe(SAMPLE_RESULT); // 新页面拿到旧请求的同一结果
  });

  it('settle 后条目移除：后续同键请求退回重发路径', async () => {
    translateBatch.mockResolvedValueOnce({
      results: [{ id: 'a1', result: SAMPLE_RESULT, cached: false }],
      apiCallCount: 1,
      cacheHitCount: 0,
    });
    await translateBatchWithJoin(batchRequest([{ id: 'a1', text: 'Settled text' }]));
    expect(inflightBatchCount()).toBe(0);

    // 表已清空：同键请求重新走外发（真实场景此刻由缓存命中兜底）
    translateBatch.mockResolvedValueOnce({
      results: [{ id: 'c1', result: SAMPLE_RESULT, cached: false }],
      apiCallCount: 1,
      cacheHitCount: 0,
    });
    const responseC = await translateBatchWithJoin(batchRequest([{ id: 'c1', text: 'Settled text' }]));
    expect(translateBatch).toHaveBeenCalledTimes(2);
    expect(responseC.results[0]?.id).toBe('c1');
    expect(inflightBatchCount()).toBe(0);
  });

  it('服务同步通知并立即完成时，订阅已建立且最终不会覆盖首次结果', async () => {
    const onParagraph = vi.fn();
    translateBatch.mockImplementationOnce(async (_request, options) => {
      options?.onParagraph?.({ id: 'a1', result: SAMPLE_RESULT, cached: false });
      return { results: [{ id: 'a1', result: { ...SAMPLE_RESULT, fullText: '最终重复值' }, cached: false }], apiCallCount: 1, cacheHitCount: 0 };
    });
    const response = await translateBatchWithJoin(batchRequest([{ id: 'a1', text: 'Immediate result' }]), { onParagraph });
    expect(onParagraph).toHaveBeenCalledExactlyOnceWith({ id: 'a1', result: SAMPLE_RESULT, cached: false });
    expect(response.results[0].result).toBe(SAMPLE_RESULT);
    expect(inflightBatchCount()).toBe(0);
  });

  it.each([
    [],
    [{ id: 'unknown', result: SAMPLE_RESULT, cached: false }],
    [{ id: 'a1', result: SAMPLE_RESULT, cached: false }, { id: 'a1', result: SAMPLE_RESULT, cached: false }],
  ])('最终结果缺失、未知或重复 ID 时失败并清表：%j', async (...results) => {
    translateBatch.mockResolvedValueOnce({ results, apiCallCount: 1, cacheHitCount: 0 });
    await expect(translateBatchWithJoin(batchRequest([{ id: 'a1', text: 'Invalid response' }]))).rejects.toThrow('批量翻译响应');
    expect(inflightBatchCount()).toBe(0);
  });

  it('发起方取消沿既有取消路径传播，join 方收到失败而非假成功，且表随即清空', async () => {
    translateBatch.mockImplementation((_request, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('翻译请求已取消', 'AbortError'));
        }, { once: true });
      }));

    const controller = new AbortController();
    const a = translateBatchWithJoin(batchRequest([{ id: 'a1', text: 'Cancelled text' }]), { signal: controller.signal });
    await vi.waitFor(() => expect(inflightBatchCount()).toBe(1));

    const b = translateBatchWithJoin(batchRequest([{ id: 'b1', text: 'Cancelled text' }]));
    await flushMicrotasks();
    expect(translateBatch).toHaveBeenCalledTimes(1);

    controller.abort(); // 发起方取消（popup 暂停 / 配置变化等既有路径）
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    await expect(b).rejects.toMatchObject({ name: 'AbortError' }); // join 方不假成功
    expect(inflightBatchCount()).toBe(0); // 取消 settle 后同样移除
  });
});
