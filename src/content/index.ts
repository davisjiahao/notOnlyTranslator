import type {
  Message,
  MessageResponse,
  TranslationMode,
  TranslationResult,
  UserSettings,
} from '@/shared/types';
import { CSS_CLASSES, CHINESE_DETECTION_THRESHOLD, DEFAULT_BATCH_CONFIG, MAX_TRANSLATION_TEXT_LENGTH, TIMING } from '@/shared/constants';
import { debounce, logger, getChineseRatio } from '@/shared/utils';
import { MetricType, recordMetric } from '@/shared/performance';
import { OptimizedHighlighter } from './optimizedHighlighter';
import { Tooltip } from './tooltip';
import { MarkerService } from './marker';
import { TranslationDisplay } from './translationDisplay';
import { ViewportObserver, VisibleParagraph } from './viewportObserver';
import { BatchTranslationManager } from './batchTranslationManager';
import { FloatingButton } from './floatingButton';
import { NavigationManager, PageScanner, HoverManager, isInExcludedArea } from './core';
import { VocabularyHighlighter } from './vocabularyHighlighter';
import { getTranslatableText } from './pageScanner';
import {
  VocabularyStateSync,
  fetchVocabularySnapshot,
  type VocabularySnapshot,
} from './core/vocabularyState';
import { sendTranslationMessage, cancelTranslationMessages } from './translationMessaging';

/**
 * 扩展 Window 接口以支持 E2E 测试所需的属性
 */
declare global {
  interface Window {
    __EXTENSION_LOADED__?: boolean;
    __NOT_ONLY_TRANSLATOR__?: NotOnlyTranslator;
  }
}

/**
 * Content Script - main entry point for page interaction
 */
class NotOnlyTranslator {
  private highlighter: OptimizedHighlighter;
  private tooltip: Tooltip;
  private marker: MarkerService;
  private settings: UserSettings | undefined = undefined;
  /** 设置读取按发起顺序提交，本地设置选择也会作废旧读取。 */
  private settingsReadGeneration = 0;
  private isEnabled: boolean = true;
  private observer: MutationObserver | null = null;
  private removeMessageListener: (() => void) | null = null;

  /** 最近一次标记操作记录，用于撤销 */
  private lastMarkAction: { type: 'known' | 'unknown' | 'add'; word: string; translation: string } | null = null;

  /** 可视区域观察器 - 用于批量翻译 */
  private viewportObserver: ViewportObserver | null = null;

  /** 批量翻译管理器 */
  private batchManager: BatchTranslationManager | null = null;

  /** 是否使用批量翻译模式 */
  private useBatchMode: boolean = true;

  /** 浮动模式切换按钮 */
  private floatingButton: FloatingButton | null = null;

  /** 导航管理器 */
  private navigationManager: NavigationManager;

  /** 页面扫描器 */
  private pageScanner: PageScanner;

  /** 悬停管理器 */
  private hoverManager: HoverManager | null = null;

  /** 刷新翻译定时器 */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** 词汇高亮器 - 用于 CEFR 词汇水平高亮 */
  private vocabHighlighter: VocabularyHighlighter | null = null;

  /** 词汇状态同步器 - 跨标签页 storage 变化时去抖重新同步 */
  private vocabStateSync: VocabularyStateSync | null = null;

  /** 在途翻译的代际；失效后旧异步延续不得修改页面 */
  private translationGeneration = 0;

  /** Tooltip 请求代际；保证较旧响应不会覆盖较新请求 */
  private tooltipRequestGeneration = 0;

  /** 销毁后禁止发起请求或修改 DOM */
  private destroyed = false;

  // ---- 事件处理器（箭头函数保持 this 绑定）----

  private handleMouseUp = (e: MouseEvent): void => {
    if (!this.settings?.enabled) return;
    // 扩展控件上的操作不是网页划词，不能用旧选区重开浮层覆盖撤销反馈。
    if ((e.target as Element | null)?.closest('.not-translator-tooltip, .not-translator-floating-btn')) return;
    setTimeout(() => {
      this.handleTextSelection(e);
    }, TIMING.SELECTION_DELAY);
  };

