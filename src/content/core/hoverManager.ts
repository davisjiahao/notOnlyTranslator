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
   * 当按住 Ctrl 键时，跳过延迟立即显示翻译
   */
  handleMouseOver(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (this.tooltip.contains(target)) {
      this.clearHoverTimer();
      return;
    }
    const validElement = this.getValidHoverElement(target);

    if (!validElement || this.tooltip.containsFocus() || this.tooltip.getPinned()) return;

    // 如果悬停在同一元素上，不重新触发
    if (this.hoverElement === validElement) return;

    // 清除之前的定时器
    this.clearHoverTimer();

    this.hoverElement = validElement;

    // Ctrl+悬停：立即显示翻译，跳过延迟
    if (e.ctrlKey) {
      this.onHoverShow(validElement);
      return;
    }

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

    const next = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
    const highlight = this.getValidHoverElement(target);
    if (this.tooltip.contains(next) || (next && highlight?.contains(next))) return;

    if (highlight || this.tooltip.contains(target)) {
      this.clearHoverTimer();
      this.hoverElement = null;

      if (!this.tooltip.getPinned() && !this.tooltip.containsFocus()) {
        // 给鼠标跨越词条和浮层之间的间隙留出时间；进入浮层会取消定时器。
        this.hoverTimer = setTimeout(() => {
          if (!this.tooltip.getPinned() && !this.tooltip.containsFocus()) this.tooltip.hide();
        }, 200);
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
