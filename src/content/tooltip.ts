import type { TranslatedWord, TranslatedSentence } from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';
import { logger } from '@/shared/utils';

export interface TooltipData {
  word?: TranslatedWord;
  sentence?: TranslatedSentence;
}

export interface TooltipCallbacks {
  onMarkKnown: (word: string) => void;
  onMarkUnknown: (word: string, translation: string) => void;
  onAddToVocabulary: (word: string, translation: string) => void;
  /** 撤销最近一次标记操作（认识/不认识/生词本） */
  onUndoLastMark: () => void;
}

/**
 * Tooltip - manages the translation tooltip display
 *
 * 交互改进：
 * - 支持"钉住"功能，钉住后滚动时 tooltip 跟随目标元素
 * - 滚动时自动更新位置（如果钉住）或延迟隐藏（给用户反应时间）
 * - 快捷键 P 可以切换钉住状态
 * - 快捷键帮助面板显示所有可用快捷键
 */
export class Tooltip {
  private element: HTMLElement | null = null;
  private callbacks: TooltipCallbacks;
  private currentWord: string | null = null;
  /** 当前 tooltip 关联的目标元素 */
  private currentTarget: HTMLElement | null = null;
  /** 是否已钉住（钉住后滚动不会隐藏） */
  private isPinned: boolean = false;
  /** 滚动隐藏的防抖定时器 */
  private scrollHideTimeout: ReturnType<typeof setTimeout> | null = null;
  /** 快捷键帮助面板 */
  private helpPanel: HTMLElement | null = null;
  /** 撤销操作栏的定时器 */
  private undoTimeout: ReturnType<typeof setTimeout> | null = null;
  /** 撤销操作栏的 DOM 引用 */
  private undoBar: HTMLElement | null = null;
  /** 加载慢提示的定时器 */
  private loadingSlowTimeout: ReturnType<typeof setTimeout> | null = null;

  /** 保存事件监听器引用，用于清理 */
  private boundHandlers: {
    documentClick: (e: Event) => void;
    documentMouseover: (e: Event) => void;
    documentScroll: () => void;
    documentKeydown: (e: KeyboardEvent) => void;
  } | null = null;

  constructor(callbacks: TooltipCallbacks) {
    this.callbacks = callbacks;
    this.createTooltipElement();
    this.setupEventListeners();
  }