  private handleMouseDown = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (!this.tooltip.contains(target)) {
      this.tooltip.hide(false);
    }
  };

  private handleMouseOver = (e: MouseEvent): void => {
    if (!this.settings?.enabled) return;
    this.hoverManager?.handleMouseOver(e);
  };

  private handleMouseOut = (e: MouseEvent): void => {
    this.hoverManager?.handleMouseOut(e);
  };

  /**
   * 处理双击查词
   * 双击任意单词时立即显示翻译 Tooltip
   */
  private handleDoubleClick = (e: MouseEvent): void => {
    if (!this.settings?.enabled) return;

    const target = e.target as HTMLElement;

    // 忽略在 Tooltip 内的双击
    if (target.closest('.not-translator-tooltip')) return;

    // 获取双击位置的单词
    const selection = window.getSelection();
    if (!selection) return;

    // 清除之前的选择
    selection.removeAllRanges();

    // 使用 document.caretRangeFromPoint 获取光标位置的范围
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range || !range.startContainer) return;

    // 扩展选区到整个单词
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    const text = textNode.textContent || '';
    const offset = range.startOffset;

    // 找到单词边界
    const wordStart = this.findWordBoundary(text, offset, 'start');
    const wordEnd = this.findWordBoundary(text, offset, 'end');

    if (wordStart === wordEnd) return;

    const word = text.substring(wordStart, wordEnd).trim();
    if (!word || word.length < 2) return;

    // 设置选区
    const wordRange = document.createRange();
    wordRange.setStart(textNode, wordStart);
    wordRange.setEnd(textNode, wordEnd);
    selection.addRange(wordRange);

    // 翻译并显示 Tooltip
    this.translateAndShowTooltip(word, target);
  };

  /**
   * 查找单词边界
   */
  private findWordBoundary(text: string, offset: number, direction: 'start' | 'end'): number {
    const isWordChar = (char: string) => /[a-zA-Z]/.test(char);

    if (direction === 'start') {
      let pos = offset;
      while (pos > 0 && isWordChar(text[pos - 1])) {
        pos--;
      }
      return pos;
    } else {
      let pos = offset;
      while (pos < text.length && isWordChar(text[pos])) {
        pos++;
      }
      return pos;
    }
  }

  /**
   * 翻译单词并显示 Tooltip
   */
  private async translateAndShowTooltip(word: string, target: HTMLElement): Promise<void> {
    const token = this.startTooltipRequest();
    try {
      this.tooltip.showLoading(target);
      const userLevel = await this.getUserProfile();
      if (!this.isTooltipRequestCurrent(token)) return;

      const response = await sendTranslationMessage({
        type: 'TRANSLATE_TEXT',
        payload: {
          text: word,
          context: word,
          userLevel,
          mode: 'inline-only' as TranslationMode,
        },
      });
      if (!this.isTooltipRequestCurrent(token)) return;

      if (!response.success || !response.data) {
        this.tooltip.showError(target, '翻译失败，请稍后重试');
        logger.warn('双击翻译失败:', response.error);
        return;
      }

      const result = response.data as TranslationResult;

      if (result.words?.[0]) {
        this.tooltip.showWord(target, result.words[0]);
      } else if (result.fullText) {
        this.tooltip.showWord(target, {
          original: word,
          translation: result.fullText,
          position: [0, word.length],
          difficulty: 5,
          isPhrase: false,
        });
      } else {
        this.tooltip.showError(target, '未找到翻译');
      }

      logger.info('双击查词:', word);
    } catch (error) {
      if (!this.isTooltipRequestCurrent(token)) return;
      this.tooltip.showError(target, '翻译出错');
      logger.error('双击翻译出错:', error);
    }
  }

  /**
   * 翻译词汇高亮词并显示 Tooltip
   * 包含 CEFR 等级信息
   */
  private async translateAndShowVocabTooltip(
    word: string,
    target: HTMLElement,
    level: string,
    difficulty: number
  ): Promise<void> {
    const token = this.startTooltipRequest();
    try {
      this.tooltip.showLoading(target);
      const userLevel = await this.getUserProfile();
      if (!this.isTooltipRequestCurrent(token)) return;

      const response = await sendTranslationMessage({
        type: 'TRANSLATE_TEXT',
        payload: {
          text: word,
          context: word,
          userLevel,
          mode: 'inline-only' as TranslationMode,
        },
      });
      if (!this.isTooltipRequestCurrent(token)) return;

      if (!response.success || !response.data) {
        this.tooltip.showError(target, '翻译失败，请稍后重试');
        logger.warn('词汇翻译失败:', response.error);
        return;
      }

      const result = response.data as TranslationResult;
      const translation = result.words?.[0]?.translation || result.fullText || '';

      if (translation) {
        target.dataset.translation = translation;
        this.tooltip.showWord(target, {
          original: word,
          translation,
          position: [0, word.length],
          difficulty,
          isPhrase: false,
        });
        this.addCEFRLevelBadge(level);
      } else {
        this.tooltip.showError(target, '未找到翻译');
      }

      logger.info(`词汇查词: ${word} (${level})`);
    } catch (error) {
      if (!this.isTooltipRequestCurrent(token)) return;
      this.tooltip.showError(target, '翻译出错');
      logger.error('词汇翻译出错:', error);
    }
  }

  /**
   * 在 Tooltip 中添加 CEFR 等级标签
   */
  private addCEFRLevelBadge(level: string): void {
    const tooltipEl = this.tooltip.getElement();
    if (!tooltipEl) return;

    const header = tooltipEl.querySelector(`.${CSS_CLASSES.TOOLTIP}-header`);
    if (!header) return;

    // 检查是否已有等级标签
    if (header.querySelector('.not-translator-cefr-badge')) return;

    // 创建 CEFR 等级标签
    const badge = document.createElement('span');
    badge.className = `not-translator-cefr-badge not-translator-cefr-${level.toLowerCase()}`;
    badge.textContent = level;
    // WCAG 1.3.1: 为屏幕阅读器提供等级语义说明
    badge.setAttribute('aria-label', `CEFR 难度等级 ${level}`);
    header.appendChild(badge);
  }

  /**
   * 获取用户配置
   */
  private async getUserProfile() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_USER_PROFILE' });
    return response.data;
  }

  /** 创建普通翻译请求的代际令牌 */
  private startTranslationRequest(): number {
    return this.translationGeneration;
  }

  /** 创建 Tooltip 请求令牌，后发请求会使此前 Tooltip 响应过期 */
  private startTooltipRequest(): { translationGeneration: number; tooltipGeneration: number } {
    this.tooltipRequestGeneration++;
    return {
      translationGeneration: this.translationGeneration,
      tooltipGeneration: this.tooltipRequestGeneration,
    };
  }

  /** 检查普通翻译请求仍处于当前页面生命周期 */
  private isTranslationRequestCurrent(generation: number): boolean {
    return !this.destroyed && this.isEnabled && generation === this.translationGeneration;
  }

  /** 检查 Tooltip 请求既未取消也未被更晚的 Tooltip 请求取代 */
  private isTooltipRequestCurrent(token: {
    translationGeneration: number;
    tooltipGeneration: number;
  }): boolean {
    return this.isTranslationRequestCurrent(token.translationGeneration)
      && token.tooltipGeneration === this.tooltipRequestGeneration
      && this.tooltip.isVisible();
  }

  /** 作废所有在途翻译，并清除不再有效的加载状态
   * @param notifyBackground false 为页面卸载路径：只做前端清理，不发后台取消，
   *   让后台在途批次继续完成并写缓存（费用已花，写缓存是止损）
   */
  private cancelInFlightTranslations(notifyBackground = true): void {
    this.translationGeneration++;
    this.tooltipRequestGeneration++;
    cancelTranslationMessages(notifyBackground);
    this.tooltip.hide();
    document.querySelectorAll<HTMLElement>('.not-translator-translating').forEach((element) => {
      element.classList.remove('not-translator-translating');
    });
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.settings?.enabled || e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;

    const activeEl = document.activeElement;
    if (activeEl?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;

    const highlight = activeEl?.closest<HTMLElement>(`.${CSS_CLASSES.HIGHLIGHT}, .not-translator-grammar-highlight, .not-translator-highlighted-word, .not-translator-highlighted-translation, .not-translator-vocab-highlight`);
    if (highlight && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      this.hoverManager?.clearHoverState();
      this.handleHoverShow(highlight);
      this.tooltip.focus();
      return;
    }
    // 宿主网页的按钮、链接等仍使用其原生键盘行为。
    if (!highlight && activeEl?.closest('button, a, [role="button"], [role="combobox"]')) return;

    // 如果 Tooltip 可见，不处理导航快捷键（让 Tooltip 处理 K/U/A 等操作）
    if (this.tooltip.isVisible()) {
      return;
    }

    const key = e.key;

    // 使用导航管理器处理导航
    if (this.navigationManager.isNavigationKey(key)) {
      e.preventDefault();
      const result = this.navigationManager.handleNavigation(key);
      if (result?.element) {
        this.handleNavigationToElement(result.element, result.index, result.direction);
      }
    }
  };

  /**
   * 处理导航到指定元素
   */
  private handleNavigationToElement(
    element: HTMLElement,
    index: number,
    _direction: 'next' | 'prev'
  ): void {
    // 滚动到元素
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });

    // 保留高亮词既有的 Tab 入口，不覆盖 tabIndex=0。
    if (!element.hasAttribute('tabindex')) {
      element.tabIndex = -1;
      element.addEventListener('blur', () => element.removeAttribute('tabindex'), { once: true });
    }
    element.focus({ preventScroll: true });

    // 添加导航高亮效果
    this.navigationManager.highlightNavigationElement(element);

    // 显示 Tooltip
    this.handleHoverShow(element);

    // 显示位置指示
    const highlights = this.navigationManager.getNavigableHighlights();
    this.navigationManager.showNavigationIndicator(index, highlights.length);
  }

  constructor() {
    logger.info('NotOnlyTranslator: Content script loaded, starting initialization...');

    this.highlighter = new OptimizedHighlighter({
      maxNodesPerFrame: 10,
      maxTimePerFrame: 16,
      enableVirtualScroll: true,
      preloadDistance: 200,
    });
    this.marker = new MarkerService();
    this.tooltip = new Tooltip({
      onMarkKnown: (word) => this.handleMarkKnown(word),
      onMarkUnknown: (word, translation) =>
        this.handleMarkUnknown(word, translation),
      onAddToVocabulary: (word, translation) =>
        this.handleAddToVocabulary(word, translation),
      onUndoLastMark: () => this.handleUndoLastMark(),
    });

    // 初始化管理器
    this.navigationManager = new NavigationManager();
    this.pageScanner = new PageScanner();

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
    if (this.destroyed) return;

    // Load settings with retry
    let retryCount = 0;
    const maxRetries = 3;
    while (retryCount < maxRetries) {
      await this.loadSettings();
      if (this.destroyed) return;
      if (this.settings) {
        break;
      }
      retryCount++;
      logger.info(`NotOnlyTranslator: Retrying settings load (${retryCount}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!this.settings) {
      logger.error('NotOnlyTranslator: Failed to load settings after retries');
      // 设置加载失败标记（供E2E测试检测）
      document.body.setAttribute('data-extension-loaded', 'settings-failed');
      window.__EXTENSION_LOADED__ = false;
      return;
    }

    if (!this.settings.enabled) {
      logger.info('NotOnlyTranslator: Extension is disabled');
      // 设置禁用标记（供E2E测试检测）
      document.body.setAttribute('data-extension-loaded', 'disabled');
      window.__EXTENSION_LOADED__ = true;
      window.__NOT_ONLY_TRANSLATOR__ = this;
      return;
    }

    // 检查当前页面是否在黑名单中
    if (this.isCurrentPageBlacklisted()) {
      logger.info('NotOnlyTranslator: Current page is blacklisted, skipping');
      // 设置黑名单标记（供E2E测试检测）
      document.body.setAttribute('data-extension-loaded', 'blacklisted');
      window.__EXTENSION_LOADED__ = true;
      window.__NOT_ONLY_TRANSLATOR__ = this;
      return;
    }

    // 检查页面是否为中文页面
    if (this.isChinesePage()) {
      logger.info('NotOnlyTranslator: Current page is Chinese, skipping translation');
      // 设置中文页面标记（供E2E测试检测）
      document.body.setAttribute('data-extension-loaded', 'chinese-page');
      window.__EXTENSION_LOADED__ = true;
      window.__NOT_ONLY_TRANSLATOR__ = this;
      return;
    }

    // Setup event listeners
    this.setupEventListeners();

    // 初始化悬停管理器
    this.hoverManager = new HoverManager(
      this.tooltip,
      (element) => this.handleHoverShow(element),
      this.settings?.hoverDelay
    );

    // 初始化词汇高亮器（基于 CEFR 词汇水平）
    await this.initVocabularyHighlighter();
    if (this.destroyed) return;

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

    logger.info('NotOnlyTranslator initialized');

    // 设置扩展加载完成标记（供E2E测试检测）
    document.body.setAttribute('data-extension-loaded', 'true');
    window.__EXTENSION_LOADED__ = true;
    window.__NOT_ONLY_TRANSLATOR__ = this;

    logger.debug('全局变量已设置', {
      __NOT_ONLY_TRANSLATOR__: typeof window.__NOT_ONLY_TRANSLATOR__,
      __EXTENSION_LOADED__: window.__EXTENSION_LOADED__,
    });
  }

  /**
   * 初始化词汇高亮器
   * 从 background 拉取 CEFR 等级与已知/未知词表并注入，随后启动 storage 同步
   */
  private async initVocabularyHighlighter(): Promise<void> {
    try {
      const snapshot = await fetchVocabularySnapshot();
      if (this.destroyed) return;

      this.vocabHighlighter = new VocabularyHighlighter({
        userLevel: snapshot?.userLevel ?? 'B1',
        enabled: this.isVocabHighlightEnabled(),
        highlightStyle: 'background',
        showDifficultyIndicator: true,
      });

      TranslationDisplay.setKnownWords(Array.from(snapshot?.knownWords ?? []));
      if (snapshot) {
        this.vocabHighlighter.setCustomWords(snapshot.knownWords, snapshot.unknownWords);
      }

      // 跨标签页/存储变化 → 去抖重新同步（销毁时解绑）
      this.vocabStateSync = new VocabularyStateSync({
        applyVocabularySnapshot: (snap) => this.applyVocabularySnapshot(snap),
      });
      this.vocabStateSync.start();

      logger.info('NotOnlyTranslator: 词汇高亮器已初始化', {
        userLevel: snapshot?.userLevel ?? 'B1',
        knownWords: snapshot?.knownWords.size ?? 0,
        unknownWords: snapshot?.unknownWords.size ?? 0,
      });
    } catch (error) {
      logger.error('NotOnlyTranslator: 初始化词汇高亮器失败', error);
    }
  }

  /** 词汇高亮功能是否可用（总开关 + 词汇高亮开关） */
  private isVocabHighlightEnabled(): boolean {
    return Boolean(this.isEnabled && this.settings?.vocabHighlightEnabled);
  }

  /**
   * 应用词汇快照：开关状态与词表/等级一次性对齐
   */
  private applyVocabularySnapshot(snapshot: VocabularySnapshot): void {
    TranslationDisplay.setKnownWords(Array.from(snapshot.knownWords));
    if (this.vocabHighlighter) {
      this.vocabHighlighter.updateConfig({ enabled: this.isVocabHighlightEnabled() });
      this.vocabHighlighter.applySnapshot(snapshot);
    }
    if (this.isEnabled) TranslationDisplay.rerenderTranslations(this.settings?.translationMode || 'inline-only');
  }

  /** 学习事件只更新本页过滤状态和展示，保留完整结果，不重新获取。 */
  private updateWordPresentation(word: string, known: boolean): void {
    TranslationDisplay.setWordKnown(word, known);
    if (this.isEnabled) TranslationDisplay.rerenderTranslations(this.settings?.translationMode || 'inline-only');
  }

  /**
   * 按当前设置同步词汇高亮开关；启用时重扫以恢复高亮
   * （禁用后元素已被标记为已处理，仅靠 scanPage 无法恢复高亮）
   */
  private syncVocabHighlightEnabledState(): void {
    if (!this.vocabHighlighter) return;
    const enabled = this.isVocabHighlightEnabled();
    this.vocabHighlighter.updateConfig({ enabled });
    if (enabled) {
      this.vocabHighlighter.rescan();
    }
  }

  /** 对一批元素执行词汇高亮（仅当功能启用时） */
  private highlightVocabulary(elements: HTMLElement[]): void {
    if (!this.vocabHighlighter || !this.isVocabHighlightEnabled()) return;
    this.vocabHighlighter.highlightElements(elements);
  }

  /**
   * 初始化批量翻译组件
   * 包括可视区域观察器和批量翻译管理器
   */
  private initBatchTranslation(): void {
    // 创建批量翻译管理器，传入当前设置
    this.batchManager = new BatchTranslationManager(this.settings ?? undefined);
    this.batchManager.setMode(this.settings?.translationMode || 'inline-only');

    // 设置翻译完成回调
    this.batchManager.setOnComplete((element, _result) => {
      // 为翻译完成的元素设置点击处理
      this.setupParagraphClickHandlers(element);
      // 通知观察器该元素已处理
      this.viewportObserver?.markAsProcessed(element);
    });

    // 段落不再注入加载圈：翻译进行中状态由悬浮按钮显示
    this.batchManager.setOnProgress((activeBatches) => {
      this.floatingButton?.setBusy(activeBatches > 0);
    });

    // 创建可视区域观察器
    this.viewportObserver = new ViewportObserver((paragraphs: VisibleParagraph[]) => {
      // 当可视区域段落变化时，触发批量翻译
      this.batchManager?.handleVisibleParagraphs(paragraphs);
    });

    // 可视区域 ID 变化时，取消已离开视口的待翻译段落
    this.viewportObserver.setVisibleIdsChangedCallback((visibleIds: Set<string>) => {
      this.batchManager?.cancelOffscreenParagraphs(visibleIds);
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
    this.floatingButton = new FloatingButton(
      (mode) => {
        this.handleModeChange(mode);
      },
      (engine) => {
        this.handleEngineChange(engine);
      }
    );

    // 设置初始模式
    if (this.settings?.translationMode) {
      this.floatingButton.updateMode(this.settings.translationMode);
    }

    // 设置初始翻译引擎
    if (this.settings?.hybridTranslation?.defaultEngine) {
      this.floatingButton.setEngine(this.settings.hybridTranslation.defaultEngine);
    }

    logger.info('NotOnlyTranslator: 浮动按钮已初始化');
  }

  /**
   * 处理翻译模式切换
   */
  private handleModeChange(mode: TranslationMode): void {
    if (!this.settings || this.settings.translationMode === mode) return;

    // 本地选择立即生效，之前发出的设置读取不能覆盖它。
    this.settingsReadGeneration++;
    const newSettings = { ...this.settings, translationMode: mode };
    this.settings = newSettings;

    // 更新批量翻译管理器模式和设置
    this.batchManager?.setMode(mode);
    if (this.settings) {
      this.batchManager?.setSettings(this.settings);
    }

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

    // 只重绘已有结果，不改变在途和排队任务的获取契约。
    TranslationDisplay.rerenderTranslations(mode);
  }

  /**
   * 处理翻译引擎切换
   */
  private handleEngineChange(engine: 'llm' | 'traditional' | 'hybrid'): void {
    if (!this.settings || this.settings.hybridTranslation?.defaultEngine === engine) return;

    this.settingsReadGeneration++;
    // 更新混合翻译配置
    const currentHybrid = this.settings.hybridTranslation || {
      enabled: true,
      defaultEngine: 'hybrid' as const,
      traditionalProvider: 'deepl' as const,
      simpleTextThreshold: 20,
      enableSmartRouting: true,
      priority: 'balanced' as const,
    };

    const newHybridConfig = { ...currentHybrid, defaultEngine: engine };
    const newSettings = {
      ...this.settings,
      hybridTranslation: newHybridConfig
    };
    this.settings = newSettings;

    // 更新浮动按钮显示
    this.floatingButton?.setEngine(engine);

    // 只持久化用户切换的引擎，不回传内容脚本快照中的旧提供商或密钥。
    this.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: { hybridTranslationPatch: { defaultEngine: engine } }
    }).then(() => {
      logger.info(`NotOnlyTranslator: 翻译引擎已切换为 ${engine}`);
    }).catch((error) => {
      logger.error('NotOnlyTranslator: 保存设置失败:', error);
    });

    // 刷新页面翻译
    this.refreshTranslation(this.settings.translationMode);
  }

  /**
   * 配置或个人词表失效后重新获取翻译
   */
  private refreshTranslation(_mode: TranslationMode): void {
    this.cancelInFlightTranslations();
    this.batchManager?.cancelAll();

    // 清理之前的刷新定时器
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // 立即丢弃旧结果，避免刷新等待期内的展示切换复活失效翻译。
    this.clearAllTranslations();

    // 合并短时间内的配置广播，再重新扫描。
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;

      // 重置批量翻译状态
      if (this.batchManager) {
        this.batchManager.clearProcessedCache();
      }
      if (this.viewportObserver) {
        this.viewportObserver.resetTracking();
      }

      this.scanPage();
    }, TIMING.MODE_SWITCH_TRANSITION);
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

    if (chineseRatio > CHINESE_DETECTION_THRESHOLD.PAGE) {
      logger.info(`NotOnlyTranslator: Detected Chinese page by content ratio: ${(chineseRatio * 100).toFixed(1)}%`);
      return true;
    }

    return false;
  }

  /**
   * 获取页面文本采样
   * 从主要内容区域采样，排除脚本、样式、导航等元素
   */
  private getPageTextSample(): string {
    const excludeSelectors = ['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header', 'aside', '.sidebar', '.nav', '.menu', '.advertisement', '.ad', '.social', '.comments'];
    
    let sampleArea: Element | null = null;
    
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

    for (const selector of contentSelectors) {
      sampleArea = document.querySelector(selector);
      if (sampleArea && sampleArea.textContent && sampleArea.textContent.trim().length > 200) {
        break;
      }
    }

    if (!sampleArea) {
      sampleArea = document.body;
    }

    const clone = sampleArea.cloneNode(true) as Element;
    excludeSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    const fullText = clone.textContent || '';
    const maxSampleLength = TIMING.MAX_SAMPLE_LENGTH;

    const startPos = Math.max(0, Math.floor(fullText.length / 4));
    const endPos = Math.min(fullText.length, startPos + maxSampleLength);

    return fullText.slice(startPos, endPos);
  }

  /**
   * 计算文本中中文字符的比例
   * 使用统一的 getChineseRatio 函数
   */
  private calculateChineseRatio(text: string): number {
    return getChineseRatio(text);
  }

  /**
   * Load settings from background
   */
  private async loadSettings(reconcile = false): Promise<void> {
    const generation = ++this.settingsReadGeneration;
    try {
      logger.debug('加载设置...');
      const response = await this.sendMessage({ type: 'GET_SETTINGS' });
      if (this.destroyed || generation !== this.settingsReadGeneration) return;
      if (response.success && response.data) {
        // 提交时读取最新本页状态；异步读取期间的本地开关不能被旧快照覆盖。
        const oldSettings = this.settings;
        const oldEnabled = this.isEnabled;
        this.settings = response.data as UserSettings;
        if (oldSettings?.enabled !== this.settings.enabled) this.isEnabled = this.settings.enabled;

        // Apply highlight color
        document.documentElement.style.setProperty(
          '--not-translator-highlight-color',
          this.settings.highlightColor
        );

        // 更新批量翻译管理器的翻译模式和设置
        if (this.batchManager) {
          this.batchManager.setMode(this.settings.translationMode);
          this.batchManager.setSettings(this.settings);
        }
        this.floatingButton?.updateMode(this.settings.translationMode);
        // 更新设置和失效/重绘在同一同步延续内完成，重复通知不会跳过真实配置失效。
        if (reconcile) this.applySettingsUpdate(oldSettings, oldEnabled);

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
    document.addEventListener('dblclick', this.handleDoubleClick);

    // 键盘路径不依赖是否开启鼠标悬停。
    this.setupNavigationListeners();
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

  }

  /**
   * 设置键盘导航事件监听
   */
  private setupNavigationListeners(): void {
    document.addEventListener('keydown', this.handleKeyDown);
    logger.info('NotOnlyTranslator: 键盘导航已启用（J/↓ 下一个，K/↑ 上一个）');
  }

  /**
   * 处理悬停显示 Tooltip
   */
  private handleHoverShow(element: HTMLElement): void {
    // 即使新目标已有缓存，也要作废上一个词条的在途结果。
    this.tooltipRequestGeneration++;
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

    // CEFR 词汇高亮（根据用户水平标注的生词）
    if (element.classList.contains('not-translator-vocab-highlight')) {
      const word = element.dataset.word || element.textContent?.trim() || '';
      const level = element.dataset.level || 'B1'; // CEFR 等级
      const difficulty = parseInt(element.dataset.difficulty || '5', 10);
      const translation = element.dataset.translation || '';

      if (translation) {
        // 已有翻译，直接显示
        this.tooltip.showWord(element, {
          original: word,
          translation,
          position: [0, 0],
          difficulty,
          isPhrase: false,
        });
      } else if (word) {
        // 没有翻译数据，获取翻译
        this.tooltip.showLoading(element);
        // 存储等级信息到元素上，以便翻译完成后显示
        this.translateAndShowVocabTooltip(word, element, level, difficulty);
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
    } else if (selectedText.length > 1 && selectedText.length < TIMING.TEXT_SELECTION_MAX_LENGTH) {
      // 选中的是普通文本，提供翻译选项
      const rect = range.getBoundingClientRect();
      const tempElement = document.createElement('span');
      tempElement.style.position = 'absolute';
      tempElement.style.left = `${rect.left + window.scrollX}px`;
      tempElement.style.top = `${rect.bottom + window.scrollY}px`;
      tempElement.style.pointerEvents = 'none';
      // WCAG 4.1.2: 不可见定位锚点对屏幕阅读器隐藏
      tempElement.setAttribute('aria-hidden', 'true');
      document.body.appendChild(tempElement);

      this.translateSelection(selectedText, tempElement).finally(() => {
        setTimeout(() => {
          if (document.body.contains(tempElement)) {
            document.body.removeChild(tempElement);
          }
        }, TIMING.TOOLTIP_HIDE_DELAY);
      });
    }
  }

  /**
   * Setup message listener for background script messages
   */
  private setupMessageListener(): void {
    const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] =
      (message: Message & { type: string }, _sender, sendResponse) => {
        switch (message.type) {
          case 'BATCH_TRANSLATION_PROGRESS':
            return false;
          case 'SHOW_TRANSLATION':
            this.handleShowTranslation(message.payload as { text: string });
            sendResponse({ success: true });
            break;

          case 'CONTEXT_MENU_TRANSLATE':
            this.handleContextMenuTranslation(message.payload as { text: string });
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

          case 'TRANSLATE_PARAGRAPH':
            this.handleTranslateParagraph();
            sendResponse({ success: true });
            break;

          case 'TOGGLE_TRANSLATION':
            this.handleToggleTranslation();
            sendResponse({ success: true });
            break;

          case 'TRANSLATE_PAGE':
            void this.handleTranslatePage()
              .then(({ translated, failed, cancelled }) => sendResponse({
                success: !cancelled && failed === 0,
                data: { translated, failed },
              }))
              .catch(() => sendResponse({ success: false, error: '页面翻译失败' }));
            break;

          case 'TOGGLE_MODE':
            this.handleToggleMode();
            sendResponse({ success: true });
            break;

          default:
            sendResponse({ success: false, error: 'Unknown message type' });
        }
        return true;
      };
    const storageListener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (this.destroyed || (area !== 'sync' && area !== 'local')) return;
      const usesLegacyKey = this.settings?.apiProvider === 'openai' && !this.settings.customApiUrl
        && !this.settings.apiConfigs?.length && !this.settings.activeApiConfigId;
      const credentialsChanged = usesLegacyKey && ('apiKey' in changes || 'legacyApiKeyInvalidated' in changes);
      if (credentialsChanged) {
        this.refreshTranslation(this.settings?.translationMode || 'inline-only');
      }
      if ('settings' in changes) void this.handleSettingsUpdated();
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.storage.onChanged.addListener(storageListener);
    this.removeMessageListener = () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }

  /**
   * Setup mutation observer for dynamic content
   * 当检测到新内容时，将其注册到可视区域观察器（批量模式）
   * 或触发页面扫描（非批量模式）
   */
  private setupMutationObserver(): void {
    // 非批量模式：仅对新增段落做增量扫描，不再全页重扫（去抖窗口内后一批覆盖前一批）
    let pendingNewElements: HTMLElement[] = [];
    const debouncedScanNew = debounce(() => {
      const elements = pendingNewElements;
      pendingNewElements = [];
      void this.scanNewElements(elements);
    }, TIMING.SCAN_DEBOUNCE);

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
              if (p.textContent && p.textContent.trim().length >= TIMING.MIN_PARAGRAPH_LENGTH) {
                // 跳过排除区域内的元素（导航、页脚等）
                if (isInExcludedArea(p)) return;
                newElements.push(p);
              }
            });

            // 如果元素本身是有效段落
            if (el.textContent && el.textContent.trim().length >= TIMING.MIN_PARAGRAPH_LENGTH) {
              const tagName = el.tagName.toLowerCase();
              if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'blockquote', 'figcaption'].includes(tagName)) {
                // 跳过排除区域内的元素（导航、页脚等）
                if (isInExcludedArea(el)) return;
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
        // 动态新增内容同样需要词汇高亮
        this.highlightVocabulary(newElements);
      } else {
        // 非批量模式：合并去抖窗口内的所有新增元素，避免后一批覆盖前一批。
        pendingNewElements = Array.from(new Set([...pendingNewElements, ...newElements]));
        debouncedScanNew();
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
    const paragraphs = this.pageScanner.scan();
    logger.info(`NotOnlyTranslator: Found ${paragraphs.length} paragraphs to scan`);

    // 提取 HTMLElement 数组用于后续处理
    const paragraphElements = paragraphs.map(p => p.element);

    // 词汇高亮：与翻译路径无关（批量模式会提前返回，必须在分支前执行）
    this.highlightVocabulary(paragraphElements);

    // 批量翻译模式：使用可视区域观察器
    if (this.useBatchMode && this.viewportObserver && this.batchManager) {
      // 更新翻译模式
      this.batchManager.setMode(mode);

      // 将所有段落注册到观察器
      this.viewportObserver.observeAll(paragraphElements);

      // 立即检查当前可视区域
      this.viewportObserver.checkCurrentViewport();

      logger.info('NotOnlyTranslator: 批量模式扫描完成，已注册到观察器');
      return;
    }

    // 非批量模式：使用原有的逐段翻译逻辑（保持向后兼容）
    await this.scanPageSequential(paragraphElements, mode);
  }

  /**
   * 对动态新增的段落做增量处理（翻译 + 词汇高亮），避免每次 mutation 全页扫描
   */
  private async scanNewElements(elements: HTMLElement[]): Promise<void> {
    if (!this.isEnabled || !this.settings?.autoHighlight) return;
    if (elements.length === 0) return;

    const mode = this.settings?.translationMode || 'inline-only';
    await this.scanPageSequential(elements, mode);
    this.highlightVocabulary(elements);
  }

  /**
   * 顺序扫描页面（原有逻辑，保持向后兼容）
   */
  private async scanPageSequential(paragraphs: HTMLElement[], mode: TranslationMode): Promise<void> {
    const generation = this.startTranslationRequest();
    for (const paragraph of paragraphs) {
      if (!this.isTranslationRequestCurrent(generation)) return;
      if (TranslationDisplay.isProcessed(paragraph)) continue;

      const text = getTranslatableText(paragraph);
      if (text.length < TIMING.MIN_PARAGRAPH_LENGTH) continue;

      try {
        logger.info(`NotOnlyTranslator: Translating paragraph (${text.length} chars):`, text.substring(0, 100) + '...');
        TranslationDisplay.saveOriginalText(paragraph);

        const result = await this.translateText(text, undefined, generation, mode);
        if (!this.isTranslationRequestCurrent(generation)) return;

        logger.info('NotOnlyTranslator: Translation result received:', {
          wordsCount: result.words?.length || 0,
          sentencesCount: result.sentences?.length || 0,
          hasFullText: !!result.fullText,
          fullTextPreview: result.fullText?.substring(0, 100) || 'N/A',
          words: result.words?.slice(0, 3) || []
        });

        TranslationDisplay.applyTranslation(paragraph, result, this.settings?.translationMode || 'inline-only', this.settings);
        this.setupParagraphClickHandlers(paragraph);
      } catch (error) {
        if (!this.isTranslationRequestCurrent(generation)) return;
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
   * Translate text using background service
   */
  private async translateText(
    text: string,
    context?: string,
    generation = this.startTranslationRequest(),
    mode: TranslationMode = this.settings?.translationMode || 'inline-only'
  ): Promise<TranslationResult> {
    if (!this.isTranslationRequestCurrent(generation)) {
      throw new Error('翻译请求已取消');
    }

    logger.info('NotOnlyTranslator: Sending TRANSLATE_TEXT message to background');
    const response = await sendTranslationMessage({
      type: 'TRANSLATE_TEXT',
      payload: {
        text,
        context: context || '',
        mode,
      },
    });
    if (!this.isTranslationRequestCurrent(generation)) {
      throw new Error('翻译请求已取消');
    }

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
    const token = this.startTooltipRequest();
    try {
      this.tooltip.showLoading(targetElement);
      const result = await this.translateText(text, undefined, token.translationGeneration);
      if (!this.isTooltipRequestCurrent(token)) return;

      if (result.words.length > 0) {
        this.tooltip.showWord(targetElement, result.words[0]);
      } else if (result.sentences.length > 0) {
        this.tooltip.showSentence(targetElement, result.sentences[0]);
      } else {
        this.tooltip.showError(targetElement, '未找到需要翻译的内容');
      }
    } catch (error) {
      if (!this.isTooltipRequestCurrent(token)) return;
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
      this.lastMarkAction = { type: 'known', word, translation: '' };
      await this.marker.markKnown(word, { updateUI: false });
      this.updateWordPresentation(word, true);
      this.highlighter.markAsKnown(word);
      // 同步词汇高亮器：还原该词的 DOM 标记
      this.vocabHighlighter?.addKnownWord(word);
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
      this.lastMarkAction = { type: 'unknown', word, translation };
      await this.marker.markUnknown(word, translation, { context, updateUI: false });
      this.updateWordPresentation(word, false);
      this.highlighter.markAsUnknown(word);
      // 同步词汇高亮器：立即重扫生成高亮
      this.vocabHighlighter?.addUnknownWord(word);
    } catch (error) {
      logger.error('Failed to mark as unknown:', error);
    }
  }

  /**
   * Handle add to vocabulary
   * 业务语义：加入生词本 = 未知词（与 OptimizedHighlighter.markAsUnknown 一致），不当作认识
   */
  private async handleAddToVocabulary(
    word: string,
    translation: string
  ): Promise<boolean> {
    const previousAction = this.lastMarkAction;
    const action = { type: 'add' as const, word, translation };
    this.lastMarkAction = action;
    try {
      const context = this.marker.getSelectionContext();
      const saved = await this.marker.addToVocabulary(word, translation, context);
      if (!saved) {
        if (this.lastMarkAction === action) this.lastMarkAction = previousAction;
        return false;
      }
      // 只保留本次占位，不覆盖等待期间用户对其他词的新动作。
      this.updateWordPresentation(word, false);
      this.highlighter.markAsUnknown(word);
      this.vocabHighlighter?.addUnknownWord(word);
      return true;
    } catch (error) {
      if (this.lastMarkAction === action) this.lastMarkAction = previousAction;
      logger.error('加入生词本失败', error);
      return false;
    }
  }

  /**
   * 撤销最近一次标记操作
   */
  private async handleUndoLastMark(): Promise<void> {
    if (!this.lastMarkAction) return;

    try {
      const { type, word } = this.lastMarkAction;
      // 同步到 background 移除标记
      await chrome.runtime.sendMessage({
        type: 'REMOVE_MARK',
        payload: { word, originalAction: type },
      });

      // 清除本地标记状态；完整原始结果仍可用于撤销认识后的本地重绘。
      if (type === 'known') this.updateWordPresentation(word, false);
      this.marker.unmark(word);

      // 根据操作类型恢复高亮状态
      if (type === 'add') {
        // 加入生词本前，该词原本是未标记状态，恢复为非高亮
        this.highlighter.removeHighlight(word);
      }

      // 同步词汇高亮器：撤销后按当前词表/等级重新评估
      if (type === 'known') {
        this.vocabHighlighter?.removeKnownWord(word);
      } else {
        // unknown 与 add（生词本）同为未知词语义
        this.vocabHighlighter?.removeUnknownWord(word);
      }

      this.lastMarkAction = null;
    } catch (error) {
      logger.error('Failed to undo mark:', error);
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
    // WCAG 4.1.2: 不可见定位锚点对屏幕阅读器隐藏
    tempElement.setAttribute('aria-hidden', 'true');
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
   * Handle context menu translation request
   * Robust against cleared selection — falls back to viewport center positioning
   */
  private async handleContextMenuTranslation(payload: { text: string }): Promise<void> {
    // Try to use current selection for positioning
    const selection = window.getSelection();
    let targetElement: HTMLElement;

    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      targetElement = document.createElement('span');
      targetElement.style.position = 'absolute';
      targetElement.style.left = `${rect.left + window.scrollX}px`;
      targetElement.style.top = `${rect.bottom + window.scrollY}px`;
    } else {
      // Selection cleared — position at viewport center
      targetElement = document.createElement('span');
      targetElement.style.position = 'absolute';
      targetElement.style.left = `${window.scrollX + window.innerWidth / 2}px`;
      targetElement.style.top = `${window.scrollY + window.innerHeight / 2}px`;
    }

    targetElement.setAttribute('aria-hidden', 'true');
    document.body.appendChild(targetElement);
    const token = this.startTooltipRequest();

    try {
      // Show loading state immediately
      this.tooltip.showLoading(targetElement, payload.text);

      const userLevel = await this.getUserProfile();
      if (!this.isTooltipRequestCurrent(token)) return;

      const response = await sendTranslationMessage({
        type: 'TRANSLATE_TEXT',
        payload: {
          text: payload.text,
          context: payload.text,
          userLevel,
          mode: 'inline-only' as TranslationMode,
        },
      });
      if (!this.isTooltipRequestCurrent(token)) return;

      if (!response.success || !response.data) {
        this.tooltip.showError(targetElement, payload.text, '翻译失败，请稍后重试');
        logger.warn('右键菜单翻译失败:', response.error);
        return;
      }

      const result = response.data as TranslationResult;

      // Display translation result
      if (result.words?.[0]) {
        this.tooltip.showWord(targetElement, result.words[0]);
      } else if (result.fullText) {
        // Fallback: construct a TranslatedWord from full text
        this.tooltip.showWord(targetElement, {
          original: payload.text,
          translation: result.fullText,
          position: [0, payload.text.length],
          difficulty: 5,
          isPhrase: false,
        });
      } else if (result.sentences?.[0]) {
        this.tooltip.showSentence(targetElement, result.sentences[0]);
      } else {
        this.tooltip.showError(targetElement, payload.text, '未找到翻译');
      }

      logger.info('右键菜单翻译成功:', payload.text.substring(0, 50));
    } catch (error) {
      if (this.isTooltipRequestCurrent(token)) {
        this.tooltip.showError(targetElement, payload.text, '翻译出错');
        logger.error('右键菜单翻译出错:', error);
      }
    }

    // Clean up temp element after user interaction
    setTimeout(() => {
      if (document.body.contains(targetElement)) {
        document.body.removeChild(targetElement);
      }
    }, TIMING.TOOLTIP_HIDE_DELAY);
  }

  /**
   * Handle word marked message（其他标签页标记的广播）
   */
  private handleWordMarked(payload: { word: string; isKnown: boolean }): void {
    this.updateWordPresentation(payload.word, payload.isKnown);
    if (payload.isKnown) {
      this.highlighter.markAsKnown(payload.word);
      this.vocabHighlighter?.addKnownWord(payload.word);
    } else {
      this.highlighter.markAsUnknown(payload.word);
      this.vocabHighlighter?.addUnknownWord(payload.word);
    }
  }

  /**
   * Handle added to vocabulary message（其他标签页加入生词本的广播）
   * 语义与本地一致：生词本 = 未知词
   */
  private handleAddedToVocabulary(payload: {
    word: string;
    translation: string;
  }): void {
    this.updateWordPresentation(payload.word, false);
    this.highlighter.markAsUnknown(payload.word);
    this.vocabHighlighter?.addUnknownWord(payload.word);
  }

  /**
   * 处理设置更新（包括翻译开关和模式切换）
   * 支持无刷新切换：用户在 popup 中切换设置后立即生效
   */
  private handleSettingsUpdated(): Promise<void> {
    return this.loadSettings(true);
  }

  private applySettingsUpdate(oldSettings: UserSettings | undefined, oldEnabled: boolean): void {
    if (!this.settings) return;
    const newEnabled = this.isEnabled;
    const newMode = this.settings.translationMode;
    const onlyPresentationChanged = oldEnabled === newEnabled
      && JSON.stringify({ ...oldSettings, translationMode: undefined })
        === JSON.stringify({ ...this.settings, translationMode: undefined });
    if (onlyPresentationChanged) {
      // 重复广播和 storage 事件均为幂等操作，不进入失效/扫描分支。
      if (oldSettings?.translationMode !== newMode && newEnabled) {
        TranslationDisplay.rerenderTranslations(newMode);
      }
      return;
    }

    this.cancelInFlightTranslations();
    this.batchManager?.cancelAll();
    this.clearAllTranslations();

    // 处理启用状态变化（无刷新切换）
    if (oldEnabled !== newEnabled) {
      logger.info(`NotOnlyTranslator: 启用状态从 ${oldEnabled} 切换为 ${newEnabled}`);

      if (!newEnabled) {
        this.cancelInFlightTranslations();
        // 从启用变为禁用：清除所有翻译
        this.highlighter.clearAllHighlights();
        this.tooltip.hide();
        this.clearAllTranslations();
        this.viewportObserver?.disable();
        this.batchManager?.cancelAll();
        // 词汇高亮同步关闭并清除标记
        this.vocabHighlighter?.updateConfig({ enabled: false });
      } else {
        // 从禁用变为启用：重新扫描页面
        this.viewportObserver?.enable();
        this.syncVocabHighlightEnabledState();
        this.scanPage();
      }
      return; // 状态变化时不再处理模式变化
    }

    // 非模式配置变化必须重新获取，不能重用此前的结果或请求。
    this.refreshTranslation(newMode);

    // 设置（含词汇高亮开关）变化后保持词汇高亮状态一致
    this.syncVocabHighlightEnabledState();
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

      // 禁用批量翻译组件并取消在途翻译请求
      this.viewportObserver?.disable();
      this.batchManager?.cancelAll();
      this.cancelInFlightTranslations();

      // 词汇高亮同步关闭并清除标记
      this.vocabHighlighter?.updateConfig({ enabled: false });
    } else {
      // 重新启用批量翻译组件
      this.viewportObserver?.enable();
      this.syncVocabHighlightEnabledState();
      this.scanPage();
    }
  }

  /**
   * Clear all translations from the page
   */
  private clearAllTranslations(): void {
    TranslationDisplay.clearAll();
  }

  /**
   * 处理 Alt+T 快捷键：翻译当前段落
   * 获取当前选中的段落或光标所在的段落并翻译
   */
  private handleTranslateParagraph(): void {
    if (!this.settings?.enabled) return;

    // 获取目标段落
    const targetParagraph = this.getTargetParagraph();
    if (!targetParagraph) {
      logger.info('未找到可翻译的段落');
      return;
    }

    // 触发段落翻译
    this.translateParagraph(targetParagraph);
  }

  /**
   * 获取目标段落（选中区域或光标位置）
   */
  private getTargetParagraph(): HTMLElement | null {
    // 优先检查选中的文本所在的段落
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      let container: Node | null = range.commonAncestorContainer;

      // 向上查找最近的块级元素
      while (container && container !== document.body) {
        if (container.nodeType === Node.ELEMENT_NODE) {
          const el = container as HTMLElement;
          const tagName = el.tagName.toLowerCase();
          // 段落、文章、区块等
          if (['p', 'div', 'article', 'section', 'li', 'td', 'blockquote'].includes(tagName)) {
            // 确保有足够的文本内容
            if (el.textContent && el.textContent.trim().length > 20) {
              return el;
            }
          }
        }
        container = container.parentNode;
      }
    }

    // 回退：查找当前聚焦元素或活动段落
    const activeElement = document.activeElement;
    if (activeElement && activeElement !== document.body) {
      // 检查是否在编辑器中
      const closestParagraph = activeElement.closest('p, div, article, section');
      if (closestParagraph && closestParagraph.textContent && closestParagraph.textContent.trim().length > 20) {
        return closestParagraph as HTMLElement;
      }
    }

    // 最后尝试：获取视口中心附近的段落
    const paragraphs = document.querySelectorAll<HTMLElement>('p, article p, div > p');
    const viewportCenter = window.innerHeight / 2;

    for (const p of paragraphs) {
      const rect = p.getBoundingClientRect();
      if (rect.top < viewportCenter && rect.bottom > viewportCenter) {
        if (p.textContent && p.textContent.trim().length > 20) {
          return p;
        }
      }
    }

    return paragraphs[0] || null;
  }

  /**
   * 翻译指定段落
   */
  private async translateParagraph(
    paragraph: HTMLElement,
    mode: TranslationMode = this.settings?.translationMode || 'inline-only'
  ): Promise<'translated' | 'skipped' | 'failed'> {
    const text = getTranslatableText(paragraph).trim();
    if (!text) return 'skipped';

    const generation = this.startTranslationRequest();
    if (!this.isTranslationRequestCurrent(generation)) return 'failed';
    paragraph.classList.add('not-translator-translating');

    try {
      const result = await sendTranslationMessage({
        type: 'TRANSLATE_TEXT',
        payload: {
          text,
          context: text.slice(0, 200),
          mode,
        },
      });
      if (!this.isTranslationRequestCurrent(generation)) return 'failed';

      if (result.success && result.data) {
        const translationResult = result.data as TranslationResult;
        TranslationDisplay.applyTranslation(
          paragraph,
          translationResult,
          this.settings?.translationMode || 'inline-only',
          this.settings
        );
        return 'translated';
      }
      return 'failed';
    } catch {
      if (this.isTranslationRequestCurrent(generation)) {
        logger.error('段落翻译失败');
      }
      return 'failed';
    } finally {
      if (this.isTranslationRequestCurrent(generation)) {
        paragraph.classList.remove('not-translator-translating');
      }
    }
  }

  /**
   * 处理 Alt+Shift+T 快捷键：切换翻译显示
   * 显示/隐藏所有翻译内容
   */
  private handleToggleTranslation(): void {
    const translations = document.querySelectorAll<HTMLElement>('.not-translator-translation-line');
    const highlights = document.querySelectorAll<HTMLElement>('.not-translator-highlight');
    const processed = document.querySelectorAll<HTMLElement>('.not-translator-processed');

    if (translations.length === 0 && highlights.length === 0) {
      // 没有翻译，触发当前段落翻译
      this.handleTranslateParagraph();
      return;
    }

    // 切换可见性
    const isHidden = translations[0]?.style.display === 'none';

    translations.forEach(el => {
      el.style.display = isHidden ? '' : 'none';
    });

    highlights.forEach(el => {
      el.style.opacity = isHidden ? '1' : '0.3';
    });

    processed.forEach(el => {
      if (isHidden) {
        el.classList.remove('not-translator-hidden');
      } else {
        el.classList.add('not-translator-hidden');
      }
    });

    logger.info(`翻译显示已${isHidden ? '开启' : '关闭'}`);
  }

  /**
   * 处理右键菜单「翻译此页面」
   * 收集页面中所有未翻译的段落，批量翻译并显示
   */
  private async handleTranslatePage(): Promise<{ translated: number; failed: number; cancelled?: boolean }> {
    let translated = 0;
    let failed = 0;
    this.cancelInFlightTranslations();
    this.batchManager?.cancelAll();
    const generation = this.startTranslationRequest();
    const mode = this.settings?.translationMode || 'inline-only';
    if (!this.isTranslationRequestCurrent(generation)) return { translated, failed, cancelled: true };

    const paragraphs = document.querySelectorAll<HTMLElement>(
      'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption'
    );

    const eligible: HTMLElement[] = [];
    paragraphs.forEach((p) => {
      const text = getTranslatableText(p).trim();
      if (
        text.length >= TIMING.MIN_PARAGRAPH_LENGTH &&
        !p.classList.contains('not-translator-processed') &&
        !p.classList.contains('not-translator-translation-line') &&
        !p.closest('.not-translator-tooltip') &&
        !isInExcludedArea(p)
      ) {
        eligible.push(p);
      }
    });

    if (eligible.length === 0) {
      logger.info('没有可翻译的内容');
      return { translated, failed };
    }

    logger.info(`开始翻译页面，共 ${eligible.length} 个段落`);

    // 按段落数和后台字符预算分批，避免整批被拒绝
    let batchNumber = 0;
    for (let i = 0; i < eligible.length;) {
      if (!this.isTranslationRequestCurrent(generation)) return { translated, failed, cancelled: true };
      const batch: HTMLElement[] = [];
      let totalChars = 0;
      while (i < eligible.length && batch.length < DEFAULT_BATCH_CONFIG.maxParagraphsPerBatch) {
        const paragraph = eligible[i];
        const length = getTranslatableText(paragraph).trim().length;
        if (length > DEFAULT_BATCH_CONFIG.maxCharsPerBatch) {
          if (batch.length > 0) break;
          i++;
          if (length > MAX_TRANSLATION_TEXT_LENGTH) {
            failed++;
            logger.warn('页面段落超出单段翻译字符限制');
          } else {
            const outcome = await this.translateParagraph(paragraph, mode);
            if (outcome === 'translated') translated++;
            if (outcome === 'failed') failed++;
          }
          if (!this.isTranslationRequestCurrent(generation)) return { translated, failed, cancelled: true };
          continue;
        }
        if (batch.length > 0 && totalChars + length > DEFAULT_BATCH_CONFIG.maxCharsPerBatch) break;
        batch.push(paragraph);
        totalChars += length;
        i++;
      }
      if (batch.length === 0) continue;
      batchNumber++;
      const texts = batch.map(p => getTranslatableText(p).trim());

      try {
        // 页面级批量按新契约携带 mode/pageUrl；结果按批次下标回填，elementPath 仅作占位
        const response = await sendTranslationMessage({
          type: 'BATCH_TRANSLATE_TEXT',
          payload: {
            paragraphs: texts.map((text, idx) => ({
              id: `page-translate-${batchNumber}-${idx}`,
              text,
              elementPath: 'p',
            })),
            mode,
            pageUrl: window.location.origin,
          },
        });

        if (!this.isTranslationRequestCurrent(generation)) return { translated, failed, cancelled: true };

        if (response.success && response.data) {
          const batchResponse = response.data as { results?: Array<{ result?: TranslationResult }> };
          for (const [index, paragraph] of batch.entries()) {
            const result = batchResponse.results?.[index]?.result;
            if (!result) {
              failed++;
              continue;
            }
            try {
              TranslationDisplay.applyTranslation(
                paragraph,
                result,
                this.settings?.translationMode || 'inline-only',
                this.settings
              );
              translated++;
            } catch {
              failed++;
              logger.error('页面段落渲染失败');
            }
          }
        } else {
          failed += batch.length;
          logger.warn(`第 ${batchNumber} 批批量翻译失败`);
        }
      } catch {
        if (!this.isTranslationRequestCurrent(generation)) return { translated, failed, cancelled: true };
        failed += batch.length;
        logger.error(`批量翻译第 ${batchNumber} 批失败`);
      }
    }

    if (failed === 0) logger.info('页面翻译完成');
    else logger.warn(`页面翻译结束，成功 ${translated} 段，失败 ${failed} 段`);
    return { translated, failed };
  }

  /**
   * 处理 Alt+I 快捷键：切换 inline-only / bilingual 翻译模式
   * 在当前两种模式之间循环切换
   */
  private handleToggleMode(): void {
    if (!this.settings?.enabled) return;

    // 在 inline-only 和 bilingual 之间切换
    const newMode: TranslationMode =
      this.settings.translationMode === 'inline-only' ? 'bilingual' : 'inline-only';

    logger.info(`NotOnlyTranslator: 快捷键切换模式 ${this.settings.translationMode} -> ${newMode}`);

    // 复用已有的模式切换逻辑
    this.handleModeChange(newMode);
  }

  /**
   * Send message to background script
   */
  private async sendMessage(message: Message, timeout: number = TIMING.DEFAULT_MESSAGE_TIMEOUT): Promise<MessageResponse> {
    const startTime = performance.now();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const result = await Promise.race([
      new Promise<MessageResponse>((resolve) => {
        chrome.runtime.sendMessage(message, (response: MessageResponse) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (chrome.runtime.lastError) {
            logger.debug('sendMessage lastError:', chrome.runtime.lastError.message);
            resolve({
              success: false,
              error: chrome.runtime.lastError.message,
            });
          } else if (!response) {
            logger.debug('sendMessage no response received');
            resolve(response || { success: false, error: 'No response' });
          } else {
            logger.debug('sendMessage response:', { type: message.type, success: response.success });
            resolve(response);
          }
        });
      }),
      new Promise<MessageResponse>((resolve) => {
        timeoutId = setTimeout(() => {
          timeoutId = null;
          logger.debug('sendMessage timeout');
          resolve({ success: false, error: '请求超时，请重试' });
        }, timeout);
      }),
    ]);

    const duration = performance.now() - startTime;
    recordMetric(MetricType.MESSAGE_LATENCY, 'message_send', duration, result.success ?? false, {
      errorMessage: result.error,
    });

    return result;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // 页面卸载（pagehide 经由 destroy 到达）：只做前端清理，不发后台取消，
    // 在途批次让后台继续完成并写缓存，刷新后的新页面不重发
    this.cancelInFlightTranslations(false);

    // 清理 document 级别事件监听器
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('dblclick', this.handleDoubleClick);
    document.removeEventListener('mouseover', this.handleMouseOver);
    document.removeEventListener('mouseout', this.handleMouseOut);
    document.removeEventListener('keydown', this.handleKeyDown);
    this.removeMessageListener?.();
    this.removeMessageListener = null;

    // 清理管理器
    this.hoverManager?.destroy();
    this.navigationManager.destroy();

    // 清理定时器
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // 清理浮动按钮
    this.floatingButton?.destroy();

    // 清理 MutationObserver
    this.observer?.disconnect();

    // 清理批量翻译组件；卸载路径不发后台取消，在途批次由后台继续完成写缓存
    this.viewportObserver?.destroy();
    this.batchManager?.cancelAll(false);

    // 清理词汇状态同步（解绑 storage 监听）与词汇高亮器
    this.vocabStateSync?.stop();
    this.vocabStateSync = null;
    this.vocabHighlighter?.destroy();

    // 清理高亮、展示结果和本页知识状态，常规清空则仍保留知识过滤。
    this.clearAllTranslations();
    TranslationDisplay.setKnownWords([]);
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
