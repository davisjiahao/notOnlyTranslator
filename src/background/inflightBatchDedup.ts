import type {
  BatchParagraphResult,
  BatchTranslationRequest,
  BatchTranslationResponse,
  UserSettings,
} from '@/shared/types';
import { StorageManager } from './storage';
import { BatchTranslationService, type BatchTranslationOptions } from './batchTranslation';
import { enhancedCache } from './enhancedCache';
import { logger } from '@/shared/utils';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // 首段已经交付后，尾段仍可能失败；无人订阅的拒绝也必须被消费。
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function createEntry(done: Promise<BatchTranslationResponse>) {
  const paragraph = deferred<BatchParagraphResult>();
  const listeners = new Set<(result: BatchParagraphResult) => void>();
  let accepted: BatchParagraphResult | undefined;
  return {
    done,
    promise: paragraph.promise,
    publish(result: BatchParagraphResult): void {
      if (accepted) return;
      accepted = result;
      paragraph.resolve(result);
      for (const listener of listeners) listener(result);
    },
    subscribe(listener: (result: BatchParagraphResult) => void): () => void {
      listeners.add(listener);
      if (accepted) listener(accepted);
      return () => { listeners.delete(listener); };
    },
    close(error?: unknown): void {
      if (!accepted) paragraph.reject(error ?? new Error('批量翻译响应缺少段落结果'));
      listeners.clear();
    },
  };
}

// 段落可提前交付，但条目保留到整批及缓存写入结束，刷新才能重放已完成段落。
const inflight = new Map<string, ReturnType<typeof createEntry>>();

export function inflightBatchCount(): number {
  return inflight.size;
}

export function clearInflightBatches(): void {
  inflight.clear();
}

export async function translateBatchWithJoin(
  request: BatchTranslationRequest,
  options?: BatchTranslationOptions
): Promise<BatchTranslationResponse> {
  let keys: string[];
  let snapshot: { settings: UserSettings; apiKey: string };
  let scopedRequest = request;
  try {
    const [userProfile, settings] = await Promise.all([
      request.userLevel || StorageManager.getUserProfile(),
      StorageManager.getSettings(),
    ]);
    options?.signal?.throwIfAborted();
    const apiKey = await StorageManager.getApiKey(settings);
    options?.signal?.throwIfAborted();
    snapshot = { settings, apiKey };
    scopedRequest = { ...request, userLevel: userProfile };
    keys = request.paragraphs.map(p => enhancedCache.generateHash(p.text, request.mode, {
      settings, userLevel: userProfile, context: apiKey, engine: 'batch',
    }));
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    logger.warn('InflightBatchDedup: 段落缓存键计算失败，本次跳过在途去重');
    return BatchTranslationService.translateBatch(request, options);
  }

  const ownBatch = deferred<BatchTranslationResponse>();
  const fresh = new Map<string, { key: string; index: number; entry: ReturnType<typeof createEntry> }>();
  const entries = request.paragraphs.map((paragraph, index) => {
    const key = keys[index];
    const existing = inflight.get(key);
    if (existing) return existing;
    const entry = createEntry(ownBatch.promise);
    inflight.set(key, entry);
    fresh.set(paragraph.id, { key, index, entry });
    return entry;
  });
  const unsubscribers = entries.map((entry, index) => entry.subscribe(result => {
    if (options?.signal?.aborted) return;
    try {
      options?.onParagraph?.({ ...result, id: request.paragraphs[index].id });
    } catch {
      // 消费方失效不能取消共享上游或阻断其他页面订阅。
    }
  }));

  if (fresh.size > 0) {
    const subRequest = { ...scopedRequest, paragraphs: [...fresh.values()].map(({ index }) => request.paragraphs[index]) };
    const finish = (error?: unknown) => {
      for (const { key, entry } of fresh.values()) {
        entry.close(error);
        if (inflight.get(key) === entry) inflight.delete(key);
      }
    };
    void Promise.resolve().then(() => BatchTranslationService.translateBatch(subRequest, {
      ...options,
      onParagraph: result => { fresh.get(result.id)?.entry.publish(result); },
    }, snapshot)).then(response => {
      if (response.results.length !== fresh.size
        || new Set(response.results.map(result => result.id)).size !== fresh.size
        || response.results.some(result => !fresh.has(result.id))) {
        throw new Error('批量翻译响应缺少段落结果或段落 ID 无效');
      }
      for (const result of response.results) fresh.get(result.id)!.entry.publish(result);
      finish();
      ownBatch.resolve(response);
    }).catch(error => {
      finish(error);
      ownBatch.reject(error);
    });
  }

  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(options?.signal?.reason);
    options?.signal?.addEventListener('abort', onAbort, { once: true });
    if (options?.signal?.aborted) onAbort();
  });
  try {
    const completed = Promise.all([
      Promise.all(entries.map((entry, index) => entry.promise.then(result => ({ ...result, id: request.paragraphs[index].id })))),
      Promise.all([...new Set(entries.map(entry => entry.done))]),
    ] as const);
    const [results] = await Promise.race([completed, aborted]);
    const ownResponse = fresh.size > 0 ? await ownBatch.promise : undefined;
    return {
      results,
      apiCallCount: ownResponse?.apiCallCount ?? 0,
      cacheHitCount: request.paragraphs.length - fresh.size + (ownResponse?.cacheHitCount ?? 0),
    };
  } finally {
    options?.signal?.removeEventListener('abort', onAbort);
    for (const unsubscribe of unsubscribers) unsubscribe();
  }
}
