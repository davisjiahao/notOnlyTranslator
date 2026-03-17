/**
 * 优化的 DOM 高亮渲染器
 *
 * 使用 requestAnimationFrame 和分块处理来优化大页面的渲染性能
 *
 * @module content/optimizedHighlighter
 */

import type { TranslatedWord } from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';
import { logger } from '@/shared/utils';

/**
 * 渲染任务
 */
interface RenderTask {
  id: string;
  container: HTMLElement;
  words: TranslatedWord[];
  priority: number;
  visible: boolean;
}

/**
 * 渲染统计
 */
interface RenderStats {
  totalTasks: number;
  completedTasks: number;
  totalNodes: number;
  processedNodes: number;
  startTime: number;
  endTime?: number;
}

/**
 * 优化的高亮渲染配置
 */
export interface OptimizedHighlighterConfig {
  /** 每帧最大处理节点数 */
  maxNodesPerFrame: number;
  /** 每帧最大处理时间（毫秒） */
  maxTimePerFrame: number;
  /** 是否启用虚拟滚动优化 */
  enableVirtualScroll: boolean;
  /** 视口外预渲染距离（像素） */
  preloadDistance: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: OptimizedHighlighterConfig = {
  maxNodesPerFrame: 10,
  maxTimePerFrame: 16, // ~60fps
  enableVirtualScroll: true,
  preloadDistance: 200,
};

/**
 * OptimizedHighlighter - 使用 requestAnimationFrame 的优化高亮渲染器
 *
 * 特性：
 * 1. requestAnimationFrame 分帧渲染，避免阻塞主线程
 * 2. 优先级队列，视口内内容优先渲染
 * 3. 可取消的任务，页面变化时自动取消未完成任务
 * 4. 渲染统计，监控性能指标
 */
export class OptimizedHighlighter {
  private config: OptimizedHighlighterConfig;
  private taskQueue: RenderTask[] = [];
  private highlightedElements: Map<string, HTMLElement[]> = new Map();
  private isRendering = false;
  private currentFrameId: number | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private visibleElements: Set<HTMLElement> = new Set();
  private renderStats: RenderStats | null = null;

  constructor(config?: Partial<OptimizedHighlighterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initIntersectionObserver();
  }

