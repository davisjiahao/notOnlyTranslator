import { DEFAULT_BATCH_CONFIG } from '@/shared/constants';
import { debounce, logger } from '@/shared/utils';

/**
 * 可视区域段落信息
 */
export interface VisibleParagraph {
  /** 段落元素 */
  element: HTMLElement;
  /** 唯一标识符 */
  id: string;
  /** 文本内容 */
  text: string;
  /** 元素路径，用于定位 */
  elementPath: string;
}

/**
 * 可视区域变化回调
 */
export type ViewportChangeCallback = (paragraphs: VisibleParagraph[]) => void;

/**
 * 可视区域观察器
 *
 * 使用 IntersectionObserver 检测段落进入可视区域
 * 防抖处理后触发回调，收集当前可视区域内的所有段落
 */
export class ViewportObserver {
  /** IntersectionObserver 实例 */
  private observer: IntersectionObserver | null = null;

  /** 当前可视区域内的段落集合 */
  private visibleParagraphs: Map<HTMLElement, VisibleParagraph> = new Map();

  /** 所有被观察的段落 */
  private observedElements: Set<HTMLElement> = new Set();

  /** 元素ID计数器 */
  private idCounter: number = 0;

  /** 回调函数 */
  private callback: ViewportChangeCallback;

  /** 防抖后的通知函数 */
  private debouncedNotify: () => void;

  /** 是否启用 */
  private enabled: boolean = true;

  constructor(callback: ViewportChangeCallback) {
    this.callback = callback;

    // 创建防抖后的通知函数
    this.debouncedNotify = debounce(() => {
      this.notifyVisibleParagraphs();
    }, DEFAULT_BATCH_CONFIG.debounceDelay);

    // 初始化 IntersectionObserver
    this.initObserver();
  }

  /**
   * 初始化 IntersectionObserver
   */
  private initObserver(): void {
    // 配置观察选项
    const options: IntersectionObserverInit = {
      // 使用视口作为根
      root: null,
      // 扩展边界，提前加载即将进入视口的内容 (增加到 800px 以实现更早的预加载)
      rootMargin: '800px 0px 800px 0px',
      // 可见度阈值
      threshold: [0, 0.1],
    };

    this.observer = new IntersectionObserver((entries) => {
      this.handleIntersection(entries);
    }, options);

    logger.info('ViewportObserver: 已初始化');
  }

  /**
   * 处理交叉事件
   */
  private handleIntersection(entries: IntersectionObserverEntry[]): void {
    if (!this.enabled) return;

    let hasChanges = false;

    for (const entry of entries) {
      const element = entry.target as HTMLElement;

      if (entry.isIntersecting) {
        // 元素进入可视区域
        if (!this.visibleParagraphs.has(element)) {
          const paragraph = this.createParagraphInfo(element);
          if (paragraph) {
            this.visibleParagraphs.set(element, paragraph);
            hasChanges = true;
          }
        }
      } else {
        // 元素离开可视区域
        if (this.visibleParagraphs.has(element)) {
          this.visibleParagraphs.delete(element);
          hasChanges = true;
        }
      }
    }

    // 如果有变化，触发防抖通知
    if (hasChanges) {
      this.debouncedNotify();
    }
  }

  /**
   * 创建段落信息对象
   */
  private createParagraphInfo(element: HTMLElement): VisibleParagraph | null {
    const text = element.textContent?.trim() || '';

    // 过滤掉文本太短的段落
    if (text.length < 50) {
      return null;
    }

    // 过滤掉已处理的段落
    if (element.classList.contains('not-translator-processed')) {
      return null;
    }

    return {
      element,
      id: this.generateId(element),
      text,
      elementPath: this.getElementPath(element),
    };
  }

  /**
   * 生成元素唯一ID
   */
  private generateId(element: HTMLElement): string {
    // 优先使用元素自身的ID
    if (element.id) {
      return `para_${element.id}`;
    }

    // 否则使用计数器生成
    return `para_${++this.idCounter}`;
  }

