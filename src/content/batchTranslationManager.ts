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
 * - 过滤已缓存的段落
 * - 将多个段落合并为批量请求
 * - 分发翻译结果到对应段落
 */
export class BatchTranslationManager {
  /** 翻译模式 */
  private mode: TranslationMode = 'inline-only';

  /** 当前页面URL */
  private pageUrl: string;

  /** 正在处理中的段落 */
  private processingParagraphs: Map<string, PendingParagraph> = new Map();

  /** 翻译完成回调 */
  private onComplete: TranslationCompleteCallback | null = null;

  /** 是否正在进行批量请求 */
  private isRequesting: boolean = false;

  /** 等待处理的段落队列 */
  private pendingQueue: PendingParagraph[] = [];

  constructor() {
    this.pageUrl = window.location.href;
  }

  /**
   * 设置翻译模式
   */
  setMode(mode: TranslationMode): void {
    this.mode = mode;
  }

  /**
   * 设置翻译完成回调
   */
  setOnComplete(callback: TranslationCompleteCallback): void {
    this.onComplete = callback;
  }

  /**
   * 处理可视区域段落变化
   * 由 ViewportObserver 调用
   */
  async handleVisibleParagraphs(paragraphs: VisibleParagraph[]): Promise<void> {
    if (paragraphs.length === 0) return;

    console.log(`BatchTranslationManager: 收到 ${paragraphs.length} 个可视段落`);

    // 过滤掉已经在处理中的段落
    const newParagraphs = paragraphs.filter((p) => {
      // 检查是否已在处理中
      if (this.processingParagraphs.has(p.id)) {
        return false;
      }
      // 检查元素是否已处理
      if (p.element.classList.contains('not-translator-processed')) {
        return false;
      }
      return true;
    });

    if (newParagraphs.length === 0) {
      console.log('BatchTranslationManager: 没有新段落需要处理');
      return;
    }

    // 添加到待处理队列
    const now = Date.now();
    for (const p of newParagraphs) {
      const pending: PendingParagraph = {
        ...p,
        requestedAt: now,
      };
      this.pendingQueue.push(pending);
      this.processingParagraphs.set(p.id, pending);
    }

    console.log(`BatchTranslationManager: 添加 ${newParagraphs.length} 个段落到队列`);

    // 触发批量处理
    this.processPendingQueue();
  }

  /**
   * 处理待处理队列
   */
  private async processPendingQueue(): Promise<void> {
    // 如果已经在处理中，跳过
    if (this.isRequesting || this.pendingQueue.length === 0) {
      return;
    }

    this.isRequesting = true;

    try {
      // 按照配置限制分批
      const batches = this.splitIntoBatches(this.pendingQueue);

      // 清空待处理队列
      this.pendingQueue = [];

      // 处理每一批
      for (const batch of batches) {
        await this.processBatch(batch);
      }
    } catch (error) {
      console.error('BatchTranslationManager: 处理队列失败', error);
    } finally {
      this.isRequesting = false;

      // 如果队列中有新的待处理项，继续处理
      if (this.pendingQueue.length > 0) {
        this.processPendingQueue();
      }
    }
  }

  /**
   * 将段落分批
   */
  private splitIntoBatches(paragraphs: PendingParagraph[]): PendingParagraph[][] {
    const batches: PendingParagraph[][] = [];
    let currentBatch: PendingParagraph[] = [];
    let currentChars = 0;

    for (const para of paragraphs) {
      const paraLength = para.text.length;

      // 检查是否需要开启新批次
      if (
        currentBatch.length >= DEFAULT_BATCH_CONFIG.maxParagraphsPerBatch ||
        currentChars + paraLength > DEFAULT_BATCH_CONFIG.maxCharsPerBatch
      ) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentChars = 0;
        }
      }

      currentBatch.push(para);
      currentChars += paraLength;
    }

    // 添加最后一批
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  /**
   * 处理单批段落
   */
  private async processBatch(paragraphs: PendingParagraph[]): Promise<void> {
    console.log(`BatchTranslationManager: 处理批次，${paragraphs.length} 个段落`);

    // 构建批量请求
    const request: BatchTranslationRequest = {
      paragraphs: paragraphs.map((p) => ({
        id: p.id,
        text: p.text,
        elementPath: p.elementPath,
      })),
      mode: this.mode,
      pageUrl: this.pageUrl,
    };

    try {
      // 发送批量翻译请求到后台
      const response = await this.sendBatchRequest(request);

      if (response.success && response.data) {
        const batchResponse = response.data as BatchTranslationResponse;
        console.log('BatchTranslationManager: 批量翻译完成', {
          results: batchResponse.results.length,
          cacheHits: batchResponse.cacheHitCount,
        });

        // 分发结果
        this.distributeResults(paragraphs, batchResponse.results);
      } else {
        console.error('BatchTranslationManager: 批量翻译失败', response.error);
        // 标记段落为处理完成（避免重复请求）
        this.markParagraphsComplete(paragraphs);
      }
    } catch (error) {
      console.error('BatchTranslationManager: 请求失败', error);
      this.markParagraphsComplete(paragraphs);
    }
  }

  /**
   * 分发翻译结果到对应段落
   */
  private distributeResults(
    paragraphs: PendingParagraph[],
    results: BatchParagraphResult[]
  ): void {
    // 创建ID到结果的映射
    const resultMap = new Map<string, BatchParagraphResult>();
    for (const result of results) {
      resultMap.set(result.id, result);
    }

    // 应用翻译结果到每个段落
    for (const para of paragraphs) {
      const result = resultMap.get(para.id);

      if (result && result.result) {
        // 检查元素是否仍然在DOM中
        if (!document.body.contains(para.element)) {
          console.log(`BatchTranslationManager: 元素已从DOM移除，跳过 ${para.id}`);
          continue;
        }

        // 保存原始文本
        TranslationDisplay.saveOriginalText(para.element);

        // 应用翻译
        if (result.result.words.length > 0 || result.result.fullText) {
          TranslationDisplay.applyTranslation(para.element, result.result, this.mode);

          // 触发回调
          if (this.onComplete) {
            this.onComplete(para.element, result.result);
          }

          console.log(`BatchTranslationManager: 已应用翻译到 ${para.id}${result.cached ? ' (缓存)' : ''}`);
        }
      }

      // 从处理中集合移除
      this.processingParagraphs.delete(para.id);
    }
  }

  /**
   * 标记段落为处理完成
   */
  private markParagraphsComplete(paragraphs: PendingParagraph[]): void {
    for (const para of paragraphs) {
      this.processingParagraphs.delete(para.id);
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
