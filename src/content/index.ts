import type {
  Message,
  MessageResponse,
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
   */
  private setupEventListeners(): void {
    // 监听 mouseup 事件，检测用户是否选中了文本
    document.addEventListener('mouseup', (e) => {
      if (!this.settings?.enabled) return;

      // 延迟一下让选区稳定
      setTimeout(() => {
        this.handleTextSelection(e);
      }, 50);
    });

    // 点击其他地方时隐藏 tooltip
    document.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      // 如果点击的不是 tooltip 内部，则隐藏
      if (!target.closest('.not-translator-tooltip')) {
        this.tooltip.hide();
      }
    });
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
    });

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

    // 如果翻译模式改变了，需要清除已处理的段落并重新翻译
    if (oldMode !== newMode) {
      logger.info(`NotOnlyTranslator: 翻译模式从 ${oldMode} 切换为 ${newMode}`);

      // 清除所有已翻译的内容
      this.clearAllTranslations();

      // 重置批量翻译管理器的缓存状态
      if (this.batchManager) {
        this.batchManager.clearProcessedCache();
      }

      // 重置可视区域观察器的追踪状态
      if (this.viewportObserver) {
        this.viewportObserver.resetTracking();
      }

      // 重新扫描页面
      if (this.isEnabled) {
        this.scanPage();
      }
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
  private async sendMessage(message: Message): Promise<MessageResponse> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response: MessageResponse) => {
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
   * Cleanup
   */
  destroy(): void {
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
