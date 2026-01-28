import type {
  Message,
  MessageResponse,
  BatchTranslationRequest,
  BatchTranslationResponse,
  BatchParagraphResult,
  TranslationMode,
  TranslationResult,
} from '@/shared/types';
import { DEFAULT_BATCH_CONFIG } from '@/shared/constants';
import type { VisibleParagraph } from './viewportObserver';
import { TranslationDisplay } from './translationDisplay';

/**
 * 翻译完成回调
 */
export type TranslationCompleteCallback = (
  element: HTMLElement,
  result: TranslationResult
) => void;

/**
 * 待处理的段落请求
 */
interface PendingParagraph extends VisibleParagraph {
  /** 请求时间戳 */
  requestedAt: number;
}

/**
 * 批量翻译管理器
 *
 * 职责：
 * - 收集可视区域内的段落
 * - 将多个段落合并为批量请求
 * - 并发处理翻译批次（解决滑动时的堵塞问题）
 * - 分发翻译结果
 */
export class BatchTranslationManager {
  private mode: TranslationMode = 'inline-only';
  private pageUrl: string;
  private onComplete: TranslationCompleteCallback | null = null;

  /** 正在处理中的段落 ID 集合 */
  private processingParagraphIds: Set<string> = new Set();
  /** 待处理的段落队列 */
  private pendingQueue: PendingParagraph[] = [];

  /** 当前活跃的并发请求数 */
  private activeRequests = 0;
  /** 最大并发批次数 */
  private readonly MAX_CONCURRENT_BATCHES = 3;

  constructor() {
    this.pageUrl = window.location.href;
  }

  /**
   * 处理可视区域段落变化
   */
  async handleVisibleParagraphs(paragraphs: VisibleParagraph[]): Promise<void> {
    if (paragraphs.length === 0) return;

    // 过滤掉已在处理中或已翻译过的段落
    const newParagraphs = paragraphs.filter((p) => {
      if (this.processingParagraphIds.has(p.id)) return false;
      if (p.element.classList.contains('not-translator-processed')) return false;
      return true;
    });

    if (newParagraphs.length === 0) return;

    const now = Date.now();
    for (const p of newParagraphs) {
      const pending: PendingParagraph = { ...p, requestedAt: now };
      // LIFO 模式：优先处理新进入视口的段落
      this.pendingQueue.unshift(pending);
      this.processingParagraphIds.add(p.id);
    }

    // 启动处理循环（如果未达到并发上限）
    this.processNextBatches();
  }

  /**
   * 调度并执行并发批次
   */
  private async processNextBatches(): Promise<void> {
    if (this.pendingQueue.length === 0 || this.activeRequests >= this.MAX_CONCURRENT_BATCHES) {
      return;
    }

    // 只要有并发名额且队列不为空，就继续发起请求
    while (this.activeRequests < this.MAX_CONCURRENT_BATCHES && this.pendingQueue.length > 0) {
      // 提取一批段落
      const batch = this.extractNextBatch();
      if (batch.length === 0) break;

      // 异步执行批次（不使用 await，以实现并发）
      this.activeRequests++;
      this.processBatch(batch).finally(() => {
        this.activeRequests--;
        // 一个批次完成后，递归尝试处理下一个批次
        this.processNextBatches();
      });
    }
  }

  /**
   * 从队列中提取符合配置限制的一批段落
   */
  private extractNextBatch(): PendingParagraph[] {
    const batch: PendingParagraph[] = [];
    let currentChars = 0;

    while (this.pendingQueue.length > 0) {
      const next = this.pendingQueue[0];
      const nextLen = next.text.length;

      // 检查批次限制
      if (
        batch.length >= DEFAULT_BATCH_CONFIG.maxParagraphsPerBatch ||
        currentChars + nextLen > DEFAULT_BATCH_CONFIG.maxCharsPerBatch
      ) {
        break;
      }

      batch.push(this.pendingQueue.shift()!);
      currentChars += nextLen;
    }

    return batch;
  }

