import type {
  Message,
  MessageResponse,
  TranslationMode,
  TranslationResult,
  UserSettings,
} from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';
import { debounce, logger } from '@/shared/utils';
import { Highlighter } from './highlighter';
import { Tooltip } from './tooltip';
import { MarkerService } from './marker';
import { TranslationDisplay } from './translationDisplay';
import { ViewportObserver, VisibleParagraph } from './viewportObserver';
import { BatchTranslationManager } from './batchTranslationManager';
import { FloatingButton } from './floatingButton';

/**
 * Content Script - main entry point for page interaction
 */
class NotOnlyTranslator {
  private highlighter: Highlighter;
  private tooltip: Tooltip;
  private marker: MarkerService;
  private settings: UserSettings | null = null;
  private isEnabled: boolean = true;
  private observer: MutationObserver | null = null;

  /** 可视区域观察器 - 用于批量翻译 */
  private viewportObserver: ViewportObserver | null = null;

  /** 批量翻译管理器 */
  private batchManager: BatchTranslationManager | null = null;

  /** 是否使用批量翻译模式 */
  private useBatchMode: boolean = true;

  /** 悬停触发 Tooltip 的定时器 */
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  /** 当前悬停的元素 */
  private hoverElement: HTMLElement | null = null;

  /** 当前导航的高亮词索引 */
  private currentNavigateIndex: number = -1;
  /** 可导航的高亮词列表 */
  private navigableHighlights: HTMLElement[] = [];

  /** 浮动模式切换按钮 */
  private floatingButton: FloatingButton | null = null;

  /** 导航高亮清除定时器 */
  private navHighlightTimer: ReturnType<typeof setTimeout> | null = null;

  /** 刷新翻译定时器 */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- 事件处理器（箭头函数保持 this 绑定）----

  private handleMouseUp = (e: MouseEvent): void => {
    if (!this.settings?.enabled) return;
    setTimeout(() => {
      this.handleTextSelection(e);
    }, 50);
  };