  /**
   * 获取元素的DOM路径
   */
  private getElementPath(element: HTMLElement): string {
    const path: string[] = [];
    let current: HTMLElement | null = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      } else if (current.className && typeof current.className === 'string') {
        const classes = current.className.split(' ').filter((c) => c.trim()).slice(0, 2);
        if (classes.length > 0) {
          selector += `.${classes.join('.')}`;
        }
      }

      // 添加索引以区分兄弟元素
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current!.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current);
          selector += `:nth-of-type(${index + 1})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  /**
   * 通知回调当前可视区域内的段落
   */
  private notifyVisibleParagraphs(): void {
    if (!this.enabled) return;

    // 收集需要翻译的段落（排除已处理的）
    const paragraphsToTranslate: VisibleParagraph[] = [];

    for (const [element, paragraph] of this.visibleParagraphs) {
      // 再次检查是否已处理（可能在等待防抖期间被处理了）
      if (!element.classList.contains('not-translator-processed')) {
        paragraphsToTranslate.push(paragraph);
      }
    }

    if (paragraphsToTranslate.length > 0) {
      logger.info(`ViewportObserver: 通知 ${paragraphsToTranslate.length} 个可视段落`);
      this.callback(paragraphsToTranslate);
    }
  }

  /**
   * 观察元素
   */
  observe(element: HTMLElement): void {
    if (!this.observer || this.observedElements.has(element)) {
      return;
    }

    this.observer.observe(element);
    this.observedElements.add(element);
  }

  /**
   * 批量观察元素
   */
  observeAll(elements: HTMLElement[]): void {
    for (const element of elements) {
      this.observe(element);
    }
    logger.info(`ViewportObserver: 正在观察 ${this.observedElements.size} 个元素`);
  }

  /**
   * 停止观察元素
   */
  unobserve(element: HTMLElement): void {
    if (!this.observer) return;

    this.observer.unobserve(element);
    this.observedElements.delete(element);
    this.visibleParagraphs.delete(element);
  }

  /**
   * 标记元素为已处理
   * 从可视段落集合中移除，避免重复翻译
   */
  markAsProcessed(element: HTMLElement): void {
    this.visibleParagraphs.delete(element);
  }

  /**
   * 启用观察器
   */
  enable(): void {
    this.enabled = true;
    logger.info('ViewportObserver: 已启用');
  }

  /**
   * 禁用观察器
   */
  disable(): void {
    this.enabled = false;
    this.visibleParagraphs.clear();
    logger.info('ViewportObserver: 已禁用');
  }

  /**
   * 手动触发当前可视区域检查
   */
  checkCurrentViewport(): void {
    if (!this.enabled) return;

    // 重新检查所有被观察元素的可见性
    this.visibleParagraphs.clear();

    for (const element of this.observedElements) {
      const rect = element.getBoundingClientRect();
      const isVisible =
        rect.top < window.innerHeight + 100 &&
        rect.bottom > -100 &&
        rect.left < window.innerWidth &&
        rect.right > 0;

      if (isVisible) {
        const paragraph = this.createParagraphInfo(element);
        if (paragraph) {
          this.visibleParagraphs.set(element, paragraph);
        }
      }
    }

    // 立即通知
    this.notifyVisibleParagraphs();
  }

  /**
   * 获取当前可视段落数量
   */
  getVisibleCount(): number {
    return this.visibleParagraphs.size;
  }

  /**
   * 重置追踪状态（用于翻译模式切换后重新翻译）
   * 保持观察但清除可视段落缓存，以便重新触发翻译
   */
  resetTracking(): void {
    this.visibleParagraphs.clear();
    this.idCounter = 0;
    logger.info('ViewportObserver: 已重置追踪状态');
  }

  /**
   * 销毁观察器
   */
  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.observedElements.clear();
    this.visibleParagraphs.clear();

    logger.info('ViewportObserver: 已销毁');
  }
}
