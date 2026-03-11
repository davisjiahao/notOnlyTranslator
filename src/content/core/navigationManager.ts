import { CSS_CLASSES, TIMING } from '@/shared/constants';
import { logger } from '@/shared/utils';

/**
 * 导航管理器
 * 处理页面内高亮元素的键盘导航
 */
export class NavigationManager {
  private currentIndex: number = -1;
  private highlights: HTMLElement[] = [];
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 获取当前导航索引
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * 获取高亮元素列表
   */
  getHighlights(): HTMLElement[] {
    return this.highlights;
  }

  /**
   * 设置当前高亮元素列表
   */
  setHighlights(highlights: HTMLElement[]): void {
    this.highlights = highlights;
  }

  /**
   * 设置当前索引
   */
  setCurrentIndex(index: number): void {
    this.currentIndex = index;
  }

  /**
   * 获取页面上所有可导航的高亮元素
   */
  getNavigableHighlights(): HTMLElement[] {
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
   * @returns 返回当前导航到的元素和索引
   */
  navigateToNext(): { element: HTMLElement | null; index: number } {
    this.highlights = this.getNavigableHighlights();
    if (this.highlights.length === 0) {
      return { element: null, index: -1 };
    }

    this.currentIndex++;
    if (this.currentIndex >= this.highlights.length) {
      this.currentIndex = 0; // 循环到第一个
    }

    return { element: this.highlights[this.currentIndex], index: this.currentIndex };
  }

  /**
   * 导航到上一个高亮词
   * @returns 返回当前导航到的元素和索引
   */
  navigateToPrevious(): { element: HTMLElement | null; index: number } {
    this.highlights = this.getNavigableHighlights();
    if (this.highlights.length === 0) {
      return { element: null, index: -1 };
    }

    this.currentIndex--;
    if (this.currentIndex < 0) {
      this.currentIndex = this.highlights.length - 1; // 循环到最后一个
    }

    return { element: this.highlights[this.currentIndex], index: this.currentIndex };
  }

  /**
   * 获取当前导航位置的元素
   */
  getCurrentElement(): HTMLElement | null {
    return this.highlights[this.currentIndex] ?? null;
  }

  /**
   * 高亮当前导航的元素
   */
  highlightNavigationElement(element: HTMLElement): void {
    // 移除之前的高亮
    document.querySelectorAll('.not-translator-nav-highlight').forEach((el) => {
      el.classList.remove('not-translator-nav-highlight');
    });

    // 清除之前的导航高亮定时器
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
    }

    // 添加新的高亮
    element.classList.add('not-translator-nav-highlight');

    // 延迟后移除高亮效果
    this.highlightTimer = setTimeout(() => {
      element.classList.remove('not-translator-nav-highlight');
      this.highlightTimer = null;
    }, TIMING.NAVIGATION_HIGHLIGHT_DURATION);
  }

  /**
   * 显示导航位置指示器
   */
  showNavigationIndicator(currentIndex: number, total: number): void {
    const current = currentIndex + 1;

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
   * 检查按键是否是导航键
   */
  isNavigationKey(key: string): boolean {
    return ['j', 'J', 'l', 'L', 'ArrowDown', 'h', 'H', 'ArrowUp'].includes(key);
  }

  /**
   * 处理键盘导航
   * @returns 返回导航结果，如果没有导航则返回 null
   */
  handleNavigation(key: string): { element: HTMLElement | null; index: number; direction: 'next' | 'prev' } | null {
    if (key === 'j' || key === 'J' || key === 'l' || key === 'L' || key === 'ArrowDown') {
      const result = this.navigateToNext();
      if (result.element) {
        return { ...result, direction: 'next' };
      }
    } else if (key === 'h' || key === 'H' || key === 'ArrowUp') {
      const result = this.navigateToPrevious();
      if (result.element) {
        return { ...result, direction: 'prev' };
      }
    }
    return null;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
    }

    // 移除所有导航高亮
    document.querySelectorAll('.not-translator-nav-highlight').forEach((el) => {
      el.classList.remove('not-translator-nav-highlight');
    });

    // 移除导航指示器
    const tooltipElement = document.getElementById('not-translator-tooltip');
    if (tooltipElement) {
      const indicator = tooltipElement.querySelector('.not-translator-nav-indicator');
      if (indicator) {
        indicator.remove();
      }
    }

    this.highlights = [];
    this.currentIndex = -1;

    logger.info('NavigationManager: 已清理');
  }
}
