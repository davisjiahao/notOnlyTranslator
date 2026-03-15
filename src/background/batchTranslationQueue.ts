/**
 * 批量翻译队列管理系统
 * 提供请求排队、去重、合并和批量处理功能
 */

import { logger } from '@/shared/utils/logger';

// 队列项状态
enum QueueItemStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// 队列项
interface QueueItem<T, R> {
  id: string;
  input: T;
  status: QueueItemStatus;
  priority: number;
  createdAt: number;
  processingAt?: number;
  completedAt?: number;
  result?: R;
  error?: Error;
  retries: number;
  resolve: (value: R) => void;
  reject: (reason: Error) => void;
}

// 批量处理器类型
export type BatchProcessor<T, R> = (inputs: T[]) => Promise<R[]>;

// 去重键生成器类型
export type DeduplicationKeyGenerator<T> = (input: T) => string;

// 队列配置
export interface BatchQueueConfig<T, R> {
  // 批量处理大小
  batchSize: number;
  // 批量处理间隔（毫秒）
  batchInterval: number;
  // 最大并发批次数
  maxConcurrentBatches: number;
  // 最大重试次数
  maxRetries: number;
  // 重试延迟（毫秒）
  retryDelay: number;
  // 批量处理器
  processor: BatchProcessor<T, R>;
  // 去重键生成器（可选）
  deduplicationKeyGenerator?: DeduplicationKeyGenerator<T>;
}

/**
 * 批量翻译队列管理器
 * 支持请求排队、去重、合并和批量处理
 */
export class BatchTranslationQueue<T, R> {
  private queue: Map<string, QueueItem<T, R>> = new Map();
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  private activeBatches: number = 0;
  private deduplicationMap: Map<string, string> = new Map(); // key -> itemId

  constructor(private config: BatchQueueConfig<T, R>) {}

  /**
   * 添加翻译请求到队列
   * @param input 输入数据
   * @param priority 优先级（数字越小优先级越高）
   * @returns Promise<R> 翻译结果
   */
  public enqueue(input: T, priority: number = 0): Promise<R> {
    return new Promise((resolve, reject) => {
      // 检查去重
      if (this.config.deduplicationKeyGenerator) {
        const dedupKey = this.config.deduplicationKeyGenerator(input);
        const existingId = this.deduplicationMap.get(dedupKey);

        if (existingId) {
          const existingItem = this.queue.get(existingId);
          if (existingItem && existingItem.status !== QueueItemStatus.FAILED) {
            // 复用现有请求
            logger.debug(`Deduplicating request: ${dedupKey}`);
            if (existingItem.status === QueueItemStatus.COMPLETED) {
              resolve(existingItem.result!);
            } else {
              // 等待现有请求完成
              this.attachToExistingRequest(existingItem, resolve, reject);
            }
            return;
          }
        }
      }

      // 创建新队列项
      const id = this.generateId();
      const item: QueueItem<T, R> = {
        id,
        input,
        status: QueueItemStatus.PENDING,
        priority,
        createdAt: Date.now(),
        retries: 0,
        resolve,
        reject,
      };

      this.queue.set(id, item);

      // 更新去重映射
      if (this.config.deduplicationKeyGenerator) {
        const dedupKey = this.config.deduplicationKeyGenerator(input);
        this.deduplicationMap.set(dedupKey, id);
      }

      logger.debug(`Enqueued item: ${id}, queue size: ${this.queue.size}`);

      // 启动处理
      this.scheduleBatch();
    });
  }

  /**
   * 附加到现有请求
   */
  private attachToExistingRequest(
    item: QueueItem<T, R>,
    resolve: (value: R) => void,
    reject: (reason: Error) => void
  ): void {
    // 保存原始 resolve/reject
    const originalResolve = item.resolve;
    const originalReject = item.reject;

    // 包装以同时调用新的 resolve/reject
    item.resolve = (value: R) => {
      originalResolve(value);
      resolve(value);
    };
    item.reject = (reason: Error) => {
      originalReject(reason);
      reject(reason);
    };
  }

  /**
   * 调度批处理
   */
  private scheduleBatch(): void {
    if (this.batchTimeout) {
      return; // 已经调度了
    }

    this.batchTimeout = setTimeout(() => {
      this.batchTimeout = null;
      this.processBatch();
    }, this.config.batchInterval);
  }

