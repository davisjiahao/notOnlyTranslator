import { DEFAULT_BATCH_CONFIG } from '@/shared/constants';
import { debounce, logger } from '@/shared/utils';
import { createTranslatableTextWalker, getTranslatableText, isInExcludedArea } from './pageScanner';

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
  /** 交叉观察与手动检查共用边界，避免取消排队任务却保留已通知状态。 */
  private static readonly PRELOAD_TOP = 1200;
  private static readonly PRELOAD_BOTTOM = 400;

  /** IntersectionObserver 实例 */
  private observer: IntersectionObserver | null = null;

  /** 当前可视区域内的段落集合 */
  private visibleParagraphs: Map<HTMLElement, VisibleParagraph> = new Map();

  /** 同次进入视口只通知一次，其他段落变动不能隐式重试已失败请求。 */
  private notifiedElements = new WeakSet<HTMLElement>();

  /** 无自身布局框的段落按可译文本跟踪，样式变化后也保持这一通知生命周期。 */
  private textObservedElements = new WeakSet<HTMLElement>();

  /** 所有被观察的段落 */
  private observedElements: Set<HTMLElement> = new Set();

  private readonly checkTextViewport = debounce(() => {
    if (!this.enabled || !this.observer) return;
    // 无框父节点不能提供可靠的交叉事件；滚动与resize补查正文，不重置其他段落。
    for (const element of this.observedElements) {
      if (this.usesTextVisibility(element)) this.updateTextParagraph(element);
    }
    this.notifyVisibleParagraphs();
  }, DEFAULT_BATCH_CONFIG.debounceDelay);

  /** 元素ID计数器 */
  private idCounter: number = 0;

  /** 回调函数 */
  private callback: ViewportChangeCallback;

  /** 可视区域 ID 变化回调（用于批量翻译管理器取消离屏段落） */
  private onVisibleIdsChanged?: (visibleIds: Set<string>) => void;

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

    // 初始化 IntersectionObserver，捕获嵌套滚动容器的滚动事件。
    this.initObserver();
    window.addEventListener('scroll', this.checkTextViewport, { capture: true, passive: true });
    window.addEventListener('resize', this.checkTextViewport);
  }

  /**
   * 初始化 IntersectionObserver
   */
  private initObserver(): void {
    // 配置观察选项
    const options: IntersectionObserverInit = {
      // 使用视口作为根
      root: null,
      // 扩展边界，提前加载即将进入视口的内容，与手动检查保持一致。
      rootMargin: `${ViewportObserver.PRELOAD_TOP}px 0px ${ViewportObserver.PRELOAD_BOTTOM}px 0px`,
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
      if (this.usesTextVisibility(element)) {
        this.updateTextParagraph(element);
        hasChanges = true;
        continue;
      }

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
        // 仅自身离开才结束通知周期，允许下次真实进入时重试。
        this.notifiedElements.delete(element);
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
  private createParagraphInfo(element: HTMLElement, id?: string): VisibleParagraph | null {
    const text = getTranslatableText(element).trim();

    // 过滤掉文本太短的段落
    if (text.length < 50) {
      return null;
    }

    // 过滤掉已处理的段落
    if (element.classList.contains('not-translator-processed')) {
      return null;
    }

    // 过滤掉位于排除区域的段落（导航、页脚等 UI 元素）
    if (isInExcludedArea(element)) {
      return null;
    }

    return {
      element,
      id: id ?? this.generateId(element),
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

    // 收集当前所有可视段落的 ID（包括已处理和未处理的）
    const allVisibleIds = new Set<string>();
    const paragraphsToTranslate: VisibleParagraph[] = [];

    for (const [element, paragraph] of this.visibleParagraphs) {
      allVisibleIds.add(paragraph.id);
      // 再次检查是否已处理（可能在等待防抖期间被处理了）
      if (!element.classList.contains('not-translator-processed') && !this.notifiedElements.has(element)) {
        this.notifiedElements.add(element);
        paragraphsToTranslate.push(paragraph);
      }
    }

    // 通知可视区域 ID 变化（用于批量翻译管理器取消离屏段落）
    if (this.onVisibleIdsChanged) {
      this.onVisibleIdsChanged(allVisibleIds);
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
    if (this.usesTextVisibility(element)) this.checkTextViewport();
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
    this.notifiedElements.delete(element);
    this.textObservedElements.delete(element);
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
    this.notifiedElements = new WeakSet();
    logger.info('ViewportObserver: 已禁用');
  }

  /**
   * 手动触发当前可视区域检查
   */
  checkCurrentViewport(): void {
    if (!this.enabled) return;

    // 重新核验资格和可见性，但保留仍可见段落的请求ID，不能误取消匿名段落的在途任务。
    const previousVisible = this.visibleParagraphs;
    this.visibleParagraphs = new Map();

    for (const element of this.observedElements) {
      if (this.usesTextVisibility(element)) {
        this.updateTextParagraph(element, previousVisible.get(element));
        continue;
      }
      const rect = element.getBoundingClientRect();
      // 零面积无法独立证明可见；已收到交叉事件的段落仍保持原通知周期。
      const hasLayout = rect.right > rect.left && rect.bottom > rect.top;
      // IntersectionObserver 的 isIntersecting 也包含与根边界恰好接壤的情况。
      const isVisible = (hasLayout || previousVisible.has(element)) && this.isRectInPreloadArea(rect);

      if (isVisible) {
        const paragraph = this.createParagraphInfo(element, previousVisible.get(element)?.id);
        if (paragraph) {
          this.visibleParagraphs.set(element, paragraph);
        }
      }
    }

    // 立即通知
    this.notifyVisibleParagraphs();
  }

  private isRectInPreloadArea(rect: DOMRect): boolean {
    return rect.top <= window.innerHeight + ViewportObserver.PRELOAD_BOTTOM
      && rect.bottom >= -ViewportObserver.PRELOAD_TOP
      && rect.left <= window.innerWidth && rect.right >= 0;
  }

  private usesTextVisibility(element: HTMLElement): boolean {
    if (getComputedStyle(element).display === 'contents') this.textObservedElements.add(element);
    return this.textObservedElements.has(element);
  }

  /** 仅测量共享正文边界内的Text，不把隐藏内容、词义注释或扩展UI算作可见原文。 */
  private isTextVisible(element: HTMLElement): boolean {
    if (!element.isConnected || isInExcludedArea(element)) return false;
    const walker = createTranslatableTextWalker(element);
    const range = document.createRange();
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      range.selectNodeContents(node);
      if (Array.from(range.getClientRects?.() || []).some(rect =>
        rect.right > rect.left && rect.bottom > rect.top && this.isRectInPreloadArea(rect))) return true;
    }
    return false;
  }

  private updateTextParagraph(element: HTMLElement, previous = this.visibleParagraphs.get(element)): void {
    const visible = this.isTextVisible(element);
    const paragraph = visible ? this.createParagraphInfo(element, previous?.id) : null;
    if (paragraph) this.visibleParagraphs.set(element, paragraph);
    else this.visibleParagraphs.delete(element);
    // 只有可译正文真正离开预加载区才允许下次重投，父节点的false交叉事件不算离开。
    if (!visible) this.notifiedElements.delete(element);
  }

  /**
   * 设置可视区域 ID 变化回调（用于批量翻译管理器取消离屏段落）
   */
  setVisibleIdsChangedCallback(callback: (visibleIds: Set<string>) => void): void {
    this.onVisibleIdsChanged = callback;
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
    this.notifiedElements = new WeakSet();
    this.idCounter = 0;
    logger.info('ViewportObserver: 已重置追踪状态');
  }

  /**
   * 销毁观察器
   */
  destroy(): void {
    this.enabled = false;
    window.removeEventListener('scroll', this.checkTextViewport, true);
    window.removeEventListener('resize', this.checkTextViewport);
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.observedElements.clear();
    this.visibleParagraphs.clear();
    this.notifiedElements = new WeakSet();
    this.textObservedElements = new WeakSet();

    logger.info('ViewportObserver: 已销毁');
  }
}
