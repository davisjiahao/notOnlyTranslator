import type { TranslationResult, TranslationMode, TranslatedWord } from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';

/**
 * TranslationDisplay - 根据不同模式渲染翻译结果
 *
 * 设计原则：
 * 1. 非侵入式：使用 TreeWalker 遍历文本节点，只包装需要高亮的词汇
 * 2. 保持原有事件：不替换整个 innerHTML，保留原有的点击、链接等事件
 * 3. 选中触发：高亮词的交互改为选中后弹窗，避免干扰原有点击事件
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
    // 保存原始HTML（用于恢复）
    if (!paragraph.dataset.originalHtml) {
      paragraph.dataset.originalHtml = paragraph.innerHTML;
    }

    // 先移除已有的翻译
    this.clearTranslation(paragraph);

    switch (mode) {
      case 'inline-only':
        this.applyInlineModeNonInvasive(paragraph, result);
        break;
      case 'bilingual':
        this.applyBilingualModeNonInvasive(paragraph, result);
        break;
      case 'full-translate':
        this.applyFullTranslateModeNonInvasive(paragraph, result);
        break;
    }
  }

  /**
   * 模式1: 行内翻译（非侵入式）
   * 在原文中找到生词位置，用 span 包装并在后面添加译文
   */
  private static applyInlineModeNonInvasive(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    // 按位置从后往前排序（避免修改DOM时位置偏移）
    const sortedWords = [...result.words].sort((a, b) => b.position[0] - a.position[0]);

    // 遍历每个生词，在原文中找到并包装
    for (const word of sortedWords) {
      this.wrapWordInText(paragraph, word, true);
    }

    paragraph.classList.add('not-translator-processed');
  }

  /**
   * 模式2: 双文对照（非侵入式）
   * 在原文中高亮生词，在段落后添加译文行
   */
  private static applyBilingualModeNonInvasive(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    if (!result.fullText) {
      // 如果没有完整译文，降级为行内模式
      this.applyInlineModeNonInvasive(paragraph, result);
      return;
    }

    // 按位置从后往前排序
    const sortedWords = [...result.words].sort((a, b) => b.position[0] - a.position[0]);

    // 在原文中高亮生词，并显示行内译文
    for (let i = sortedWords.length - 1; i >= 0; i--) {
      const word = sortedWords[i];
      this.wrapWordInText(paragraph, word, true, i);
    }

    // 创建译文行
    const translationLine = document.createElement('div');
    translationLine.className = 'not-translator-translation-line';

    let translationHtml = this.escapeHtml(result.fullText);

    // 在译文中标记每个生词的翻译
    // 按原始顺序处理
    const wordsInOrder = [...result.words].sort((a, b) => a.position[0] - b.position[0]);
    wordsInOrder.forEach((word, i) => {
      const translation = word.translation;
      const regex = new RegExp(this.escapeRegex(translation), 'g');
      let matchCount = 0;

      translationHtml = translationHtml.replace(regex, (match) => {
        matchCount++;
        if (matchCount === 1) {
          return `<span class="not-translator-highlighted-translation" data-index="${i}" data-word="${this.escapeHtml(word.original)}">${match}</span>`;
        }
        return match;
      });
    });

    translationLine.innerHTML = translationHtml;

    // 在段落后插入译文行
    paragraph.insertAdjacentElement('afterend', translationLine);

    paragraph.classList.add('not-translator-processed');
  }

  /**
   * 模式3: 全文翻译（非侵入式）
   * 在原文中高亮生词，在段落后添加完整译文
   */
  private static applyFullTranslateModeNonInvasive(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    if (!result.fullText) {
      this.applyInlineModeNonInvasive(paragraph, result);
      return;
    }

    // 按位置从后往前排序
    const sortedWords = [...result.words].sort((a, b) => b.position[0] - a.position[0]);

    // 在原文中高亮生词
    for (const word of sortedWords) {
      this.wrapWordInText(paragraph, word, false);
    }

    // 创建译文块
    const translationDiv = document.createElement('div');
    translationDiv.className = 'not-translator-full-translation';
    translationDiv.textContent = result.fullText;

    // 复制原文样式以保持一致性
    try {
      const computedStyle = window.getComputedStyle(paragraph);
      translationDiv.style.fontFamily = computedStyle.fontFamily;
      translationDiv.style.fontSize = computedStyle.fontSize;
      translationDiv.style.lineHeight = computedStyle.lineHeight;
      translationDiv.style.color = computedStyle.color;
      translationDiv.style.textAlign = computedStyle.textAlign;
      translationDiv.style.letterSpacing = computedStyle.letterSpacing;
      // 保持一定的间距
      translationDiv.style.marginTop = '8px';
      translationDiv.style.marginBottom = computedStyle.marginBottom;
    } catch (e) {
      console.warn('Failed to copy styles from original paragraph:', e);
    }

    // 在段落后插入译文
    paragraph.insertAdjacentElement('afterend', translationDiv);

    paragraph.classList.add('not-translator-processed');
  }

  /**
   * 在段落中找到并包装指定的单词
   * 使用 TreeWalker 遍历文本节点，精确定位单词位置
   */
  private static wrapWordInText(
    paragraph: HTMLElement,
    word: TranslatedWord,
    showInlineTranslation: boolean,
    dataIndex?: number
  ): void {
    const targetText = word.original;

    // 创建 TreeWalker 遍历所有文本节点
    const walker = document.createTreeWalker(
      paragraph,
      NodeFilter.SHOW_TEXT,
      null
    );

    let currentNode: Text | null;
    let found = false;

    while ((currentNode = walker.nextNode() as Text | null) && !found) {
      const nodeText = currentNode.textContent || '';

      // 使用不区分大小写的匹配，找到单词
      const lowerNodeText = nodeText.toLowerCase();
      const lowerTarget = targetText.toLowerCase();
      const index = lowerNodeText.indexOf(lowerTarget);

      if (index !== -1) {
        // 检查是否是完整单词（前后是边界）
        const before = index > 0 ? nodeText[index - 1] : ' ';
        const after = index + targetText.length < nodeText.length
          ? nodeText[index + targetText.length]
          : ' ';

        // 简单的单词边界检查
        const isWordBoundary = (char: string) => /[\s.,!?;:'"()[\]{}<>/\\-]/.test(char) || char === '';

        if (isWordBoundary(before) && isWordBoundary(after)) {
          // 找到了目标单词，进行包装
          const parent = currentNode.parentNode;
          if (!parent) continue;

          // 检查父元素是否已经是高亮元素，避免重复包装
          if ((parent as HTMLElement).classList?.contains(CSS_CLASSES.HIGHLIGHT)) {
            continue;
          }

          // 分割文本节点
          const beforeText = nodeText.slice(0, index);
          const matchedText = nodeText.slice(index, index + targetText.length);
          const afterText = nodeText.slice(index + targetText.length);

          // 创建高亮 span
          const highlightSpan = document.createElement('span');
          highlightSpan.className = CSS_CLASSES.HIGHLIGHT;
          highlightSpan.setAttribute('data-difficulty', String(word.difficulty));
          highlightSpan.setAttribute('data-translation', word.translation);
          highlightSpan.setAttribute('data-word', word.original);
          if (word.isPhrase) {
            highlightSpan.setAttribute('data-is-phrase', 'true');
          }
          if (dataIndex !== undefined) {
            highlightSpan.setAttribute('data-index', String(dataIndex));
            highlightSpan.classList.add('not-translator-highlighted-word');
          }
          highlightSpan.textContent = matchedText;

          // 如果需要显示行内译文
          if (showInlineTranslation) {
            const translationSpan = document.createElement('span');
            translationSpan.className = 'not-translator-inline-translation';
            translationSpan.textContent = word.translation;
            highlightSpan.appendChild(translationSpan);
          }

          // 替换原文本节点
          const fragment = document.createDocumentFragment();
          if (beforeText) {
            fragment.appendChild(document.createTextNode(beforeText));
          }
          fragment.appendChild(highlightSpan);
          if (afterText) {
            fragment.appendChild(document.createTextNode(afterText));
          }

          parent.replaceChild(fragment, currentNode);
          found = true;
        }
      }
    }
  }

  /**
   * 清除段落中的翻译
   */
  static clearTranslation(paragraph: HTMLElement): void {
    if (paragraph.classList.contains('not-translator-processed')) {
      // 移除后面添加的译文行
      let nextSibling = paragraph.nextElementSibling;
      while (nextSibling) {
        if (
          nextSibling.classList.contains('not-translator-translation-line') ||
          nextSibling.classList.contains('not-translator-full-translation')
        ) {
          const toRemove = nextSibling;
          nextSibling = nextSibling.nextElementSibling;
          toRemove.remove();
        } else {
          break;
        }
      }

      // 恢复原始HTML
      if (paragraph.dataset.originalHtml) {
        paragraph.innerHTML = paragraph.dataset.originalHtml;
      }

      paragraph.classList.remove('not-translator-processed');
    }
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
    if (!element.dataset.originalHtml) {
      element.dataset.originalHtml = element.innerHTML;
    }
  }
}
