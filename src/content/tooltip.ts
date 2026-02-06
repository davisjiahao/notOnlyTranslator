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
}

/**
 * Tooltip - manages the translation tooltip display
 *
 * 交互改进：
 * - 支持"钉住"功能，钉住后滚动时 tooltip 跟随目标元素
 * - 滚动时自动更新位置（如果钉住）或延迟隐藏（给用户反应时间）
 * - 快捷键 P 可以切换钉住状态
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
    tooltip.innerHTML = `
      <div class="${CSS_CLASSES.TOOLTIP}-toolbar">
        <button class="${CSS_CLASSES.TOOLTIP}-pin" title="钉住 (P)">📌</button>
        <button class="${CSS_CLASSES.TOOLTIP}-close" title="关闭 (Esc)">&times;</button>
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
  }

  /**
   * Setup global event listeners
   */
  private setupEventListeners(): void {
    // Hide tooltip when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.element?.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        if (!target.classList.contains(CSS_CLASSES.HIGHLIGHT)) {
          // 如果已钉住，不因为点击外部而隐藏
          if (!this.isPinned) {
            this.hide();
          }
        }
      }
    });

    // Hover trigger (Cmd/Ctrl + Hover)
    document.addEventListener('mouseover', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.target as HTMLElement).classList.contains(CSS_CLASSES.HIGHLIGHT)) {
         // Trigger click logic to show tooltip
         (e.target as HTMLElement).click();
      }
    });

    // 滚动处理：钉住时更新位置，未钉住时延迟隐藏
    document.addEventListener('scroll', () => this.handleScroll(), true);

    // Hide on escape key, and handle action shortcuts
    document.addEventListener('keydown', (e) => {
      if (!this.isVisible()) return;

      if (e.key === 'Escape') {
        this.hide();
        return;
      }

      // Action shortcuts (only when not typing in input fields)
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
        // Mark Known
        const btn = this.element?.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.known`) as HTMLElement;
        btn?.click();
      } else if (key === 'u') {
        // Mark Unknown
        const btn = this.element?.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.unknown`) as HTMLElement;
        btn?.click();
      } else if (key === 'a') {
        // Add to Vocabulary
        const btn = this.element?.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.add`) as HTMLElement;
        btn?.click();
      } else if (key === 'p') {
        // Toggle Pin
        this.togglePin();
      }
    });
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
      if (this.isPinned) {
        pinBtn.classList.add('pinned');
        pinBtn.textContent = '📍'; // 改变图标表示已钉住
        pinBtn.title = '取消钉住 (P)';
      } else {
        pinBtn.classList.remove('pinned');
        pinBtn.textContent = '📌';
        pinBtn.title = '钉住 (P)';
      }
    }
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

    content.innerHTML = `
      <div class="${CSS_CLASSES.TOOLTIP}-header">
        <span class="${CSS_CLASSES.TOOLTIP}-word">${data.original}</span>
        <span class="${CSS_CLASSES.TOOLTIP}-difficulty ${difficultyClass}">${difficultyLabel}</span>
      </div>
      ${data.isPhrase ? `<span class="${CSS_CLASSES.TOOLTIP}-phrase">短语</span>` : ''}
      <div class="${CSS_CLASSES.TOOLTIP}-translation">${data.translation}</div>
      <div class="${CSS_CLASSES.TOOLTIP}-actions">
        <button class="${CSS_CLASSES.MARK_BUTTON} known" data-action="known" title="快捷键: K">
          <span>认识</span> <span class="shortcut-hint">(K)</span>
        </button>
        <button class="${CSS_CLASSES.MARK_BUTTON} unknown" data-action="unknown" title="快捷键: U">
          <span>不认识</span> <span class="shortcut-hint">(U)</span>
        </button>
        <button class="${CSS_CLASSES.MARK_BUTTON} add" data-action="add" title="快捷键: A">
          <span>加入生词本</span> <span class="shortcut-hint">(A)</span>
        </button>
      </div>
    `;

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

    content.innerHTML = `
      <div class="${CSS_CLASSES.TOOLTIP}-header">
        <span class="${CSS_CLASSES.TOOLTIP}-word">句子翻译</span>
      </div>
      <div class="${CSS_CLASSES.TOOLTIP}-translation">${data.translation}</div>
      ${
        data.grammarNote
          ? `
        <div class="${CSS_CLASSES.TOOLTIP}-grammar">
          <div class="${CSS_CLASSES.TOOLTIP}-grammar-label">语法说明</div>
          ${data.grammarNote}
        </div>
      `
          : ''
      }
    `;

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

    content.innerHTML = `
      <div class="${CSS_CLASSES.TOOLTIP}-header">
        <span class="${CSS_CLASSES.TOOLTIP}-word">${data.type}</span>
      </div>
      <div class="text-xs text-gray-500 mb-2 italic">"${data.original}"</div>
      <div class="${CSS_CLASSES.TOOLTIP}-translation">${data.explanation}</div>
    `;

    // Position and show
    this.positionTooltip(targetElement);
    this.element.classList.add(CSS_CLASSES.TOOLTIP_VISIBLE);
  }

  /**
   * Show loading state
   */
  showLoading(targetElement: HTMLElement): void {
    if (!this.element) return;

    this.currentTarget = targetElement;

    const content = this.element.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
    if (!content) return;

    content.innerHTML = `
      <div class="${CSS_CLASSES.TOOLTIP}-loading">
        正在翻译...
      </div>
    `;

    this.positionTooltip(targetElement);
    this.element.classList.add(CSS_CLASSES.TOOLTIP_VISIBLE);
  }

  /**
   * Show error state
   */
  showError(targetElement: HTMLElement, message: string): void {
    if (!this.element) return;

    this.currentTarget = targetElement;

    const content = this.element.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
    if (!content) return;

    content.innerHTML = `
      <div class="${CSS_CLASSES.TOOLTIP}-error">
        ${message}
      </div>
    `;

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

    // Check if tooltip would go off screen at bottom
    if (rect.bottom + tooltipRect.height + 8 > window.innerHeight) {
      // Show above instead
      top = rect.top + window.scrollY - tooltipRect.height - 8;
      this.element.classList.add('tooltip-bottom');
    } else {
      this.element.classList.remove('tooltip-bottom');
    }

    // Ensure left is not negative
    left = Math.max(16, left);

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
            this.hide();
            break;
          case 'unknown':
            this.callbacks.onMarkUnknown(data.original, data.translation);
            this.hide();
            break;
          case 'add':
            this.callbacks.onAddToVocabulary(data.original, data.translation);
            this.hide();
            break;
        }
      });
    });
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
   * Destroy the tooltip
   */
  destroy(): void {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