  private handleMouseDown = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (!target.closest('.not-translator-tooltip')) {
      this.tooltip.hide();
    }
  };

  private handleMouseOver = (e: MouseEvent): void => {
    if (!this.settings?.enabled) return;

    const target = e.target as HTMLElement;

    const highlightElement = target.classList.contains(CSS_CLASSES.HIGHLIGHT)
      ? target
      : target.closest(`.${CSS_CLASSES.HIGHLIGHT}`) as HTMLElement | null;

    const grammarElement = target.classList.contains('not-translator-grammar-highlight')
      ? target
      : target.closest('.not-translator-grammar-highlight') as HTMLElement | null;

    const highlightedWord = target.classList.contains('not-translator-highlighted-word')
      ? target
      : target.closest('.not-translator-highlighted-word') as HTMLElement | null;

    const highlightedTranslation = target.classList.contains('not-translator-highlighted-translation')
      ? target
      : target.closest('.not-translator-highlighted-translation') as HTMLElement | null;

    const validElement = highlightElement || grammarElement || highlightedWord || highlightedTranslation;

    if (!validElement) return;

    if (this.hoverElement === validElement) return;

    this.clearHoverTimer();

    this.hoverElement = validElement;

    const hoverDelay = this.settings?.hoverDelay ?? 500;
    this.hoverTimer = setTimeout(() => {
      this.handleHoverShow(validElement);
    }, hoverDelay);
  };

  private handleMouseOut = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;

    const isLeavingHighlight =
      target.classList.contains(CSS_CLASSES.HIGHLIGHT) ||
      target.classList.contains('not-translator-grammar-highlight') ||
      target.classList.contains('not-translator-highlighted-word') ||
      target.classList.contains('not-translator-highlighted-translation') ||
      target.closest(`.${CSS_CLASSES.HIGHLIGHT}`) ||
      target.closest('.not-translator-grammar-highlight') ||
      target.closest('.not-translator-highlighted-word') ||
      target.closest('.not-translator-highlighted-translation');

    if (isLeavingHighlight) {
      this.clearHoverTimer();
      this.hoverElement = null;

      if (!this.tooltip.getPinned()) {
        this.tooltip.hide();
      }
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.settings?.enabled) return;

    const activeEl = document.activeElement;
    if (
      activeEl?.tagName === 'INPUT' ||
      activeEl?.tagName === 'TEXTAREA' ||
      (activeEl as HTMLElement)?.isContentEditable
    ) {
      return;
    }

    // 如果 Tooltip 可见，不处理导航快捷键（让 Tooltip 处理 K/U/A 等操作）
    if (this.tooltip.isVisible()) {
      return;
    }

    const key = e.key;

    if (key === 'j' || key === 'J' || key === 'ArrowDown') {
      e.preventDefault();
      this.navigateToNext();
    } else if (key === 'k' || key === 'K' || key === 'ArrowUp') {
      e.preventDefault();
      this.navigateToPrevious();
    }
  };

  constructor() {
    logger.info('NotOnlyTranslator: Content script loaded, starting initialization...');

    this.highlighter = new Highlighter();
    this.marker = new MarkerService();
    this.tooltip = new Tooltip({
      onMarkKnown: (word) => this.handleMarkKnown(word),
      onMarkUnknown: (word, translation) =>
        this.handleMarkUnknown(word, translation),
      onAddToVocabulary: (word, translation) =>
        this.handleAddToVocabulary(word, translation),
    });

    this.init();
  }

  /**
   * Initialize the content script
   */
  private async init(): Promise<void> {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      await new Promise<void>((resolve) => {
        document.addEventListener('DOMContentLoaded', () => resolve());
      });
    }

    // Load settings with retry
    let retryCount = 0;
    const maxRetries = 3;
    while (retryCount < maxRetries) {
      await this.loadSettings();
      if (this.settings) {
        break;
      }
      retryCount++;
      logger.info(`NotOnlyTranslator: Retrying settings load (${retryCount}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!this.settings) {
      logger.error('NotOnlyTranslator: Failed to load settings after retries');
      return;
    }

    if (!this.settings.enabled) {
      logger.info('NotOnlyTranslator: Extension is disabled');
      return;
    }

    // 检查当前页面是否在黑名单中
    if (this.isCurrentPageBlacklisted()) {
      logger.info('NotOnlyTranslator: Current page is blacklisted, skipping');
      return;
    }

    // 检查页面是否为中文页面
    if (this.isChinesePage()) {
      logger.info('NotOnlyTranslator: Current page is Chinese, skipping translation');
      return;
    }

    // Setup event listeners
    this.setupEventListeners();

    // Setup message listener for background script
    this.setupMessageListener();

    // Setup mutation observer for dynamic content
    this.setupMutationObserver();

    // 初始化批量翻译组件
    if (this.useBatchMode) {
      this.initBatchTranslation();
    }

    // Initial page scan (debounced)
    this.scanPage();

    // 初始化浮动模式切换按钮
    this.initFloatingButton();

    logger.info('NotOnlyTranslator initialized with settings:', this.settings);
  }

  /**
   * 初始化批量翻译组件
   * 包括可视区域观察器和批量翻译管理器
   */
  private initBatchTranslation(): void {
    // 创建批量翻译管理器
    this.batchManager = new BatchTranslationManager();
    this.batchManager.setMode(this.settings?.translationMode || 'inline-only');

    // 设置翻译完成回调
    this.batchManager.setOnComplete((element, _result) => {
      // 为翻译完成的元素设置点击处理
      this.setupParagraphClickHandlers(element);
      // 通知观察器该元素已处理
      this.viewportObserver?.markAsProcessed(element);
    });

    // 创建可视区域观察器
    this.viewportObserver = new ViewportObserver((paragraphs: VisibleParagraph[]) => {
      // 当可视区域段落变化时，触发批量翻译
      this.batchManager?.handleVisibleParagraphs(paragraphs);
    });

    logger.info('NotOnlyTranslator: 批量翻译组件已初始化');
  }

  /**
   * 初始化浮动模式切换按钮
   */
  private initFloatingButton(): void {
    // 检查是否在黑名单中
    if (this.isCurrentPageBlacklisted()) {
      logger.info('NotOnlyTranslator: 当前页面在黑名单中，不显示浮动按钮');
      return;
    }

    // 创建浮动按钮
    this.floatingButton = new FloatingButton((mode) => {
      this.handleModeChange(mode);
    });

    // 设置初始模式
    if (this.settings?.translationMode) {
      this.floatingButton.updateMode(this.settings.translationMode);
    }

    logger.info('NotOnlyTranslator: 浮动按钮已初始化');
  }

  /**
   * 处理翻译模式切换
   */
  private handleModeChange(mode: TranslationMode): void {
    if (!this.settings) return;

    // 更新设置
    const newSettings = { ...this.settings, translationMode: mode };
    this.settings = newSettings;

    // 更新批量翻译管理器模式
    this.batchManager?.setMode(mode);

    // 更新浮动按钮显示
    this.floatingButton?.updateMode(mode);

    // 保存设置到 background
    this.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: { translationMode: mode }
    }).then(() => {
      logger.info(`NotOnlyTranslator: 翻译模式已切换为 ${mode}`);
    }).catch((error) => {
      logger.error('NotOnlyTranslator: 保存设置失败:', error);
    });

    // 刷新页面翻译
    this.refreshTranslation(mode);
  }

  /**
   * 刷新页面翻译（模式切换后）
   */
  private refreshTranslation(_mode: TranslationMode): void {
    // 清理之前的刷新定时器
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // 淡出现有翻译
    const processedElements = document.querySelectorAll<HTMLElement>(
      '.not-translator-processed, .not-translator-translation-line'
    );
    processedElements.forEach((el) => el.classList.add('not-translator-fade-out'));

    // 淡出完成后清理并重新扫描
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;

      document.querySelectorAll('.not-translator-processed').forEach((el) => {
        TranslationDisplay.clearTranslation(el as HTMLElement);
      });

      // 重置批量翻译状态
      if (this.batchManager) {
        this.batchManager.clearProcessedCache();
      }
      if (this.viewportObserver) {
        this.viewportObserver.resetTracking();
      }

      this.scanPage();
    }, 150);
  }

  /**
   * 检查当前页面是否在黑名单中
   */
  private isCurrentPageBlacklisted(): boolean {
    if (!this.settings?.blacklist || this.settings.blacklist.length === 0) {
      return false;
    }

    const currentHostname = window.location.hostname;
    const currentUrl = window.location.href;

    return this.settings.blacklist.some((pattern) => {
      // 支持通配符匹配
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
        return regex.test(currentHostname) || regex.test(currentUrl);
      }
      // 精确匹配域名或 URL 包含
      return currentHostname === pattern || currentHostname.endsWith('.' + pattern) || currentUrl.includes(pattern);
    });
  }

  /**
   * 检查页面是否为中文页面
   * 通过以下方式判断：
   * 1. 检查 <html> 标签的 lang 属性
   * 2. 采样页面内容计算中文字符比例
   */
  private isChinesePage(): boolean {
    // 1. 检查 HTML lang 属性
    const htmlLang = document.documentElement.lang?.toLowerCase() || '';
    if (htmlLang.startsWith('zh')) {
      logger.info(`NotOnlyTranslator: Detected Chinese page by lang attribute: ${htmlLang}`);
      return true;
    }

    // 2. 检查 Content-Language meta 标签
    const contentLangMeta = document.querySelector('meta[http-equiv="Content-Language"]');
    const contentLang = contentLangMeta?.getAttribute('content')?.toLowerCase() || '';
    if (contentLang.startsWith('zh')) {
      logger.info(`NotOnlyTranslator: Detected Chinese page by Content-Language: ${contentLang}`);
      return true;
    }

    // 3. 采样页面内容，计算中文字符比例
    const sampleText = this.getPageTextSample();
    if (sampleText.length < 100) {
      // 内容太少，无法判断
      return false;
    }

    const chineseRatio = this.calculateChineseRatio(sampleText);
    const threshold = 0.3; // 中文字符占比超过 30% 认为是中文页面

    if (chineseRatio > threshold) {
      logger.info(`NotOnlyTranslator: Detected Chinese page by content ratio: ${(chineseRatio * 100).toFixed(1)}%`);
      return true;
    }

    return false;
  }

  /**
   * 获取页面文本采样
   * 从主要内容区域采样，避免采样导航、脚注等
   */
  private getPageTextSample(): string {
    // 优先从主内容区域采样
    const contentSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.article-content',
      '.entry-content',
      '#content',
    ];

    let sampleArea: Element | null = null;
    for (const selector of contentSelectors) {
      sampleArea = document.querySelector(selector);
      if (sampleArea && sampleArea.textContent && sampleArea.textContent.trim().length > 200) {
        break;
      }
    }

    // 如果没有找到主内容区域，使用 body
    if (!sampleArea) {
      sampleArea = document.body;
    }

    // 获取文本内容，限制采样长度
    const fullText = sampleArea.textContent || '';
    const maxSampleLength = 2000;

    // 从中间位置采样，避免头尾的导航等内容
    const startPos = Math.max(0, Math.floor(fullText.length / 4));
    const endPos = Math.min(fullText.length, startPos + maxSampleLength);

    return fullText.slice(startPos, endPos);
  }

  /**
   * 计算文本中中文字符的比例
   */
  private calculateChineseRatio(text: string): number {
    if (!text || text.length === 0) return 0;

    // 移除空白字符后计算
    const cleanText = text.replace(/\s/g, '');
    if (cleanText.length === 0) return 0;

    // 匹配中文字符（包括中文标点）
    // CJK Unified Ideographs: \u4e00-\u9fff
    // CJK Symbols and Punctuation: \u3000-\u303f
    // Fullwidth ASCII variants: \uff00-\uffef
    const chineseRegex = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g;
    const chineseMatches = cleanText.match(chineseRegex) || [];

    return chineseMatches.length / cleanText.length;
  }

  /**
   * Load settings from background
   */
  private async loadSettings(): Promise<void> {
    try {
      const response = await this.sendMessage({ type: 'GET_SETTINGS' });
      if (response.success && response.data) {
        this.settings = response.data as UserSettings;
        this.isEnabled = this.settings.enabled;

        // Apply highlight color
        document.documentElement.style.setProperty(
          '--not-translator-highlight-color',
          this.settings.highlightColor
        );

        // 更新批量翻译管理器的翻译模式
        if (this.batchManager) {
          this.batchManager.setMode(this.settings.translationMode);
        }

        logger.info('NotOnlyTranslator: Settings loaded successfully');
      } else {
        logger.warn('NotOnlyTranslator: Failed to load settings:', response.error);
      }
    } catch (error) {
      logger.error('NotOnlyTranslator: Error loading settings:', error);
    }
  }

  /**
   * Setup event listeners for user interactions
   *
   * 设计原则：
   * 1. 不拦截原文的点击事件，保持链接等原有功能
   * 2. 使用选中（mouseup）来触发翻译弹窗
   * 3. 只有在选中高亮词时才显示详细信息和操作按钮
   * 4. 支持悬停延迟触发 Tooltip
   */
  private setupEventListeners(): void {
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('mousedown', this.handleMouseDown);

    // 悬停触发 Tooltip
    this.setupHoverListeners();
  }

  /**
   * 设置悬停触发 Tooltip 的事件监听
   */
  private setupHoverListeners(): void {
    const hoverDelay = this.settings?.hoverDelay ?? 500;
    if (hoverDelay <= 0) {
      logger.info('NotOnlyTranslator: 悬停触发已关闭');
      return;
    }

    document.addEventListener('mouseover', this.handleMouseOver);
    document.addEventListener('mouseout', this.handleMouseOut);

    logger.info(`NotOnlyTranslator: 悬停触发已启用，延迟 ${hoverDelay}ms`);

    // 键盘导航事件监听
    this.setupNavigationListeners();
  }

  /**
   * 设置键盘导航事件监听
   */
  private setupNavigationListeners(): void {
    document.addEventListener('keydown', this.handleKeyDown);
    logger.info('NotOnlyTranslator: 键盘导航已启用（J/↓ 下一个，K/↑ 上一个）');
  }

  /**
   * 获取页面上所有可导航的高亮元素
   */
  private getNavigableHighlights(): HTMLElement[] {
    const selectors = [
      `.${CSS_CLASSES.HIGHLIGHT}`,
      '.not-translator-grammar-highlight',
      '.not-translator-highlighted-word',
      '.not-translator-highlighted-translation',
    ];

    const elements: HTMLElement[] = [];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (el instanceof HTMLElement) {
          elements.push(el);
        }
      });
    });

    // 按在页面中的位置排序（从上到下）
    elements.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      if (rectA.top !== rectB.top) {
        return rectA.top - rectB.top;
      }
      return rectA.left - rectB.left;
    });

    return elements;
  }

  /**
   * 导航到下一个高亮词
   */
  private navigateToNext(): void {
    this.navigableHighlights = this.getNavigableHighlights();
    if (this.navigableHighlights.length === 0) return;

    this.currentNavigateIndex++;
    if (this.currentNavigateIndex >= this.navigableHighlights.length) {
      this.currentNavigateIndex = 0; // 循环到第一个
    }

    this.showNavigationTooltip();
  }

  /**
   * 导航到上一个高亮词
   */
  private navigateToPrevious(): void {
    this.navigableHighlights = this.getNavigableHighlights();
    if (this.navigableHighlights.length === 0) return;

    this.currentNavigateIndex--;
    if (this.currentNavigateIndex < 0) {
      this.currentNavigateIndex = this.navigableHighlights.length - 1; // 循环到最后一个
    }

    this.showNavigationTooltip();
  }

  /**
   * 显示当前导航位置的 Tooltip
   */
  private showNavigationTooltip(): void {
    const element = this.navigableHighlights[this.currentNavigateIndex];
    if (!element) return;

    // 滚动到元素
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 添加导航高亮效果
    this.highlightNavigationElement(element);

    // 显示 Tooltip
    this.handleHoverShow(element);

    // 显示位置指示
    this.showNavigationIndicator();
  }

  /**
   * 高亮当前导航的元素
   */
  private highlightNavigationElement(element: HTMLElement): void {
    // 移除之前的高亮
    document.querySelectorAll('.not-translator-nav-highlight').forEach((el) => {
      el.classList.remove('not-translator-nav-highlight');
    });

    // 清除之前的导航高亮定时器
    if (this.navHighlightTimer) {
      clearTimeout(this.navHighlightTimer);
      this.navHighlightTimer = null;
    }

    // 添加新的高亮
    element.classList.add('not-translator-nav-highlight');

    // 2秒后移除高亮效果
    this.navHighlightTimer = setTimeout(() => {
      element.classList.remove('not-translator-nav-highlight');
      this.navHighlightTimer = null;
    }, 2000);
  }

  /**
   * 显示导航位置指示器
   */
  private showNavigationIndicator(): void {
    // 更新 tooltip 标题显示位置
    const current = this.currentNavigateIndex + 1;
    const total = this.navigableHighlights.length;

    // 在 tooltip 中添加位置信息
    const tooltipElement = document.getElementById('not-translator-tooltip');
    if (tooltipElement) {
      let indicator = tooltipElement.querySelector('.not-translator-nav-indicator');
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'not-translator-nav-indicator';
        const content = tooltipElement.querySelector('.not-translator-tooltip-content');
        if (content) {
          content.insertBefore(indicator, content.firstChild);
        }
      }
      indicator.textContent = `${current} / ${total}`;
    }
  }

  /**
   * 清除悬停定时器
   */
  private clearHoverTimer(): void {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  /**
   * 处理悬停显示 Tooltip
   */
  private handleHoverShow(element: HTMLElement): void {
    // 语法高亮
    if (element.classList.contains('not-translator-grammar-highlight')) {
      const explanation = element.dataset.grammarExplanation || '';
      const type = element.dataset.grammarType || '语法点';
      const original = element.dataset.grammarOriginal || element.textContent || '';

      this.tooltip.showGrammar(element, {
        original,
        explanation,
        type,
        position: [0, 0]
      });
      return;
    }

    // 双文对照模式下的原文高亮或全文翻译模式下的译文高亮
    if (element.classList.contains('not-translator-highlighted-word') ||
        element.classList.contains('not-translator-highlighted-translation')) {
      const word = element.dataset.word || element.textContent?.trim() || '';
      const translation = element.dataset.translation || '';
      const difficulty = parseInt(element.dataset.difficulty || '5', 10);
      const isPhrase = element.dataset.isPhrase === 'true';

      if (word && (translation || element.classList.contains('not-translator-highlighted-translation'))) {
        // 对于 highlighted-translation，尝试从 data-original 获取原文
        const originalWord = element.dataset.original || word;
        this.tooltip.showWord(element, {
          original: originalWord,
          translation: translation || originalWord,
          position: [0, 0],
          difficulty,
          isPhrase,
        });
      }
      return;
    }

    // 普通高亮词（行内模式）
    const word = element.dataset.word || element.textContent?.replace(/\(.*\)$/, '').trim() || '';
    const translation = element.dataset.translation || '';
    const difficulty = parseInt(element.dataset.difficulty || '5', 10);
    const isPhrase = element.dataset.isPhrase === 'true';

    if (translation) {
      this.tooltip.showWord(element, {
        original: word,
        translation,
        position: [0, 0],
        difficulty,
        isPhrase,
      });
    } else if (word) {
      // 没有翻译数据时，获取翻译
      this.tooltip.showLoading(element);
      this.translateSelection(word, element);
    }
  }

  /**
   * 处理文本选中事件
   * 当用户选中高亮词或普通文本时触发
   */
  private handleTextSelection(_e: MouseEvent): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length === 0) return;

    // 检查选中的内容是否在高亮词内或包含高亮词
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    // 找到最近的高亮元素
    let highlightElement: HTMLElement | null = null;

    if (container.nodeType === Node.TEXT_NODE) {
      const parent = container.parentElement;
      if (parent?.classList.contains(CSS_CLASSES.HIGHLIGHT)) {
        highlightElement = parent;
      }
    } else if (container instanceof HTMLElement) {
      if (container.classList.contains(CSS_CLASSES.HIGHLIGHT)) {
        highlightElement = container;
      } else {
        highlightElement = container.querySelector(`.${CSS_CLASSES.HIGHLIGHT}`);
      }
    }

    // 如果选中的是高亮词，显示详细信息
    if (highlightElement) {
      // 检查是否是语法高亮
      if (highlightElement.classList.contains('not-translator-grammar-highlight')) {
        const explanation = highlightElement.dataset.grammarExplanation || '';
        const type = highlightElement.dataset.grammarType || '语法点';
        const original = highlightElement.dataset.grammarOriginal || highlightElement.textContent || '';

        this.tooltip.showGrammar(highlightElement, {
          original,
          explanation,
          type,
          position: [0, 0]
        });
        return;
      }

      const word = highlightElement.dataset.word || highlightElement.textContent?.replace(/\(.*\)$/, '').trim() || '';
      const translation = highlightElement.dataset.translation || '';
      const difficulty = parseInt(highlightElement.dataset.difficulty || '5', 10);
      const isPhrase = highlightElement.dataset.isPhrase === 'true';

      if (translation) {
        this.tooltip.showWord(highlightElement, {
          original: word,
          translation,
          position: [0, 0],
          difficulty,
          isPhrase,
        });
      } else {
        // 没有翻译数据时，获取翻译
        this.tooltip.showLoading(highlightElement);
        this.translateSelection(word, highlightElement);
      }
    } else if (selectedText.length > 1 && selectedText.length < 100) {
      // 选中的是普通文本，提供翻译选项
      const rect = range.getBoundingClientRect();
      const tempElement = document.createElement('span');
      tempElement.style.position = 'absolute';
      tempElement.style.left = `${rect.left + window.scrollX}px`;
      tempElement.style.top = `${rect.bottom + window.scrollY}px`;
      tempElement.style.pointerEvents = 'none';
      document.body.appendChild(tempElement);

      this.translateSelection(selectedText, tempElement).finally(() => {
        setTimeout(() => {
          if (document.body.contains(tempElement)) {
            document.body.removeChild(tempElement);
          }
        }, 100);
      });
    }
  }

  /**
   * Setup message listener for background script messages
   */
  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener(
      (message: Message & { type: string }, _sender, sendResponse) => {
        switch (message.type) {
          case 'SHOW_TRANSLATION':
            this.handleShowTranslation(message.payload as { text: string });
            sendResponse({ success: true });
            break;

          case 'WORD_MARKED':
            this.handleWordMarked(
              message.payload as { word: string; isKnown: boolean }
            );
            sendResponse({ success: true });
            break;

          case 'ADDED_TO_VOCABULARY':
            this.handleAddedToVocabulary(
              message.payload as { word: string; translation: string }
            );
            sendResponse({ success: true });
            break;

          case 'SETTINGS_UPDATED':
            this.handleSettingsUpdated();
            sendResponse({ success: true });
            break;

          case 'TOGGLE_ENABLED':
            this.toggleEnabled();
            sendResponse({ success: true });
            break;

          default:
            sendResponse({ success: false, error: 'Unknown message type' });
        }
        return true;
      }
    );
  }

  /**
   * Setup mutation observer for dynamic content
   * 当检测到新内容时，将其注册到可视区域观察器（批量模式）
   * 或触发页面扫描（非批量模式）
   */
  private setupMutationObserver(): void {
    const debouncedScan = debounce(() => this.scanPage(), 1000);

    this.observer = new MutationObserver((mutations) => {
      // 收集新添加的内容元素
      const newElements: HTMLElement[] = [];

      mutations.forEach((mutation) => {
        Array.from(mutation.addedNodes).forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;

            // 跳过翻译相关的元素
            if (
              el.classList.contains(CSS_CLASSES.TOOLTIP) ||
              el.classList.contains(CSS_CLASSES.HIGHLIGHT) ||
              el.classList.contains('not-translator-processed')
            ) {
              return;
            }

            // 查找新元素中的段落
            const paragraphs = el.querySelectorAll<HTMLElement>(
              'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption'
            );

            paragraphs.forEach((p) => {
              if (p.textContent && p.textContent.trim().length >= 50) {
                newElements.push(p);
              }
            });

            // 如果元素本身是有效段落
            if (el.textContent && el.textContent.trim().length >= 50) {
              const tagName = el.tagName.toLowerCase();
              if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'blockquote', 'figcaption'].includes(tagName)) {
                newElements.push(el);
              }
            }
          }
        });
      });

      // 如果没有新内容或自动高亮被禁用，跳过
      if (newElements.length === 0 || !this.settings?.autoHighlight) {
        return;
      }

      logger.info(`NotOnlyTranslator: MutationObserver 检测到 ${newElements.length} 个新元素`);

      // 批量模式：直接注册到观察器
      if (this.useBatchMode && this.viewportObserver) {
        this.viewportObserver.observeAll(newElements);
        // 触发检查当前可视区域
        this.viewportObserver.checkCurrentViewport();
      } else {
        // 非批量模式：触发防抖扫描
        debouncedScan();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Scan page for content to translate
   * 使用批量翻译模式时，将段落注册到可视区域观察器
   * 非批量模式时，使用原有的逐段翻译逻辑
   */
  private async scanPage(): Promise<void> {
    if (!this.isEnabled) {
      logger.info('NotOnlyTranslator: Scan skipped - extension disabled');
      return;
    }
    if (!this.settings?.autoHighlight) {
      logger.info('NotOnlyTranslator: Scan skipped - autoHighlight disabled');
      return;
    }

    const mode = this.settings?.translationMode || 'inline-only';
    logger.info(`NotOnlyTranslator: Starting scan with mode: ${mode}`);

    // Get paragraphs to translate
    const paragraphs = this.getParagraphs();
    logger.info(`NotOnlyTranslator: Found ${paragraphs.length} paragraphs to scan`);

    // 批量翻译模式：使用可视区域观察器
    if (this.useBatchMode && this.viewportObserver && this.batchManager) {
      // 更新翻译模式
      this.batchManager.setMode(mode);

      // 将所有段落注册到观察器
      this.viewportObserver.observeAll(paragraphs);

      // 立即检查当前可视区域
      this.viewportObserver.checkCurrentViewport();

      logger.info('NotOnlyTranslator: 批量模式扫描完成，已注册到观察器');
      return;
    }

    // 非批量模式：使用原有的逐段翻译逻辑（保持向后兼容）
    await this.scanPageSequential(paragraphs, mode);
  }

  /**
   * 顺序扫描页面（原有逻辑，保持向后兼容）
   */
  private async scanPageSequential(paragraphs: HTMLElement[], mode: string): Promise<void> {
    for (const paragraph of paragraphs) {
      // Skip already processed paragraphs
      if (TranslationDisplay.isProcessed(paragraph)) continue;

      const text = paragraph.textContent || '';
      if (text.length < 50) continue;

      try {
        logger.info(`NotOnlyTranslator: Translating paragraph (${text.length} chars):`, text.substring(0, 100) + '...');

        // Save original text before modifying
        TranslationDisplay.saveOriginalText(paragraph);

        const result = await this.translateText(text);

        logger.info('NotOnlyTranslator: Translation result received:', {
          wordsCount: result.words?.length || 0,
          sentencesCount: result.sentences?.length || 0,
          hasFullText: !!result.fullText,
          fullTextPreview: result.fullText?.substring(0, 100) || 'N/A',
          words: result.words?.slice(0, 3) || []
        });

        // Apply translation based on mode
        if (result.words.length > 0 || result.fullText) {
          logger.info(`NotOnlyTranslator: Applying translation to paragraph with mode: ${mode}`);
          TranslationDisplay.applyTranslation(paragraph, result, mode as import('@/shared/types').TranslationMode);

          // Setup click handlers for highlighted words in the paragraph
          this.setupParagraphClickHandlers(paragraph);
          logger.info('NotOnlyTranslator: Translation applied successfully');
        } else {
          logger.info('NotOnlyTranslator: No words or fullText in result, skipping paragraph');
        }
      } catch (error) {
        logger.error('NotOnlyTranslator: Failed to translate content:', error);
      }
    }
    logger.info('NotOnlyTranslator: Scan completed');
  }

  /**
   * Setup handlers for highlighted words in a paragraph
   *
   * 注意：不再添加点击事件，避免干扰原有链接等功能
   * 用户需要选中（select）高亮词才会触发翻译弹窗
   */
  private setupParagraphClickHandlers(paragraph: HTMLElement): void {
    // 只设置悬停效果，不添加点击事件
    // 点击/选中由全局 handleTextSelection 处理
    this.setupBilingualHoverEffects(paragraph);
  }

  /**
   * Setup hover effects for bilingual mode to link original and translation highlights
   * 注意：译文行现在在段落后面，需要从相邻元素中查找
   */
  private setupBilingualHoverEffects(paragraph: HTMLElement): void {
    const originalHighlights = paragraph.querySelectorAll('.not-translator-highlighted-word');

    // 查找段落后面的译文行
    const translationLine = paragraph.nextElementSibling;
    if (!translationLine?.classList.contains('not-translator-translation-line')) {
      return;
    }

    originalHighlights.forEach((original) => {
      const index = original.getAttribute('data-index');
      const corresponding = translationLine.querySelector(`.not-translator-highlighted-translation[data-index="${index}"]`);

      if (corresponding) {
        original.addEventListener('mouseenter', () => {
          corresponding.classList.add('not-translator-hover-linked');
        });
        original.addEventListener('mouseleave', () => {
          corresponding.classList.remove('not-translator-hover-linked');
        });

        corresponding.addEventListener('mouseenter', () => {
          original.classList.add('not-translator-hover-linked');
        });
        corresponding.addEventListener('mouseleave', () => {
          original.classList.remove('not-translator-hover-linked');
        });
      }
    });
  }

  /**
   * Get paragraphs to translate
   */
  private getParagraphs(): HTMLElement[] {
    const contentAreas = this.getContentAreas();
    const paragraphs: HTMLElement[] = [];

    for (const area of contentAreas) {
      // Get all paragraph-like elements
      const elements = area.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption');
      elements.forEach((el) => {
        // Skip if already processed or has no meaningful content
        if (!TranslationDisplay.isProcessed(el) && el.textContent && el.textContent.trim().length >= 50) {
          paragraphs.push(el);
        }
      });

      // If no specific elements found, treat the whole area as one paragraph
      if (paragraphs.length === 0 && area.textContent && area.textContent.trim().length >= 50) {
        paragraphs.push(area);
      }
    }

    return paragraphs;
  }

  /**
   * Get content areas to scan
   */
  private getContentAreas(): HTMLElement[] {
    // Try to find main content areas
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.article-content',
      '.entry-content',
      '#content',
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      if (elements.length > 0) {
        return Array.from(elements);
      }
    }

    // Fallback to body
    return [document.body];
  }

  /**
   * Translate text using background service
   */
  private async translateText(text: string, context?: string): Promise<TranslationResult> {
    const mode = this.settings?.translationMode || 'inline-only';

    logger.info('NotOnlyTranslator: Sending TRANSLATE_TEXT message to background');
    const response = await this.sendMessage({
      type: 'TRANSLATE_TEXT',
      payload: {
        text,
        context: context || '',
        mode,
      },
    }, 30000);

    logger.info('NotOnlyTranslator: Received response from background:', {
      success: response.success,
      error: response.error,
      hasData: !!response.data,
      dataType: typeof response.data,
      dataPreview: response.data ? JSON.stringify(response.data).substring(0, 200) : 'N/A'
    });

    if (!response.success) {
      throw new Error(response.error || 'Translation failed');
    }

    return response.data as TranslationResult;
  }

  /**
   * Translate a selection and show tooltip
   */
  private async translateSelection(
    text: string,
    targetElement: HTMLElement
  ): Promise<void> {
    try {
      this.tooltip.showLoading(targetElement);

      const result = await this.translateText(text);

      if (result.words.length > 0) {
        this.tooltip.showWord(targetElement, result.words[0]);
      } else if (result.sentences.length > 0) {
        this.tooltip.showSentence(targetElement, result.sentences[0]);
      } else {
        this.tooltip.showError(targetElement, '未找到需要翻译的内容');
      }
    } catch (error) {
      this.tooltip.showError(
        targetElement,
        error instanceof Error ? error.message : '翻译失败'
      );
    }
  }

  /**
   * Handle mark as known
   */
  private async handleMarkKnown(word: string): Promise<void> {
    try {
      await this.marker.markKnown(word);
      this.highlighter.markAsKnown(word);
    } catch (error) {
      logger.error('Failed to mark as known:', error);
    }
  }

  /**
   * Handle mark as unknown
   */
  private async handleMarkUnknown(
    word: string,
    translation: string
  ): Promise<void> {
    try {
      const context = this.marker.getSelectionContext();
      await this.marker.markUnknown(word, translation, context);
      this.highlighter.markAsUnknown(word);
    } catch (error) {
      logger.error('Failed to mark as unknown:', error);
    }
  }

  /**
   * Handle add to vocabulary
   */
  private async handleAddToVocabulary(
    word: string,
    translation: string
  ): Promise<void> {
    try {
      const context = this.marker.getSelectionContext();
      await this.marker.addToVocabulary(word, translation, context);
      this.highlighter.markAsUnknown(word);
    } catch (error) {
      logger.error('Failed to add to vocabulary:', error);
    }
  }

  /**
   * Handle show translation message from context menu
   */
  private handleShowTranslation(payload: { text: string }): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Create temporary element for positioning
    const tempElement = document.createElement('span');
    tempElement.style.position = 'absolute';
    tempElement.style.left = `${rect.left + window.scrollX}px`;
    tempElement.style.top = `${rect.bottom + window.scrollY}px`;
    document.body.appendChild(tempElement);

    this.translateSelection(payload.text, tempElement).then(() => {
      // Remove temp element after a delay
      setTimeout(() => {
        if (document.body.contains(tempElement)) {
          document.body.removeChild(tempElement);
        }
      }, 100);
    });
  }

  /**
   * Handle word marked message
   */
  private handleWordMarked(payload: { word: string; isKnown: boolean }): void {
    if (payload.isKnown) {
      this.highlighter.markAsKnown(payload.word);
    } else {
      this.highlighter.markAsUnknown(payload.word);
    }
  }

  /**
   * Handle added to vocabulary message
   */
  private handleAddedToVocabulary(payload: {
    word: string;
    translation: string;
  }): void {
    this.highlighter.markAsUnknown(payload.word);
  }

  /**
   * 处理设置更新（包括翻译模式切换）
   */
  private async handleSettingsUpdated(): Promise<void> {
    const oldMode = this.settings?.translationMode;
    await this.loadSettings();
    const newMode = this.settings?.translationMode;

    // 如果翻译模式改变了，使用淡出过渡刷新翻译
    if (oldMode !== newMode && newMode && this.isEnabled) {
      logger.info(`NotOnlyTranslator: 翻译模式从 ${oldMode} 切换为 ${newMode}`);
      this.refreshTranslation(newMode);
    }
  }

  /**
   * Toggle enabled state
   */
  private toggleEnabled(): void {
    this.isEnabled = !this.isEnabled;

    if (!this.isEnabled) {
      this.highlighter.clearAllHighlights();
      this.tooltip.hide();
      // Clear all translation displays
      this.clearAllTranslations();

      // 禁用批量翻译组件
      this.viewportObserver?.disable();
      this.batchManager?.cancelAll();
    } else {
      // 重新启用批量翻译组件
      this.viewportObserver?.enable();
      this.scanPage();
    }
  }

  /**
   * Clear all translations from the page
   */
  private clearAllTranslations(): void {
    const processedElements = document.querySelectorAll<HTMLElement>('.not-translator-processed');
    processedElements.forEach((element) => {
      TranslationDisplay.clearTranslation(element);
    });
  }

  /**
   * Send message to background script
   */
  private async sendMessage(message: Message, timeout: number = 5000): Promise<MessageResponse> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    return Promise.race([
      new Promise<MessageResponse>((resolve) => {
        chrome.runtime.sendMessage(message, (response: MessageResponse) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: chrome.runtime.lastError.message,
            });
          } else {
            resolve(response || { success: false, error: 'No response' });
          }
        });
      }),
      new Promise<MessageResponse>((resolve) => {
        timeoutId = setTimeout(() => {
          timeoutId = null;
          resolve({ success: false, error: '请求超时，请重试' });
        }, timeout);
      }),
    ]);
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // 清理 document 级别事件监听器
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mouseover', this.handleMouseOver);
    document.removeEventListener('mouseout', this.handleMouseOut);
    document.removeEventListener('keydown', this.handleKeyDown);

    // 清理定时器
    this.clearHoverTimer();
    if (this.navHighlightTimer) {
      clearTimeout(this.navHighlightTimer);
      this.navHighlightTimer = null;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // 清理浮动按钮
    this.floatingButton?.destroy();

    // 清理 MutationObserver
    this.observer?.disconnect();

    // 清理批量翻译组件
    this.viewportObserver?.destroy();
    this.batchManager?.cancelAll();

    // 清理高亮和提示框
    this.highlighter.clearAllHighlights();
    this.tooltip.destroy();

    logger.info('NotOnlyTranslator: 已销毁');
  }
}

// For CRXJS - the onExecute function is called when the content script is injected
let translator: NotOnlyTranslator | null = null;

export function onExecute() {
  if (!translator) {
    translator = new NotOnlyTranslator();

    // Cleanup on page hide (unload is deprecated)
    window.addEventListener('pagehide', () => {
      translator?.destroy();
      translator = null;
    });
  }
}

// Also auto-initialize for non-CRXJS environments
if (typeof chrome !== 'undefined' && chrome.runtime) {
  onExecute();
}

export { NotOnlyTranslator };
