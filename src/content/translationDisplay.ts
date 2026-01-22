import type { TranslationResult, TranslationMode } from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';

/**
 * TranslationDisplay - 根据不同模式渲染翻译结果
 */
export class TranslationDisplay {
  /**
   * 应用翻译到段落
   */
  static applyTranslation(
    paragraph: HTMLElement,
    result: TranslationResult,
    mode: TranslationMode
  ): void {
    // 先移除已有的翻译
    this.clearTranslation(paragraph);

    switch (mode) {
      case 'inline-only':
        this.applyInlineMode(paragraph, result);
        break;
      case 'bilingual':
        this.applyBilingualMode(paragraph, result);
        break;
      case 'full-translate':
        this.applyFullTranslateMode(paragraph, result);
        break;
    }
  }

  /**
   * 模式1: 行内翻译
   * 仅在生僻词后面显示译文
   */
  private static applyInlineMode(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    const textContent = paragraph.textContent || '';

    // 按位置排序单词
    const sortedWords = [...result.words].sort((a, b) => a.position[0] - b.position[0]);

    // 创建新的HTML结构
    let htmlContent = '';
    let lastIndex = 0;

    for (const word of sortedWords) {
      const [start, end] = word.position;

      // 添加前面的普通文本
      htmlContent += this.escapeHtml(textContent.slice(lastIndex, start));

      // 添加高亮的生僻词和译文
      htmlContent += `<span class="${CSS_CLASSES.HIGHLIGHT}" data-difficulty="${word.difficulty}">
        ${this.escapeHtml(word.original)}
        <span class="not-translator-inline-translation">${this.escapeHtml(word.translation)}</span>
      </span>`;

      lastIndex = end;
    }

    // 添加剩余文本
    htmlContent += this.escapeHtml(textContent.slice(lastIndex));

    paragraph.innerHTML = htmlContent;
    paragraph.classList.add('not-translator-processed');
  }

  /**
   * 模式2: 双文对照
   * 译文显示在原文下方，生僻部分一一对应高亮
   */
  private static applyBilingualMode(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    if (!result.fullText) {
      // 如果没有完整译文，降级为行内模式
      this.applyInlineMode(paragraph, result);
      return;
    }

    const originalText = paragraph.textContent || '';
    const sortedWords = [...result.words].sort((a, b) => a.position[0] - b.position[0]);

    // 创建容器
    const container = document.createElement('div');
    container.className = 'not-translator-bilingual-container';

    // 原文行（高亮生僻词）
    const originalLine = document.createElement('div');
    originalLine.className = 'not-translator-original-line';

    let originalHtml = '';
    let lastIndex = 0;

    for (let i = 0; i < sortedWords.length; i++) {
      const word = sortedWords[i];
      const [start, end] = word.position;

      // 添加普通文本
      originalHtml += this.escapeHtml(originalText.slice(lastIndex, start));

      // 添加高亮词（带索引用于对应）
      originalHtml += `<span class="${CSS_CLASSES.HIGHLIGHT} not-translator-highlighted-word"
        data-index="${i}"
        data-difficulty="${word.difficulty}">
        ${this.escapeHtml(word.original)}
      </span>`;

      lastIndex = end;
    }
    originalHtml += this.escapeHtml(originalText.slice(lastIndex));
    originalLine.innerHTML = originalHtml;

    // 译文行（高亮对应的译文部分）
    const translationLine = document.createElement('div');
    translationLine.className = 'not-translator-translation-line';

    let translationHtml = result.fullText;

    // 在译文中标记每个生僻词的翻译
    sortedWords.forEach((word, i) => {
      // 尝试在译文中找到对应的翻译并高亮
      const translation = word.translation;
      const regex = new RegExp(this.escapeRegex(translation), 'g');
      let matchCount = 0;

      translationHtml = translationHtml.replace(regex, (match) => {
        matchCount++;
        // 只替换第一次出现
        if (matchCount === 1) {
          return `<span class="not-translator-highlighted-translation" data-index="${i}">${match}</span>`;
        }
        return match;
      });
    });

    translationLine.innerHTML = translationHtml;

    // 组装
    container.appendChild(originalLine);
    container.appendChild(translationLine);

    // 替换原段落内容
    paragraph.innerHTML = '';
    paragraph.appendChild(container);
    paragraph.classList.add('not-translator-processed');
  }

  /**
   * 模式3: 全文翻译
   * 显示完整译文，生僻部分高亮
   */
  private static applyFullTranslateMode(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    if (!result.fullText) {
      // 如果没有完整译文，降级为行内模式
      this.applyInlineMode(paragraph, result);
      return;
    }

    const originalText = paragraph.textContent || '';
    const sortedWords = [...result.words].sort((a, b) => a.position[0] - b.position[0]);

    // 创建容器
    const container = document.createElement('div');
    container.className = 'not-translator-full-translate-container';

    // 原文（高亮生僻词）
    const originalDiv = document.createElement('div');
    originalDiv.className = 'not-translator-original-text';

    let originalHtml = '';
    let lastIndex = 0;

    for (const word of sortedWords) {
      const [start, end] = word.position;

      originalHtml += this.escapeHtml(originalText.slice(lastIndex, start));
      originalHtml += `<span class="${CSS_CLASSES.HIGHLIGHT}"
        data-difficulty="${word.difficulty}"
        title="${this.escapeHtml(word.translation)}">
        ${this.escapeHtml(word.original)}
      </span>`;

      lastIndex = end;
    }
    originalHtml += this.escapeHtml(originalText.slice(lastIndex));
    originalDiv.innerHTML = originalHtml;

    // 译文
    const translationDiv = document.createElement('div');
    translationDiv.className = 'not-translator-full-translation';
    translationDiv.textContent = result.fullText;

    // 组装
    container.appendChild(originalDiv);
    container.appendChild(translationDiv);

    // 替换原段落内容
    paragraph.innerHTML = '';
    paragraph.appendChild(container);
    paragraph.classList.add('not-translator-processed');
  }

  /**
   * 清除段落中的翻译
   */
  static clearTranslation(paragraph: HTMLElement): void {
    if (paragraph.classList.contains('not-translator-processed')) {
      // 恢复原始文本
      const originalText = this.extractOriginalText(paragraph);
      paragraph.textContent = originalText;
      paragraph.classList.remove('not-translator-processed');
    }
  }

  /**
   * 从处理过的段落中提取原始文本
   */
  private static extractOriginalText(paragraph: HTMLElement): string {
    // 尝试从data属性获取
    if (paragraph.dataset.originalText) {
      return paragraph.dataset.originalText;
    }

    // 否则从DOM中提取
    const bilingual = paragraph.querySelector('.not-translator-bilingual-container');
    if (bilingual) {
      const originalLine = bilingual.querySelector('.not-translator-original-line');
      return originalLine?.textContent || paragraph.textContent || '';
    }

    const fullTranslate = paragraph.querySelector('.not-translator-full-translate-container');
    if (fullTranslate) {
      const originalDiv = fullTranslate.querySelector('.not-translator-original-text');
      return originalDiv?.textContent || paragraph.textContent || '';
    }

    return paragraph.textContent || '';
  }

  /**
   * HTML转义
   */
  private static escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 正则表达式转义
   */
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 检查元素是否已处理
   */
  static isProcessed(element: HTMLElement): boolean {
    return element.classList.contains('not-translator-processed');
  }

  /**
   * 保存原始文本到data属性
   */
  static saveOriginalText(element: HTMLElement): void {
    if (!element.dataset.originalText) {
      element.dataset.originalText = element.textContent || '';
    }
  }
}
