import type { TranslatedWord, TranslatedSentence } from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';

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
 */
export class Tooltip {
  private element: HTMLElement | null = null;
  private callbacks: TooltipCallbacks;
  private currentWord: string | null = null;

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
      <button class="${CSS_CLASSES.TOOLTIP}-close">&times;</button>
      <div class="${CSS_CLASSES.TOOLTIP}-content"></div>
    `;

    document.body.appendChild(tooltip);
    this.element = tooltip;

    // Close button handler
    const closeBtn = tooltip.querySelector(`.${CSS_CLASSES.TOOLTIP}-close`);
    closeBtn?.addEventListener('click', () => this.hide());
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
          this.hide();
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

    // Hide on scroll
    document.addEventListener('scroll', () => this.hide(), true);

    // Hide on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    });
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
        <button class="${CSS_CLASSES.MARK_BUTTON} known" data-action="known">
          <span>认识</span>
        </button>
        <button class="${CSS_CLASSES.MARK_BUTTON} unknown" data-action="unknown">
          <span>不认识</span>
        </button>
        <button class="${CSS_CLASSES.MARK_BUTTON} add" data-action="add">
          <span>加入生词本</span>
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
   * Show loading state
   */
  showLoading(targetElement: HTMLElement): void {
    if (!this.element) return;

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
    }
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
