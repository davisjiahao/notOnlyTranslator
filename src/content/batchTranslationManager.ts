import type {
  MessageResponse,
  BatchTranslationRequest,
  BatchTranslationResponse,
  BatchParagraphResult,
  TranslationMode,
  TranslationResult,
  UserSettings,
} from '@/shared/types';
import { DEFAULT_BATCH_CONFIG } from '@/shared/constants';
import { logger } from '@/shared/utils';
import type { VisibleParagraph } from './viewportObserver';
import { TranslationDisplay } from './translationDisplay';
import { getTranslatableText } from './pageScanner';
import { ErrorNotification } from './ErrorNotification';
import { TranslationErrorType } from '@/shared/utils/translationErrors';
import { sendTranslationMessage, cancelTranslationMessages } from './translationMessaging';

const GOOGLE_INLINE_HINT = '免费 Google 翻译不支持仅行内模式，请选择双语或全文翻译';
// 仅精确放行后台与消息层固定错误模板，不接受前后缀或上游详情。
const SAFE_BATCH_FAILURE_MESSAGES: readonly string[] = [
  '翻译请求超时，请缩短文本或使用更小的本地模型',
  '翻译请求超时，请稍后重试',
  '扩展连接已断开，请刷新页面后重试',
  '翻译服务未返回响应',
  '翻译输入无效或超出长度限制',
  '模型输出预算耗尽，未返回完整译文，请缩短文本或使用非思考模型',
  '翻译服务凭据无效，请检查密钥配置',
  '翻译服务暂不可用，请检查服务是否启动或稍后重试',
  '无法连接翻译服务，请检查服务是否启动',
  '模型返回格式不正确，请重试或更换模型',
  '翻译失败，请检查翻译服务与模型配置后重试',
];

/**
 * 翻译完成回调
 */
export type TranslationCompleteCallback = (
  element: HTMLElement,
  result: TranslationResult
) => void;

/**
 * 翻译进度回调：参数为当前在途批次数与排队段落数。
 * 段落不再注入加载指示（历史实现一次注入 ::after 伪元素圈与 spinner 节点双圈），
 * 进行中状态由悬浮按钮/面板通过本回调显示。
 */
export type TranslationProgressCallback = (activeBatches: number, queuedParagraphs: number) => void;

/**
 * 待处理的段落请求
 */
interface PendingParagraph extends VisibleParagraph {
  /** 请求时间戳 */
  requestedAt: number;
  /** 入队时固定获取模式，展示切换不能升级已排队的本地任务 */
  acquisitionMode: TranslationMode;
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
  private onProgress: TranslationProgressCallback | null = null;
  private settings: UserSettings | undefined = undefined;
  private readonly errorNotification = new ErrorNotification();

  /** 正在处理中的段落 ID 集合 */
  private processingParagraphIds: Set<string> = new Set();
  /** 待处理的段落队列 */
  private pendingQueue: PendingParagraph[] = [];

  /** 当前活跃的并发请求数 */
  private activeRequests = 0;
  private generation = 0;
  private activeBatches: Readonly<Record<string, { controller: AbortController; paragraphs: PendingParagraph[] }>> = {};
  /** 最大并发批次数 — 从 3 提升至 5，快速滑动时减少排队等待 */
  private readonly MAX_CONCURRENT_BATCHES = 5;