  /**
   * Create the tooltip DOM element
   */
  private createTooltipElement(): void {
    // Check if already exists
    const existing = document.getElementById('not-translator-tooltip');
    if (existing) {
      this.element = existing;
      return;
    }

    const tooltip = document.createElement('div');
    tooltip.id = 'not-translator-tooltip';
    tooltip.className = CSS_CLASSES.TOOLTIP;
    // WCAG 4.1.2: 添加 role 和 aria-live 以支持屏幕阅读器
    // WCAG 4.1.3: aria-atomic 确保屏幕阅读器播报完整内容
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-live', 'polite');
    tooltip.setAttribute('aria-atomic', 'true');
    tooltip.innerHTML = `
      <div class="${CSS_CLASSES.TOOLTIP}-toolbar">
        <button type="button" class="${CSS_CLASSES.TOOLTIP}-help" aria-label="快捷键帮助"><svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="10.01"/><line x1="10" y1="10" x2="10" y2="10.01"/><line x1="14" y1="10" x2="14" y2="10.01"/><line x1="18" y1="10" x2="18" y2="10.01"/><line x1="8" y1="14" x2="16" y2="14"/></svg></button>
        <button type="button" class="${CSS_CLASSES.TOOLTIP}-pin" aria-label="钉住"><svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 4.5l-3 3L7.5 6l-3 3L9 13.5l-1.5 4.5L12 22.5l4.5-4.5L15 13.5l4.5-4.5-3-3L15 4.5z"/></svg></button>
        <button type="button" class="${CSS_CLASSES.TOOLTIP}-close" aria-label="关闭">&times;</button>
      </div>
      <div class="${CSS_CLASSES.TOOLTIP}-content"></div>
    `;

    document.body.appendChild(tooltip);
    this.element = tooltip;

    // Close button handler
    const closeBtn = tooltip.querySelector(`.${CSS_CLASSES.TOOLTIP}-close`);
    closeBtn?.addEventListener('click', () => this.hide());

    // Pin button handler
    const pinBtn = tooltip.querySelector(`.${CSS_CLASSES.TOOLTIP}-pin`);
    pinBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePin();
    });

    // Help button handler
    const helpBtn = tooltip.querySelector(`.${CSS_CLASSES.TOOLTIP}-help`);
    helpBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHelpPanel();
    });

    // Create help panel (hidden initially)
    this.createHelpPanel();
  }

  /**
   * 创建快捷键帮助面板
   */
  private createHelpPanel(): void {
    const panel = document.createElement('div');
    panel.className = 'not-translator-help-panel';
    panel.style.display = 'none';
    // WCAG 4.1.2: 帮助面板使用 role=dialog
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '快捷键帮助');
    panel.innerHTML = `
      <div class="not-translator-help-header">
        <span>快捷键</span>
        <button type="button" class="not-translator-help-close" aria-label="关闭快捷键帮助">&times;</button>
      </div>
      <div class="not-translator-help-content">
        <div class="not-translator-help-item">
          <kbd>K</kbd> <span>标记认识</span>
        </div>
        <div class="not-translator-help-item">
          <kbd>U</kbd> <span>标记不认识</span>
        </div>
        <div class="not-translator-help-item">
          <kbd>A</kbd> <span>加入生词本</span>
        </div>
        <div class="not-translator-help-item">
          <kbd>P</kbd> <span>钉住/取消钉住</span>
        </div>
        <div class="not-translator-help-item">
          <kbd>J</kbd> / <kbd>L</kbd> / <kbd>↓</kbd> <span>下一个高亮词</span>
        </div>
        <div class="not-translator-help-item">
          <kbd>H</kbd> / <kbd>↑</kbd> <span>上一个高亮词</span>
        </div>
        <div class="not-translator-help-item">
          <kbd>Esc</kbd> <span>关闭弹窗</span>
        </div>
        <div class="not-translator-help-item">
          <kbd>⌘/Ctrl+Z</kbd> <span>撤销上次标记（3 秒内）</span>
        </div>
        <div class="not-translator-help-footer">
          <span>⌘/Ctrl + 悬停 可快速显示翻译</span>
        </div>
      </div>
    `;

    // Close button handler
    const closeBtn = panel.querySelector('.not-translator-help-close');
    closeBtn?.addEventListener('click', () => this.hideHelpPanel());

    document.body.appendChild(panel);
    this.helpPanel = panel;
  }

  /**
   * 切换快捷键帮助面板显示
   */
  private toggleHelpPanel(): void {
    if (this.helpPanel?.style.display === 'block') {
      this.hideHelpPanel();
    } else {
      this.showHelpPanel();
    }
  }

  /**
   * 显示快捷键帮助面板
   */
  private showHelpPanel(): void {
    if (!this.helpPanel || !this.element) return;

    // 定位在 tooltip 旁边
    const tooltipRect = this.element.getBoundingClientRect();
    this.helpPanel.style.top = `${tooltipRect.top}px`;
    this.helpPanel.style.left = `${tooltipRect.right + 10}px`;

    // 确保不超出视口
    const panelRect = this.helpPanel.getBoundingClientRect();
    if (tooltipRect.right + 10 + panelRect.width > window.innerWidth) {
      this.helpPanel.style.left = `${tooltipRect.left - panelRect.width - 10}px`;
    }

    this.helpPanel.style.display = 'block';
  }

  /**
   * 隐藏快捷键帮助面板
   */
  private hideHelpPanel(): void {
    if (this.helpPanel) {
      this.helpPanel.style.display = 'none';
    }
  }

  /**
   * Setup global event listeners
   * 保存引用以便在 destroy 时正确清理
   */
  private setupEventListeners(): void {
    // 创建事件处理函数并保存引用
    this.boundHandlers = {
      documentClick: (e: Event) => {
        if (!this.element?.contains(e.target as Node)) {
          const target = e.target as HTMLElement;
          if (!target.classList.contains(CSS_CLASSES.HIGHLIGHT)) {
            if (!this.isPinned) {
              this.hide();
            }
          }
        }
      },
      documentMouseover: (e: Event) => {
        const me = e as MouseEvent;
        if ((me.metaKey || me.ctrlKey) && (e.target as HTMLElement).classList.contains(CSS_CLASSES.HIGHLIGHT)) {
          (e.target as HTMLElement).click();
        }
      },
      documentScroll: () => this.handleScroll(),
      documentKeydown: (e: KeyboardEvent) => {
        // Ctrl+Z 撤销：即使 tooltip 不可见，只要撤销栏存在就触发
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && this.undoBar) {
          e.preventDefault();
          this.callbacks.onUndoLastMark();
          this.removeUndoBar();
          this.hide();
          return;
        }

        if (!this.isVisible()) return;

        if (e.key === 'Escape') {
          this.hide();
          return;
        }

        const activeEl = document.activeElement;
        if (
          activeEl?.tagName === 'INPUT' ||
          activeEl?.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement)?.isContentEditable
        ) {
          return;
        }

        const key = e.key.toLowerCase();
        if (key === 'k') {
          const btn = this.element?.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.known`);
          (btn as HTMLElement | null)?.click();
        } else if (key === 'u') {
          const btn = this.element?.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.unknown`);
          (btn as HTMLElement | null)?.click();
        } else if (key === 'a') {
          const btn = this.element?.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.add`);
          (btn as HTMLElement | null)?.click();
        } else if (key === 'p') {
          this.togglePin();
        }
      }
    };

    // 注册事件监听器
    document.addEventListener('click', this.boundHandlers.documentClick);
    document.addEventListener('mouseover', this.boundHandlers.documentMouseover);
    document.addEventListener('scroll', this.boundHandlers.documentScroll, true);
    document.addEventListener('keydown', this.boundHandlers.documentKeydown);
  }

  /**
   * 处理滚动事件
   * - 已钉住：更新 tooltip 位置跟随目标元素
   * - 未钉住：延迟 300ms 后隐藏（给用户反应时间）
   */
  private handleScroll(): void {
    if (!this.isVisible()) return;

    if (this.isPinned && this.currentTarget) {
      // 钉住状态：更新位置跟随目标
      this.positionTooltip(this.currentTarget);
    } else {
      // 未钉住：延迟隐藏
      if (this.scrollHideTimeout) {
        clearTimeout(this.scrollHideTimeout);
      }
      this.scrollHideTimeout = setTimeout(() => {
        if (!this.isPinned) {
          this.hide();
        }
      }, 300);
    }
  }

  /**
   * 切换钉住状态
   */
  togglePin(): void {
    this.isPinned = !this.isPinned;
    this.updatePinButtonState();

    if (this.isPinned) {
      logger.info('Tooltip: 已钉住');
    } else {
      logger.info('Tooltip: 已取消钉住');
    }
  }

  /**
   * 更新钉住按钮的视觉状态
   */
  private updatePinButtonState(): void {
    const pinBtn = this.element?.querySelector(`.${CSS_CLASSES.TOOLTIP}-pin`) as HTMLElement;
    if (pinBtn) {
      // WCAG 4.1.2: aria-pressed 反映钉住状态
      pinBtn.setAttribute('aria-pressed', String(this.isPinned));
      if (this.isPinned) {
        pinBtn.classList.add('pinned');
        pinBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 4.5l-3 3L7.5 6l-3 3L9 13.5l-1.5 4.5L12 22.5l4.5-4.5L15 13.5l4.5-4.5-3-3L15 4.5z"/></svg>';
        pinBtn.title = '取消钉住 (P)';
      } else {
        pinBtn.classList.remove('pinned');
        pinBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 4.5l-3 3L7.5 6l-3 3L9 13.5l-1.5 4.5L12 22.5l4.5-4.5L15 13.5l4.5-4.5-3-3L15 4.5z"/></svg>';
        pinBtn.title = '钉住 (P)';
      }
    }
  }

  /**
   * 获取 Tooltip DOM 元素
   */
  getElement(): HTMLElement | null {
    return this.element;
  }

  /**
   * Show tooltip for a word
   */
  showWord(
    targetElement: HTMLElement,
    data: TranslatedWord
  ): void {
    if (!this.element) return;

    this.currentWord = data.original;
    this.currentTarget = targetElement;
    // 显示新 tooltip 时重置钉住状态
    this.isPinned = false;
    this.updatePinButtonState();

    const content = this.element.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
    if (!content) return;

    // Determine difficulty label
    let difficultyClass = '';
    let difficultyLabel = '';
    if (data.difficulty <= 3) {
      difficultyClass = 'easy';
      difficultyLabel = '简单';
    } else if (data.difficulty <= 6) {
      difficultyClass = 'medium';
      difficultyLabel = '中等';
    } else {
      difficultyClass = 'hard';
      difficultyLabel = '困难';
    }

    // 使用 DOM API 避免 XSS 风险
    content.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = `${CSS_CLASSES.TOOLTIP}-header`;

    const wordSpan = document.createElement('span');
    wordSpan.className = `${CSS_CLASSES.TOOLTIP}-word`;
    wordSpan.textContent = data.original; // 使用 textContent 防止 XSS
    header.appendChild(wordSpan);

    const difficultySpan = document.createElement('span');
    difficultySpan.className = `${CSS_CLASSES.TOOLTIP}-difficulty ${difficultyClass}`;
    difficultySpan.textContent = difficultyLabel;
    header.appendChild(difficultySpan);

    content.appendChild(header);

    // Phrase label
    if (data.isPhrase) {
      const phraseSpan = document.createElement('span');
      phraseSpan.className = `${CSS_CLASSES.TOOLTIP}-phrase`;
      phraseSpan.textContent = '短语';
      content.appendChild(phraseSpan);
    }

    // Translation
    const translationDiv = document.createElement('div');
    translationDiv.className = `${CSS_CLASSES.TOOLTIP}-translation`;
    translationDiv.textContent = data.translation; // 使用 textContent 防止 XSS
    content.appendChild(translationDiv);

    // Phonetic (if available)
    if (data.phonetic) {
      const phoneticDiv = document.createElement('div');
      phoneticDiv.className = `${CSS_CLASSES.TOOLTIP}-phonetic`;
      phoneticDiv.textContent = data.phonetic;
      content.appendChild(phoneticDiv);
    }

    // Part of speech (if available)
    if (data.partOfSpeech) {
      const posDiv = document.createElement('div');
      posDiv.className = `${CSS_CLASSES.TOOLTIP}-pos`;
      posDiv.textContent = data.partOfSpeech;
      content.appendChild(posDiv);
    }

    // Examples (if available)
    if (data.examples && data.examples.length > 0) {
      const examplesDiv = document.createElement('div');
      examplesDiv.className = `${CSS_CLASSES.TOOLTIP}-examples`;

      const examplesLabel = document.createElement('div');
      examplesLabel.className = `${CSS_CLASSES.TOOLTIP}-examples-label`;
      examplesLabel.textContent = '例句';
      examplesDiv.appendChild(examplesLabel);

      const examplesList = document.createElement('ul');
      examplesList.className = `${CSS_CLASSES.TOOLTIP}-examples-list`;

      for (const example of data.examples) {
        const li = document.createElement('li');
        li.textContent = example;
        examplesList.appendChild(li);
      }

      examplesDiv.appendChild(examplesList);
      content.appendChild(examplesDiv);
    }

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = `${CSS_CLASSES.TOOLTIP}-actions`;

    const knownBtn = document.createElement('button');
    knownBtn.type = 'button';
    knownBtn.className = `${CSS_CLASSES.MARK_BUTTON} known`;
    knownBtn.dataset.action = 'known';
    knownBtn.title = '快捷键: K';
    knownBtn.setAttribute('aria-label', `标记 ${data.original} 为认识`);
    knownBtn.innerHTML = '<span>认识</span> <kbd class="shortcut-hint" aria-hidden="true">K</kbd>';
    actionsDiv.appendChild(knownBtn);

    const unknownBtn = document.createElement('button');
    unknownBtn.type = 'button';
    unknownBtn.className = `${CSS_CLASSES.MARK_BUTTON} unknown`;
    unknownBtn.dataset.action = 'unknown';
    unknownBtn.title = '快捷键: U';
    unknownBtn.setAttribute('aria-label', `标记 ${data.original} 为不认识`);
    unknownBtn.innerHTML = '<span>不认识</span> <kbd class="shortcut-hint" aria-hidden="true">U</kbd>';
    actionsDiv.appendChild(unknownBtn);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = `${CSS_CLASSES.MARK_BUTTON} add`;
    addBtn.dataset.action = 'add';
    addBtn.title = '快捷键: A';
    addBtn.setAttribute('aria-label', `将 ${data.original} 加入生词本`);
    addBtn.innerHTML = '<span>加入生词本</span> <kbd class="shortcut-hint" aria-hidden="true">A</kbd>';
    actionsDiv.appendChild(addBtn);

    content.appendChild(actionsDiv);

    // Add button event listeners
    this.setupActionButtons(data);

    // Position and show
    this.positionTooltip(targetElement);
    this.element.classList.add(CSS_CLASSES.TOOLTIP_VISIBLE);
  }

  /**
   * Show tooltip for a sentence
   */
  showSentence(
    targetElement: HTMLElement,
    data: TranslatedSentence
  ): void {
    if (!this.element) return;

    this.currentWord = null;
    this.currentTarget = targetElement;
    this.isPinned = false;
    this.updatePinButtonState();

    const content = this.element.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
    if (!content) return;

    // 使用 DOM API 避免 XSS 风险
    content.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = `${CSS_CLASSES.TOOLTIP}-header`;

    const titleSpan = document.createElement('span');
    titleSpan.className = `${CSS_CLASSES.TOOLTIP}-word`;
    titleSpan.textContent = '句子翻译';
    header.appendChild(titleSpan);

    content.appendChild(header);

    // Translation
    const translationDiv = document.createElement('div');
    translationDiv.className = `${CSS_CLASSES.TOOLTIP}-translation`;
    translationDiv.textContent = data.translation; // 使用 textContent 防止 XSS
    content.appendChild(translationDiv);

    // Grammar Note (if present)
    if (data.grammarNote) {
      const grammarDiv = document.createElement('div');
      grammarDiv.className = `${CSS_CLASSES.TOOLTIP}-grammar`;

      const grammarLabel = document.createElement('div');
      grammarLabel.className = `${CSS_CLASSES.TOOLTIP}-grammar-label`;
      grammarLabel.textContent = '语法说明';
      grammarDiv.appendChild(grammarLabel);

      const grammarContent = document.createElement('div');
      grammarContent.textContent = data.grammarNote; // 使用 textContent 防止 XSS
      grammarDiv.appendChild(grammarContent);

      content.appendChild(grammarDiv);
    }

    // Position and show
    this.positionTooltip(targetElement);
    this.element.classList.add(CSS_CLASSES.TOOLTIP_VISIBLE);
  }

  /**
   * Show tooltip for grammar explanation
   */
  showGrammar(
    targetElement: HTMLElement,
    data: { original: string; explanation: string; type: string; position: [number, number] }
  ): void {
    if (!this.element) return;

    this.currentWord = null;
    this.currentTarget = targetElement;
    this.isPinned = false;
    this.updatePinButtonState();

    const content = this.element.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
    if (!content) return;

    // 使用 DOM API 避免 XSS 风险
    content.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = `${CSS_CLASSES.TOOLTIP}-header`;

    const typeSpan = document.createElement('span');
    typeSpan.className = `${CSS_CLASSES.TOOLTIP}-word`;
    typeSpan.textContent = data.type; // 使用 textContent 防止 XSS
    header.appendChild(typeSpan);

    content.appendChild(header);

    // Original text quote
    const originalDiv = document.createElement('div');
    originalDiv.className = 'text-xs text-gray-500 mb-2 italic';
    originalDiv.textContent = `"${data.original}"`; // 使用 textContent 防止 XSS
    content.appendChild(originalDiv);

    // Explanation
    const explanationDiv = document.createElement('div');
    explanationDiv.className = `${CSS_CLASSES.TOOLTIP}-translation`;
    explanationDiv.textContent = data.explanation; // 使用 textContent 防止 XSS
    content.appendChild(explanationDiv);

    // Position and show
    this.positionTooltip(targetElement);
    this.element.classList.add(CSS_CLASSES.TOOLTIP_VISIBLE);
  }

  /**
   * Hide the tooltip
   */
  hide(): void {
    if (this.element) {
      this.element.classList.remove(CSS_CLASSES.TOOLTIP_VISIBLE);
      this.currentWord = null;
      this.currentTarget = null;
      this.isPinned = false;
      this.updatePinButtonState();

      // 隐藏帮助面板
      this.hideHelpPanel();

      // 清理撤销栏
      this.removeUndoBar();

      // 清理加载慢提示
      this.clearLoadingSlowTimeout();

      // 清除滚动隐藏定时器
      if (this.scrollHideTimeout) {
        clearTimeout(this.scrollHideTimeout);
        this.scrollHideTimeout = null;
      }
    }
  }

  /**
   * Check if tooltip is currently pinned
   */
  getPinned(): boolean {
    return this.isPinned;
  }

  /**
   * Position tooltip near target element
   */
  private positionTooltip(target: HTMLElement): void {
    if (!this.element) return;

    const rect = target.getBoundingClientRect();
    const tooltipRect = this.element.getBoundingClientRect();

    // Default: show below the target
    let top = rect.bottom + window.scrollY + 8;
    let left = rect.left + window.scrollX;

    // Check if tooltip would go off screen to the right
    if (left + tooltipRect.width > window.innerWidth) {
      left = window.innerWidth - tooltipRect.width - 16;
    }

    // Check if tooltip would go off screen to the left
    if (left < 16) {
      left = 16;
    }

    // Check if tooltip would go off screen at bottom
    if (rect.bottom + tooltipRect.height + 8 > window.innerHeight) {
      // Show above instead
      top = rect.top + window.scrollY - tooltipRect.height - 8;
      this.element.classList.add('tooltip-bottom');
    } else {
      this.element.classList.remove('tooltip-bottom');
    }

    // Also check top overflow (when showing above)
    if (top < window.scrollY + 16) {
      top = window.scrollY + 16;
    }

    this.element.style.top = `${top}px`;
    this.element.style.left = `${left}px`;
  }

  /**
   * Setup action button event listeners
   */
  private setupActionButtons(data: TranslatedWord): void {
    if (!this.element) return;

    const buttons = this.element.querySelectorAll(`.${CSS_CLASSES.MARK_BUTTON}`);
    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.action;

        switch (action) {
          case 'known':
            this.callbacks.onMarkKnown(data.original);
            this.showUndoBar(data.original, '已标记为认识');
            break;
          case 'unknown':
            this.callbacks.onMarkUnknown(data.original, data.translation);
            this.showUndoBar(data.original, '已标记为不认识');
            break;
          case 'add':
            this.callbacks.onAddToVocabulary(data.original, data.translation);
            this.showUndoBar(data.original, '已加入生词本');
            break;
        }
      });
    });
  }

  /**
   * 显示撤销操作栏：3 秒倒计时内可撤销
   */
  private showUndoBar(_word: string, message: string): void {
    if (!this.element) return;

    // 清除之前的撤销定时器
    if (this.undoTimeout) {
      clearTimeout(this.undoTimeout);
      this.undoTimeout = null;
    }

    // 隐藏原来的操作按钮
    const actionsDiv = this.element.querySelector(`.${CSS_CLASSES.TOOLTIP}-actions`);
    if (actionsDiv) {
      (actionsDiv as HTMLElement).style.display = 'none';
    }

    // 创建撤销栏
    const bar = document.createElement('div');
    bar.className = `${CSS_CLASSES.TOOLTIP}-undo-bar`;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    bar.innerHTML = `
      <span class="${CSS_CLASSES.TOOLTIP}-undo-msg">${message}</span>
      <button type="button" class="${CSS_CLASSES.TOOLTIP}-undo-btn" aria-label="撤销操作">
        撤销
      </button>
    `;

    const content = this.element.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
    content?.appendChild(bar);
    this.undoBar = bar;

    const undoBtn = bar.querySelector(`.${CSS_CLASSES.TOOLTIP}-undo-btn`);
    undoBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onUndoLastMark();
      this.removeUndoBar();
      this.hide();
    });

    // 3 秒后自动消失
    this.undoTimeout = setTimeout(() => {
      this.removeUndoBar();
      this.hide();
    }, 3000);
  }

  /**
   * 清理加载慢提示的定时器
   */
  private clearLoadingSlowTimeout(): void {
    if (this.loadingSlowTimeout) {
      clearTimeout(this.loadingSlowTimeout);
      this.loadingSlowTimeout = null;
    }
  }

  /**
   * 移除撤销栏
   */
  private removeUndoBar(): void {
    if (this.undoTimeout) {
      clearTimeout(this.undoTimeout);
      this.undoTimeout = null;
    }
    if (this.undoBar) {
      this.undoBar.remove();
      this.undoBar = null;
    }
    // 恢复原来的操作按钮
    if (!this.element) return;
    const actionsDiv = this.element.querySelector(`.${CSS_CLASSES.TOOLTIP}-actions`);
    if (actionsDiv) {
      (actionsDiv as HTMLElement).style.display = '';
    }
  }

  /**
   * Check if tooltip is currently visible
   */
  isVisible(): boolean {
    return this.element?.classList.contains(CSS_CLASSES.TOOLTIP_VISIBLE) || false;
  }

  /**
   * Get current word being displayed
   */
  getCurrentWord(): string | null {
    return this.currentWord;
  }

  /**
   * Show loading state in tooltip
   * 显示翻译加载中状态
   */
  showLoading(targetElement: HTMLElement, word?: string): void {
    if (!this.element) return;

    if (word) {
      this.currentWord = word;
    }
    this.currentTarget = targetElement;
    this.isPinned = false;
    this.updatePinButtonState();

    const content = this.element.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
    if (!content) return;

    // 使用 DOM API 构建 loading UI
    content.innerHTML = '';

    // Header with word (如果提供了word参数)
    if (word) {
      const header = document.createElement('div');
      header.className = `${CSS_CLASSES.TOOLTIP}-header`;

      const wordSpan = document.createElement('span');
      wordSpan.className = `${CSS_CLASSES.TOOLTIP}-word`;
      wordSpan.textContent = word;
      header.appendChild(wordSpan);

      content.appendChild(header);
    }

    // Loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.className = `${CSS_CLASSES.TOOLTIP}-loading`;
    // WCAG 4.1.3: role=status 让屏幕阅读器感知加载状态
    loadingDiv.setAttribute('role', 'status');
    loadingDiv.setAttribute('aria-label', '正在翻译');

    const spinner = document.createElement('div');
    spinner.className = 'not-translator-loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    loadingDiv.appendChild(spinner);

    const text = document.createElement('span');
    text.className = 'not-translator-loading-text';
    text.textContent = '正在翻译...';
    loadingDiv.appendChild(text);

    content.appendChild(loadingDiv);

    // 5 秒后若仍未完成，显示"响应较慢"提示
    this.clearLoadingSlowTimeout();
    this.loadingSlowTimeout = setTimeout(() => {
      const loadingText = content.querySelector('.not-translator-loading-text');
      if (loadingText) {
        loadingText.textContent = '响应较慢，请稍候或检查网络...';
      }
    }, 5000);

    // Position and show
    this.positionTooltip(targetElement);
    this.element.classList.add(CSS_CLASSES.TOOLTIP_VISIBLE);
  }

  /**
   * Update tooltip with translation result
   * 从加载状态更新为翻译结果
   */
  updateWithTranslation(data: TranslatedWord): void {
    if (!this.element || !this.currentWord) return;

    // 重新使用 showWord 的渲染逻辑
    const targetElement = this.currentTarget;
    if (!targetElement) return;

    // 隐藏后重新显示完整内容
    this.showWord(targetElement, data);
  }

  /**
   * Show error state in tooltip
   * 显示翻译错误状态
   * @overload
   * @param targetElement 目标元素
   * @param errorMsg 错误消息
   */
  showError(targetElement: HTMLElement, errorMsg: string): void;
  /**
   * Show error state in tooltip
   * 显示翻译错误状态
   * @param targetElement 目标元素
   * @param word 单词（可选）
   * @param errorMsg 错误消息
   */
  showError(targetElement: HTMLElement, word: string, errorMsg: string): void;
  showError(targetElement: HTMLElement, wordOrErrorMsg: string, errorMsg?: string): void {
    if (!this.element) return;

    // 根据参数数量决定含义
    const word = errorMsg ? wordOrErrorMsg : undefined;
    const message = errorMsg || wordOrErrorMsg;

    if (word) {
      this.currentWord = word;
    }
    this.currentTarget = targetElement;
    this.isPinned = false;
    this.updatePinButtonState();

    const content = this.element.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
    if (!content) return;

    // 使用 DOM API 构建 error UI
    content.innerHTML = '';

    // Header with word (如果提供了word)
    if (word) {
      const header = document.createElement('div');
      header.className = `${CSS_CLASSES.TOOLTIP}-header`;

      const wordSpan = document.createElement('span');
      wordSpan.className = `${CSS_CLASSES.TOOLTIP}-word`;
      wordSpan.textContent = word;
      header.appendChild(wordSpan);

      content.appendChild(header);
    }

    // WCAG 4.1.3: 错误消息使用 role="alert" 确保屏幕阅读器立即通知
    const errorDiv = document.createElement('div');
    errorDiv.className = `${CSS_CLASSES.TOOLTIP}-error`;
    errorDiv.setAttribute('role', 'alert');

    const icon = document.createElement('span');
    icon.className = 'not-translator-error-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⚠️';
    errorDiv.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'not-translator-error-text';
    text.textContent = message;
    errorDiv.appendChild(text);

    content.appendChild(errorDiv);

    // Retry button
    const actionsDiv = document.createElement('div');
    actionsDiv.className = `${CSS_CLASSES.TOOLTIP}-actions`;

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = `${CSS_CLASSES.MARK_BUTTON} retry`;
    retryBtn.setAttribute('aria-label', '重新翻译');
    retryBtn.textContent = '重试';
    retryBtn.addEventListener('click', () => {
      // 隐藏 tooltip，让调用者可以重新请求翻译
      this.hide();
    });
    actionsDiv.appendChild(retryBtn);

    content.appendChild(actionsDiv);

    // Position and show
    this.positionTooltip(targetElement);
    this.element.classList.add(CSS_CLASSES.TOOLTIP_VISIBLE);
  }

  /**
   * Destroy the tooltip and clean up all resources
   */
  destroy(): void {
    // 清理事件监听器
    if (this.boundHandlers) {
      document.removeEventListener('click', this.boundHandlers.documentClick);
      document.removeEventListener('mouseover', this.boundHandlers.documentMouseover);
      document.removeEventListener('scroll', this.boundHandlers.documentScroll, true);
      document.removeEventListener('keydown', this.boundHandlers.documentKeydown);
      this.boundHandlers = null;
    }

    // 清理滚动隐藏定时器
    if (this.scrollHideTimeout) {
      clearTimeout(this.scrollHideTimeout);
      this.scrollHideTimeout = null;
    }

    // 清理撤销相关资源
    if (this.undoTimeout) {
      clearTimeout(this.undoTimeout);
      this.undoTimeout = null;
    }
    if (this.undoBar) {
      this.undoBar.remove();
      this.undoBar = null;
    }

    // 清理加载慢提示
    this.clearLoadingSlowTimeout();

    // 移除 DOM 元素
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
    if (this.helpPanel) {
      this.helpPanel.remove();
      this.helpPanel = null;
    }
  }
}
