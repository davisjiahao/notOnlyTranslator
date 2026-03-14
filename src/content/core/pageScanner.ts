import { TranslationDisplay } from '../translationDisplay';
import { TIMING } from '@/shared/constants';
import { logger } from '@/shared/utils';

/**
 * 页面扫描器
 * 负责识别和提取页面上的内容区域和段落
 */
export class PageScanner {
  /**
   * 内容区域选择器列表（按优先级排序）
   */
  private static readonly CONTENT_SELECTORS = [
    'article',
    'main',
    '[role="main"]',
    '.content',
    '.post-content',
    '.article-content',
    '.entry-content',
    '#content',
  ];

  /**
   * 段落元素选择器
   */
  private static readonly PARAGRAPH_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption';

  /**
   * 获取内容区域
   * 按优先级查找页面主要内容区域
   */
  getContentAreas(): HTMLElement[] {
    for (const selector of PageScanner.CONTENT_SELECTORS) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      if (elements.length > 0) {
        return Array.from(elements);
      }
    }

    // Fallback to body
    return [document.body];
  }

  /**
   * 获取需要翻译的段落列表
   */
  getParagraphs(): HTMLElement[] {
    const contentAreas = this.getContentAreas();
    const paragraphs: HTMLElement[] = [];

    for (const area of contentAreas) {
      // 获取所有类段落元素
      const elements = area.querySelectorAll<HTMLElement>(PageScanner.PARAGRAPH_SELECTORS);
      elements.forEach((el) => {
        // 跳过已处理或无实质内容的元素
        if (!TranslationDisplay.isProcessed(el) &&
            el.textContent &&
            el.textContent.trim().length >= TIMING.MIN_PARAGRAPH_LENGTH) {
          paragraphs.push(el);
        }
      });

      // 如果未找到特定元素，将整个区域视为一个段落
      if (paragraphs.length === 0 &&
          area.textContent &&
          area.textContent.trim().length >= TIMING.MIN_PARAGRAPH_LENGTH) {
        paragraphs.push(area);
      }
    }

    return paragraphs;
  }

  /**
   * 过滤未处理的段落
   */
  filterUnprocessedParagraphs(paragraphs: HTMLElement[]): HTMLElement[] {
    return paragraphs.filter(p => !TranslationDisplay.isProcessed(p));
  }

  /**
   * 检查段落是否有足够的内容长度
   */
  hasEnoughContent(element: HTMLElement): boolean {
    const text = element.textContent || '';
    return text.trim().length >= TIMING.MIN_PARAGRAPH_LENGTH;
  }

  /**
   * 获取段落文本内容
   */
  getParagraphText(element: HTMLElement): string {
    return element.textContent || '';
  }

  /**
   * 扫描并返回有效段落数量
   * 用于快速评估页面内容
   */
  scanStats(): {
    contentAreas: number;
    totalParagraphs: number;
    unprocessedParagraphs: number;
    totalTextLength: number;
  } {
    const contentAreas = this.getContentAreas();
    const allParagraphs = this.getParagraphs();
    const unprocessed = this.filterUnprocessedParagraphs(allParagraphs);

    const totalTextLength = allParagraphs.reduce((sum, p) =>
      sum + (p.textContent?.length || 0), 0);

    return {
      contentAreas: contentAreas.length,
      totalParagraphs: allParagraphs.length,
      unprocessedParagraphs: unprocessed.length,
      totalTextLength,
    };
  }

  /**
   * 记录扫描日志
   */
  logScanStats(): void {
    const stats = this.scanStats();
    logger.info('PageScanner: 扫描统计', {
      内容区域数: stats.contentAreas,
      总段落数: stats.totalParagraphs,
      未处理段落数: stats.unprocessedParagraphs,
      总文本长度: stats.totalTextLength,
    });
  }
}