  constructor(settings?: UserSettings) {
    this.pageUrl = window.location.origin;
    this.settings = settings;
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
      const pending: PendingParagraph = { ...p, requestedAt: now, acquisitionMode: this.mode };
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
      this.notifyProgress();
      this.processBatch(batch).finally(() => {
        this.activeRequests--;
        // 一个批次完成后，递归尝试处理下一个批次
        this.notifyProgress();
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
        (batch.length > 0 && next.acquisitionMode !== batch[0].acquisitionMode) ||
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
    logger.info(`BatchTranslationManager: 并发处理批次 (${paragraphs.length} 段)`);

    // 新批次开始时清理上一批的失败提示，避免重试成功后提示残留在段落内
    this.errorNotification.hide();

    const generation = this.generation;
    const batchId = crypto.randomUUID();
    const controller = new AbortController();
    this.activeBatches = { ...this.activeBatches, [batchId]: { controller, paragraphs } };

    const request: BatchTranslationRequest = {
      paragraphs: paragraphs.map(p => ({ id: p.id, text: p.text, elementPath: p.elementPath })),
      mode: paragraphs[0].acquisitionMode,
      pageUrl: this.pageUrl,
    };

    let deliveredIds: ReadonlySet<string> = new Set();
    const pendingParagraphs = () => paragraphs.filter(paragraph => !deliveredIds.has(paragraph.id));
    const onParagraph = (result: BatchParagraphResult): void => {
      if (generation !== this.generation || controller.signal.aborted || deliveredIds.has(result.id)) return;
      const paragraph = paragraphs.find(candidate => candidate.id === result.id);
      if (!paragraph) return;
      deliveredIds = new Set([...deliveredIds, result.id]);
      this.distributeResults([paragraph], [result]);
    };

    try {
      const response = await this.sendBatchRequest(request, controller.signal, onParagraph);
      if (generation !== this.generation || controller.signal.aborted) return;

      if (response.success && response.data) {
        this.distributeResults(pendingParagraphs(), response.data.results);
      } else {
        if (response.error === '翻译请求已取消') {
          this.clearParagraphsStatus(pendingParagraphs());
          return;
        }
        logger.error('BatchTranslationManager: 批量翻译失败');
        if (request.mode === 'inline-only' && response.error === GOOGLE_INLINE_HINT) {
          const visible = paragraphs.find(p => document.body.contains(p.element));
          if (visible) {
            this.errorNotification.show({
              type: TranslationErrorType.UNKNOWN,
              title: '翻译模式不兼容',
              message: GOOGLE_INLINE_HINT,
              retryable: false,
            }, document.body);
          }
        } else {
          // 非 Google 行内模式错误：仅展示固定安全文案，不携带上游错误详情
          this.notifyBatchFailure(pendingParagraphs(), response.error);
        }
        this.clearParagraphsStatus(pendingParagraphs());
      }
    } catch {
      logger.error('BatchTranslationManager: 网络异常');
      if (generation === this.generation) this.notifyBatchFailure(pendingParagraphs());
      this.clearParagraphsStatus(pendingParagraphs());
    } finally {
      this.activeBatches = Object.fromEntries(Object.entries(this.activeBatches).filter(([id]) => id !== batchId));
    }
  }

  /**
   * 分发结果并渲染
   */
  private distributeResults(paragraphs: PendingParagraph[], results: BatchParagraphResult[]): void {
    const resultMap = new Map(results.map(r => [r.id, r]));

    for (const para of paragraphs) {
      const result = resultMap.get(para.id);

      if (result && result.result) {
        if (!document.body.contains(para.element) || getTranslatableText(para.element).trim() !== para.text.trim()) {
          this.processingParagraphIds.delete(para.id);
          continue;
        }

        TranslationDisplay.saveOriginalText(para.element);

        // 根据设置过滤结果
        const filteredResult = this.filterResultBySettings(result.result);

        // 合法空结果也由统一入口留存，切换展示时无需重新获取。
        TranslationDisplay.applyTranslation(para.element, filteredResult, this.mode, this.settings);
        if (this.onComplete) this.onComplete(para.element, filteredResult);
      } else {
        // 后台未返回该段落结果：释放处理状态允许下次重试，不标记已完成
        this.processingParagraphIds.delete(para.id);
        this.notifyBatchFailure([para]);
      }
    }
  }

  /**
   * 展示固定安全文案的批次失败提示
   * 不携带上游错误、端点、正文或密钥等敏感信息
   */
  private notifyBatchFailure(paragraphs: PendingParagraph[], error?: unknown): void {
    const visible = paragraphs.find(p => document.body.contains(p.element));
    if (!visible) return;
    this.errorNotification.show({
      type: TranslationErrorType.UNKNOWN,
      title: '批量翻译失败',
      message: typeof error === 'string' && SAFE_BATCH_FAILURE_MESSAGES.includes(error)
        ? error
        : '本次翻译未能完成，段落再次进入视口时会自动重试。',
      retryable: false,
    // 挂在 body 直下：不进入常规段落及其嵌套祖先的子树；
    // body 自身被注册为可观察段落的场景由 ViewportObserver 采集时的浮层过滤兜底
    }, document.body);
  }

  /**
   * 根据设置过滤翻译结果
   */
  private filterResultBySettings(result: TranslationResult): TranslationResult {
    const { phraseTranslationEnabled, grammarTranslationEnabled } = this.settings || {};

    return {
      ...result,
      // 如果禁用词组翻译，过滤掉短语
      words: result.words.filter(w => phraseTranslationEnabled !== false || !w.isPhrase),
      // 如果禁用语法翻译，清空语法点
      grammarPoints: grammarTranslationEnabled !== false ? result.grammarPoints : [],
    };
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
    request: BatchTranslationRequest,
    signal: AbortSignal,
    onParagraph: (result: BatchParagraphResult) => void
  ): Promise<MessageResponse<BatchTranslationResponse>> {
    return sendTranslationMessage<BatchTranslationResponse>({
      type: 'BATCH_TRANSLATE_TEXT',
      payload: request,
    }, undefined, signal, onParagraph);
  }

  /**
   * 检查段落是否正在处理中
   */
  isProcessing(paragraphId: string): boolean {
    return this.processingParagraphIds.has(paragraphId);
  }

  /**
   * 获取当前处理中的段落数量
   */
  getProcessingCount(): number {
    return this.processingParagraphIds.size;
  }

  /**
   * 设置翻译模式
   */
  setMode(mode: TranslationMode): void {
    this.mode = mode;
  }

  /**
   * 设置用户设置
   */
  setSettings(settings: UserSettings): void {
    this.settings = settings;
  }

  /**
   * 设置翻译完成回调
   */
  setOnComplete(callback: TranslationCompleteCallback): void {
    this.onComplete = callback;
  }

  /**
   * 设置进度回调（悬浮按钮/面板显示翻译进行中状态）
   */
  setOnProgress(callback: TranslationProgressCallback): void {
    this.onProgress = callback;
  }

  /**
   * 通知当前进度：在途批次数与排队段落数
   */
  private notifyProgress(): void {
    this.onProgress?.(this.activeRequests, this.pendingQueue.length);
  }

  /**
   * 取消所有待处理请求
   * @param notifyBackground true 时通知后台取消（用户主动取消语义）；
   *   false 为页面卸载路径：先静默结算前端等待（不发 CANCEL_TRANSLATION），
   *   后台在途批次继续完成并写缓存，结果服务刷新后的新页面。
   */
  cancelAll(notifyBackground = true): void {
    this.generation++;
    this.errorNotification.hide();
    this.pendingQueue = [];
    this.processingParagraphIds = new Set();
    if (!notifyBackground) {
      cancelTranslationMessages(false);
    }
    Object.values(this.activeBatches).forEach(({ controller }) => {
      controller.abort();
    });
    this.activeBatches = {};
    logger.info('BatchTranslationManager: 已取消所有待处理请求');
  }

  /**
   * 取消尚未开始翻译的队列段落（滑动离开视口时调用）
   * 避免为用户已滑过的内容浪费 API 调用
   */
  cancelOffscreenParagraphs(visibleParagraphIds: Set<string>): void {
    const before = this.pendingQueue.length;
    this.pendingQueue = this.pendingQueue.filter(p => visibleParagraphIds.has(p.id));
    const removed = before - this.pendingQueue.length;

    // 清理已取消段落的 processing 标记
    const remainingIds = new Set(this.pendingQueue.map(p => p.id));
    for (const id of this.processingParagraphIds) {
      if (!remainingIds.has(id) && !visibleParagraphIds.has(id)) {
        this.processingParagraphIds.delete(id);
      }
    }

    if (removed > 0) {
      logger.info(`BatchTranslationManager: 已取消 ${removed} 个离开视口的段落（队列剩余 ${this.pendingQueue.length} 个）`);
    }
  }

  /**
   * 清理过期的处理中段落
   * 避免因为某些原因导致段落一直处于处理中状态
   */
  cleanupStale(): void {
    // 由于目前无法追踪单个 ID 的请求时间，此方法暂不执行操作
    // 可以在未来将 processingParagraphIds 改为 Map<string, number> 存储时间戳
    logger.info('BatchTranslationManager: cleanupStale 暂未实现');
  }

  /**
   * 清除已处理缓存（用于配置失效或主动重新翻译）
   */
  clearProcessedCache(): void {
    this.cancelAll();
    logger.info('BatchTranslationManager: 已清除处理缓存');
  }
}