  /**
   * 初始化 Intersection Observer
   */
  private initIntersectionObserver(): void {
    if (!this.config.enableVirtualScroll) return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const element = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            this.visibleElements.add(element);
            // 提升视口内任务优先级
            this.prioritizeVisibleTasks();
          } else {
            this.visibleElements.delete(element);
          }
        });
      },
      {
        root: null,
        rootMargin: `${this.config.preloadDistance}px`,
        threshold: 0,
      }
    );
  }

  /**
   * 高亮单词（异步，可中断）
   */
  async highlightWords(
    container: HTMLElement,
    words: TranslatedWord[]
  ): Promise<void> {
    if (!words.length) return;

    const taskId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const isVisible = this.visibleElements.has(container) || this.isElementVisible(container);

    // 创建渲染任务
    const task: RenderTask = {
      id: taskId,
      container,
      words,
      priority: isVisible ? 1 : 0, // 视口内优先
      visible: isVisible,
    };

    // 添加到队列并按优先级排序
    this.taskQueue.push(task);
    this.taskQueue.sort((a, b) => b.priority - a.priority);

    // 开始渲染循环
    if (!this.isRendering) {
      this.startRenderLoop();
    }

    // 观察元素可见性
    if (this.intersectionObserver && this.config.enableVirtualScroll) {
      this.intersectionObserver.observe(container);
    }
  }

  /**
   * 批量高亮（支持多个容器）
   */
  async highlightBatch(
    containers: Array<{ element: HTMLElement; words: TranslatedWord[] }>
  ): Promise<void> {
    // 按可见性排序
    const sorted = containers
      .map((item) => ({
        ...item,
        visible: this.visibleElements.has(item.element) || this.isElementVisible(item.element),
      }))
      .sort((a, b) => (b.visible ? 1 : 0) - (a.visible ? 1 : 0));

    // 创建所有任务
    for (const item of sorted) {
      const task: RenderTask = {
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        container: item.element,
        words: item.words,
        priority: item.visible ? 1 : 0,
        visible: item.visible,
      };
      this.taskQueue.push(task);

      // 观察元素
      if (this.intersectionObserver && this.config.enableVirtualScroll) {
        this.intersectionObserver.observe(item.element);
      }
    }

    // 开始渲染
    if (!this.isRendering) {
      this.startRenderLoop();
    }
  }

  /**
   * 启动渲染循环
   */
  private startRenderLoop(): void {
    if (this.isRendering) return;

    this.isRendering = true;
    this.renderStats = {
      totalTasks: this.taskQueue.length,
      completedTasks: 0,
      totalNodes: 0,
      processedNodes: 0,
      startTime: performance.now(),
    };

    this.processNextFrame();
  }

  /**
   * 处理下一帧
   */
  private processNextFrame(): void {
    if (this.taskQueue.length === 0) {
      this.finishRendering();
      return;
    }

    const frameStartTime = performance.now();
    let nodesProcessed = 0;

    // 处理任务直到时间或节点数限制
    while (this.taskQueue.length > 0) {
      const currentTime = performance.now();
      const elapsedTime = currentTime - frameStartTime;

      // 检查是否超过时间限制
      if (elapsedTime > this.config.maxTimePerFrame) {
        break;
      }

      // 检查是否超过节点数限制
      if (nodesProcessed >= this.config.maxNodesPerFrame) {
        break;
      }

      // 获取最高优先级任务
      const task = this.taskQueue[0];

      // 处理任务的一个批次
      const processed = this.processTaskBatch(task);
      nodesProcessed += processed;

      // 如果任务完成，从队列移除
      if (task.words.length === 0) {
        this.taskQueue.shift();
        if (this.renderStats) {
          this.renderStats.completedTasks++;
        }
      }
    }

    if (this.renderStats) {
      this.renderStats.processedNodes += nodesProcessed;
    }

    // 安排下一帧
    this.currentFrameId = requestAnimationFrame(() => this.processNextFrame());
  }

  /**
   * 处理任务的一个批次
   * @returns 处理的节点数
   */
  private processTaskBatch(task: RenderTask): number {
    const { container, words } = task;
    if (!words.length) return 0;

    // 创建单词映射
    const wordMap = new Map<string, TranslatedWord>();
    words.forEach((w) => {
      wordMap.set(w.original.toLowerCase(), w);
    });

    // 收集文本节点
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const tagName = parent.tagName.toLowerCase();
          if (
            tagName === 'script' ||
            tagName === 'style' ||
            tagName === 'noscript' ||
            tagName === 'textarea' ||
            tagName === 'input' ||
            parent.classList.contains(CSS_CLASSES.HIGHLIGHT)
          ) {
            return NodeFilter.FILTER_REJECT;
          }

          const text = node.textContent?.toLowerCase() || '';
          for (const word of wordMap.keys()) {
            if (text.includes(word)) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }

          return NodeFilter.FILTER_SKIP;
        },
      }
    );

    const nodesToProcess: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode()) && nodesToProcess.length < this.config.maxNodesPerFrame) {
      nodesToProcess.push(node as Text);
    }

    // 处理收集的节点
    nodesToProcess.forEach((textNode) => {
      this.processTextNode(textNode, wordMap, task);
    });

    // 移除已处理的单词
    const processedWords = new Set<string>();
    nodesToProcess.forEach((textNode) => {
      const text = textNode.textContent?.toLowerCase() || '';
      for (const word of wordMap.keys()) {
        if (text.includes(word)) {
          processedWords.add(word);
        }
      }
    });

    // 更新任务单词列表
    task.words = task.words.filter((w) => !processedWords.has(w.original.toLowerCase()));

    return nodesToProcess.length;
  }

  /**
   * 处理单个文本节点
   */
  private processTextNode(
    textNode: Text,
    wordMap: Map<string, TranslatedWord>,
    _task: RenderTask
  ): void {
    const text = textNode.textContent || '';
    if (!text.trim()) return;

    const parent = textNode.parentNode;
    if (!parent) return;

    // 查找所有匹配
    const matches: Array<{ start: number; end: number; word: TranslatedWord }> = [];

    for (const [, word] of wordMap) {
      const isPhrase = word.original.includes(' ');
      const escapedOriginal = this.escapeRegex(word.original);
      let regexPattern: string;

      if (isPhrase) {
        const flexiblePhrase = escapedOriginal.replace(/\\ /g, '\\s+');
        regexPattern = `\\b${flexiblePhrase}\\b`;
      } else {
        regexPattern = `\\b${escapedOriginal}\\b`;
      }

      const regex = new RegExp(regexPattern, 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          word: { ...word, original: match[0] },
        });
      }
    }

    if (!matches.length) return;

    // 排序并去重
    matches.sort((a, b) => a.start - b.start);
    const filteredMatches: typeof matches = [];
    let lastEnd = 0;
    for (const match of matches) {
      if (match.start >= lastEnd) {
        filteredMatches.push(match);
        lastEnd = match.end;
      }
    }

    // 创建文档片段
    const fragment = document.createDocumentFragment();
    let currentIndex = 0;

    for (const match of filteredMatches) {
      if (match.start > currentIndex) {
        fragment.appendChild(document.createTextNode(text.slice(currentIndex, match.start)));
      }

      const span = document.createElement('span');
      span.className = CSS_CLASSES.HIGHLIGHT;
      span.textContent = match.word.original;
      span.dataset.word = match.word.original;
      span.dataset.translation = match.word.translation;
      span.dataset.difficulty = String(match.word.difficulty);
      span.dataset.isPhrase = String(match.word.isPhrase);

      fragment.appendChild(span);

      // 跟踪高亮元素
      const key = match.word.original.toLowerCase();
      if (!this.highlightedElements.has(key)) {
        this.highlightedElements.set(key, []);
      }
      this.highlightedElements.get(key)!.push(span);

      currentIndex = match.end;
    }

    if (currentIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(currentIndex)));
    }

    parent.replaceChild(fragment, textNode);
  }

  /**
   * 完成渲染
   */
  private finishRendering(): void {
    this.isRendering = false;
    this.currentFrameId = null;

    if (this.renderStats) {
      this.renderStats.endTime = performance.now();
      const duration = this.renderStats.endTime - this.renderStats.startTime;
      logger.info('OptimizedHighlighter: 渲染完成', {
        duration: `${duration.toFixed(2)}ms`,
        tasks: this.renderStats.completedTasks,
        nodes: this.renderStats.processedNodes,
      });
    }
  }

  /**
   * 提升视口内任务的优先级
   */
  private prioritizeVisibleTasks(): void {
    // 重新计算优先级并排序
    for (const task of this.taskQueue) {
      task.priority = this.visibleElements.has(task.container) ? 1 : 0;
    }
    this.taskQueue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 检查元素是否在视口内
   */
  private isElementVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return (
      rect.top < window.innerHeight + this.config.preloadDistance &&
      rect.bottom > -this.config.preloadDistance
    );
  }

  /**
   * 取消所有未完成的渲染
   */
  cancelPendingRenders(): void {
    if (this.currentFrameId !== null) {
      cancelAnimationFrame(this.currentFrameId);
      this.currentFrameId = null;
    }
    this.taskQueue = [];
    this.isRendering = false;
    logger.info('OptimizedHighlighter: 已取消所有待处理渲染');
  }

  /**
   * 标记单词为已知
   */
  markAsKnown(word: string): void {
    const elements = this.highlightedElements.get(word.toLowerCase());
    if (elements) {
      elements.forEach((el) => {
        el.classList.remove(CSS_CLASSES.UNKNOWN);
        el.classList.add(CSS_CLASSES.KNOWN);
      });
    }
  }

  /**
   * 标记单词为未知
   */
  markAsUnknown(word: string): void {
    const elements = this.highlightedElements.get(word.toLowerCase());
    if (elements) {
      elements.forEach((el) => {
        el.classList.remove(CSS_CLASSES.KNOWN);
        el.classList.add(CSS_CLASSES.UNKNOWN);
      });
    }
  }

  /**
   * 移除单词高亮
   */
  removeHighlight(word: string): void {
    const elements = this.highlightedElements.get(word.toLowerCase());
    if (elements) {
      elements.forEach((el) => {
        const text = document.createTextNode(el.textContent || '');
        el.parentNode?.replaceChild(text, el);
      });
      this.highlightedElements.delete(word.toLowerCase());
    }
  }

  /**
   * 清除所有高亮
   */
  clearAllHighlights(): void {
    this.cancelPendingRenders();
    for (const word of this.highlightedElements.keys()) {
      this.removeHighlight(word);
    }
    this.highlightedElements.clear();
  }

  /**
   * 获取渲染统计
   */
  getRenderStats(): RenderStats | null {
    return this.renderStats;
  }

  /**
   * 转义正则字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 销毁实例
   */
  destroy(): void {
    this.cancelPendingRenders();
    this.clearAllHighlights();
    this.intersectionObserver?.disconnect();
    this.visibleElements.clear();
  }
}