  /**
   * 处理单批段落（发送到后台并应用结果）
   */
  private async processBatch(paragraphs: PendingParagraph[]): Promise<void> {
    console.log(`BatchTranslationManager: 并发处理批次 (${paragraphs.length} 段)`);

    // 显示 Loading
    paragraphs.forEach(p => TranslationDisplay.showLoading(p.element));

    const request: BatchTranslationRequest = {
      paragraphs: paragraphs.map(p => ({ id: p.id, text: p.text, elementPath: p.elementPath })),
      mode: this.mode,
      pageUrl: this.pageUrl,
    };

    try {
      const response = await this.sendBatchRequest(request);

      if (response.success && response.data) {
        this.distributeResults(paragraphs, response.data.results);
      } else {
        console.error('BatchTranslationManager: 批量翻译失败', response.error);
        this.clearParagraphsStatus(paragraphs);
      }
    } catch (error) {
      console.error('BatchTranslationManager: 网络异常', error);
      this.clearParagraphsStatus(paragraphs);
    } finally {
      // 确保移除 Loading
      paragraphs.forEach(p => TranslationDisplay.removeLoading(p.element));
    }
  }

  /**
   * 分发结果并渲染
   */
  private distributeResults(paragraphs: PendingParagraph[], results: BatchParagraphResult[]): void {
    const resultMap = new Map(results.map(r => [r.id, r]));

    for (const para of paragraphs) {
      const result = resultMap.get(para.id);
      TranslationDisplay.removeLoading(para.element);

      if (result && result.result) {
        if (!document.body.contains(para.element)) continue;

        TranslationDisplay.saveOriginalText(para.element);

        if (result.result.words.length > 0 || result.result.fullText || (result.result.grammarPoints?.length || 0) > 0) {
          TranslationDisplay.applyTranslation(para.element, result.result, this.mode);
          if (this.onComplete) this.onComplete(para.element, result.result);
        } else {
          // 无生词也标记为处理完成
          para.element.classList.add('not-translator-processed');
        }
      }
    }
  }

  /**
   * 清除失败段落的处理状态，允许重试
   */
  private clearParagraphsStatus(paragraphs: PendingParagraph[]): void {
    for (const para of paragraphs) {
      this.processingParagraphIds.delete(para.id);
    }
  }

  /**
   * 发送批量翻译请求到后台
   */
  private async sendBatchRequest(
    request: BatchTranslationRequest
  ): Promise<MessageResponse<BatchTranslationResponse>> {
    return new Promise((resolve) => {
      const message: Message<BatchTranslationRequest> = {
        type: 'BATCH_TRANSLATE_TEXT',
        payload: request,
      };

      chrome.runtime.sendMessage(message, (response: MessageResponse<BatchTranslationResponse>) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message,
          });
        } else {
          resolve(response || { success: false, error: 'No response' });
        }
      });
    });
  }

  /**
   * 检查段落是否正在处理中
   */
  isProcessing(paragraphId: string): boolean {
    return this.processingParagraphs.has(paragraphId);
  }

  /**
   * 获取当前处理中的段落数量
   */
  getProcessingCount(): number {
    return this.processingParagraphs.size;
  }

  /**
   * 取消所有待处理请求
   */
  cancelAll(): void {
    this.pendingQueue = [];
    this.processingParagraphs.clear();
    console.log('BatchTranslationManager: 已取消所有待处理请求');
  }

  /**
   * 清理过期的处理中段落
   * 避免因为某些原因导致段落一直处于处理中状态
   */
  cleanupStale(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 60秒

    for (const [id, para] of this.processingParagraphs) {
      if (now - para.requestedAt > staleThreshold) {
        this.processingParagraphs.delete(id);
        console.log(`BatchTranslationManager: 清理过期段落 ${id}`);
      }
    }
  }

  /**
   * 清除已处理缓存（用于翻译模式切换后重新翻译）
   */
  clearProcessedCache(): void {
    this.pendingQueue = [];
    this.processingParagraphs.clear();
    console.log('BatchTranslationManager: 已清除处理缓存');
  }
}