  /**
   * 处理批次
   */
  private async processBatch(): Promise<void> {
    if (this.activeBatches >= this.config.maxConcurrentBatches) {
      // 并发批次已满，稍后重试
      this.scheduleBatch();
      return;
    }

    // 获取待处理的项
    const pendingItems = Array.from(this.queue.values())
      .filter(item => item.status === QueueItemStatus.PENDING)
      .sort((a, b) => {
        // 先按优先级排序，再按创建时间排序
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.createdAt - b.createdAt;
      })
      .slice(0, this.config.batchSize);

    if (pendingItems.length === 0) {
      return; // 没有待处理的项
    }

    // 标记为处理中
    pendingItems.forEach(item => {
      item.status = QueueItemStatus.PROCESSING;
      item.processingAt = Date.now();
    });

    this.activeBatches++;

    try {
      logger.debug(`Processing batch of ${pendingItems.length} items`);

      // 调用批量处理器
      const inputs = pendingItems.map(item => item.input);
      const results = await this.config.processor(inputs);

      // 检查结果数量
      if (results.length !== pendingItems.length) {
        throw new Error(`Processor returned ${results.length} results for ${pendingItems.length} inputs`);
      }

      // 分配结果
      pendingItems.forEach((item, index) => {
        item.status = QueueItemStatus.COMPLETED;
        item.completedAt = Date.now();
        item.result = results[index];
        item.resolve(results[index]);
      });

      logger.debug(`Batch completed successfully`);

    } catch (error) {
      logger.error(`Batch processing failed:`, error);

      // 处理失败
      pendingItems.forEach(item => {
        this.handleItemError(item, error as Error);
      });

    } finally {
      this.activeBatches--;

      // 清理已完成的项
      this.cleanupCompletedItems();

      // 继续处理更多批次
      if (this.hasPendingItems()) {
        this.scheduleBatch();
      }
    }
  }

  /**
   * 处理项错误
   */
  private handleItemError(item: QueueItem<T, R>, error: Error): void {
    if (item.retries < this.config.maxRetries) {
      // 重试
      item.retries++;
      item.status = QueueItemStatus.PENDING;
      logger.debug(`Retrying item ${item.id}, attempt ${item.retries}`);
    } else {
      // 标记为失败
      item.status = QueueItemStatus.FAILED;
      item.error = error;
      item.reject(error);
    }
  }

  /**
   * 清理已完成的项
   */
  private cleanupCompletedItems(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5分钟

    for (const [id, item] of this.queue.entries()) {
      if (item.status === QueueItemStatus.COMPLETED || item.status === QueueItemStatus.FAILED) {
        if (item.completedAt && (now - item.completedAt > maxAge)) {
          this.queue.delete(id);

          // 清理去重映射
          if (this.config.deduplicationKeyGenerator) {
            const dedupKey = this.config.deduplicationKeyGenerator(item.input);
            if (this.deduplicationMap.get(dedupKey) === id) {
              this.deduplicationMap.delete(dedupKey);
            }
          }
        }
      }
    }
  }

  /**
   * 检查是否有待处理的项
   */
  private hasPendingItems(): boolean {
    return Array.from(this.queue.values()).some(
      item => item.status === QueueItemStatus.PENDING
    );
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 获取队列统计信息
   */
  public getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    activeBatches: number;
  } {
    const items = Array.from(this.queue.values());
    return {
      total: items.length,
      pending: items.filter(i => i.status === QueueItemStatus.PENDING).length,
      processing: items.filter(i => i.status === QueueItemStatus.PROCESSING).length,
      completed: items.filter(i => i.status === QueueItemStatus.COMPLETED).length,
      failed: items.filter(i => i.status === QueueItemStatus.FAILED).length,
      activeBatches: this.activeBatches,
    };
  }

  /**
   * 清空队列
   */
  public clear(): void {
    // 拒绝所有待处理和正在处理的项
    for (const item of this.queue.values()) {
      if (item.status === QueueItemStatus.PENDING || item.status === QueueItemStatus.PROCESSING) {
        item.reject(new Error('Queue cleared'));
      }
    }

    this.queue.clear();
    this.deduplicationMap.clear();

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
  }
}

/**
 * 创建默认队列配置
 */
export function createDefaultQueueConfig<T, R>(
  processor: BatchProcessor<T, R>
): BatchQueueConfig<T, R> {
  return {
    batchSize: 10,
    batchInterval: 50, // 50ms
    maxConcurrentBatches: 3,
    maxRetries: 3,
    retryDelay: 1000,
    processor,
  };
}
