import { CSS_CLASSES, TIMING } from '@/shared/constants';
import { logger } from '@/shared/utils';
import type { Tooltip } from '../tooltip';

/**
 * 悬停处理器类型
 */
export type HoverShowHandler = (element: HTMLElement) => void;

/**
 * 悬停管理器
 * 处理鼠标悬停定时器和 Tooltip 触发
 */
export class HoverManager {
  private tooltip: Tooltip;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverElement: HTMLElement | null = null;
  private hoverDelay: number = TIMING.DEFAULT_HOVER_DELAY;
  private onHoverShow: HoverShowHandler;

  constructor(tooltip: Tooltip, onHoverShow: HoverShowHandler, hoverDelay?: number) {
    this.tooltip = tooltip;
    this.onHoverShow = onHoverShow;
    this.hoverDelay = hoverDelay ?? TIMING.DEFAULT_HOVER_DELAY;
  }

  /**
   * 更新悬停延迟
   */
  setHoverDelay(delay: number): void {
    this.hoverDelay = delay;
  }

  /**
   * 获取当前悬停元素
   */
  getHoverElement(): HTMLElement | null {
    return this.hoverElement;
  }

  /**
   * 检查元素是否是有效的悬停目标
   */
  private getValidHoverElement(target: HTMLElement): HTMLElement | null {
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

    const vocabHighlight = target.classList.contains('not-translator-vocab-highlight')
      ? target
      : target.closest('.not-translator-vocab-highlight') as HTMLElement | null;

    return highlightElement || grammarElement || highlightedWord || highlightedTranslation || vocabHighlight;
  }

  /**
   * 处理鼠标悬停
   */
  handleMouseOver(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const validElement = this.getValidHoverElement(target);

    if (!validElement) return;

    // 如果悬停在同一元素上，不重新触发
    if (this.hoverElement === validElement) return;

    // 清除之前的定时器
    this.clearHoverTimer();

    this.hoverElement = validElement;

    // 设置新的悬停定时器
    this.hoverTimer = setTimeout(() => {
      this.onHoverShow(validElement);
    }, this.hoverDelay);
  }

  /**
   * 处理鼠标离开
   */
  handleMouseOut(e: MouseEvent): void {
    const target = e.target as HTMLElement;

    const isLeavingHighlight =
      target.classList.contains(CSS_CLASSES.HIGHLIGHT) ||
      target.classList.contains('not-translator-grammar-highlight') ||
      target.classList.contains('not-translator-highlighted-word') ||
      target.classList.contains('not-translator-highlighted-translation') ||
      target.classList.contains('not-translator-vocab-highlight') ||
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
  }

  /**
   * 清除悬停定时器
   */
  clearHoverTimer(): void {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  /**
   * 强制清除悬停状态
   */
  clearHoverState(): void {
    this.clearHoverTimer();
    this.hoverElement = null;
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    this.clearHoverTimer();
    this.hoverElement = null;
    logger.info('HoverManager: 已清理');
  }
}
